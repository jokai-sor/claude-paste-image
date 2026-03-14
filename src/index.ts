#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// --- Constants ---

const SERVER_NAME = "claude-paste-image";
const SERVER_VERSION = "0.1.0";

/** Subdirectory inside os tmpdir for our images. */
const TEMP_SUBDIR = "claude-paste-images";

/** Delete temp images older than 30 minutes. */
const TEMP_MAX_AGE_MS = 30 * 60 * 1000;

/** Max filename length (without extension). */
const FILENAME_MAX_LENGTH = 64;

// --- Helpers ---

/** Return a dedicated temp directory, creating it if needed. */
function getTempDir(): string {
  const dir = join(tmpdir(), TEMP_SUBDIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Remove images older than TEMP_MAX_AGE_MS from our temp directory. */
function cleanupOldFiles(): void {
  try {
    const dir = getTempDir();
    const now = Date.now();
    for (const name of readdirSync(dir)) {
      const filePath = join(dir, name);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > TEMP_MAX_AGE_MS) {
          unlinkSync(filePath);
        }
      } catch { /* ignore per-file errors */ }
    }
  } catch { /* ignore cleanup errors */ }
}

/**
 * Sanitize user-provided filename:
 * - strip path separators to prevent traversal
 * - allow only alphanumeric, dash, underscore, dot
 * - enforce length limit
 * - fallback to UUID if result is empty
 */
function sanitizeFilename(raw: string | undefined): string {
  if (!raw) return randomUUID();

  // Take only the base name (strip any directory components)
  let name = basename(raw);

  // Remove extension if provided — we add our own
  name = name.replace(/\.[^.]*$/, "");

  // Keep only safe characters
  name = name.replace(/[^a-zA-Z0-9_-]/g, "");

  // Enforce length
  name = name.slice(0, FILENAME_MAX_LENGTH);

  return name || randomUUID();
}

/** Detect image format from magic bytes. */
function detectFormat(data: Buffer): string {
  if (data.length < 4) return "png";

  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x42 && data[1] === 0x4d) return "bmp";
  if (data.length >= 4 && (
    // Classic TIFF: II (little-endian) or MM (big-endian) followed by magic 42
    (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00) ||
    (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a)
  )) return "tiff";

  return "png"; // default fallback
}

// --- Clipboard access (platform-specific, no shell interpretation) ---

function getClipboardImageMacOS(): Buffer | null {
  // Prefer pngpaste — simple, no shell needed
  try {
    return execFileSync("pngpaste", ["-"], { stdio: ["ignore", "pipe", "ignore"] });
  } catch { /* pngpaste not installed, fall through */ }

  // Fallback: osascript with fixed script (no interpolation)
  try {
    const script =
      'try\n' +
      '  set img to (the clipboard as «class PNGf»)\n' +
      '  return img\n' +
      'on error\n' +
      '  error number -1\n' +
      'end try';
    return execFileSync("osascript", ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function getClipboardImageLinux(): Buffer | null {
  // Try xclip (X11)
  try {
    return execFileSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { /* not available */ }

  // Try wl-paste (Wayland)
  try {
    return execFileSync("wl-paste", ["--type", "image/png"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

function getClipboardImageWindows(): Buffer | null {
  // PowerShell one-liner: grab clipboard image, save as PNG to stdout via BMP→PNG conversion
  try {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) { exit 1 }
$ms = New-Object System.IO.MemoryStream
$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
$ms.Dispose()
$img.Dispose()
[System.Console]::OpenStandardOutput().Write($bytes, 0, $bytes.Length)
`;
    return execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

function getClipboardImage(): Buffer | null {
  const platform = process.platform;

  if (platform === "darwin") return getClipboardImageMacOS();
  if (platform === "linux") return getClipboardImageLinux();
  if (platform === "win32") return getClipboardImageWindows();

  throw new Error(`Unsupported platform: ${platform}. Supported: macOS, Linux, Windows.`);
}

// --- MCP Server ---

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "paste_image",
      description:
        "Capture an image from the system clipboard, save it to a temporary file, " +
        "and return the file path so Claude Code can read and analyze it. " +
        "Supports PNG, JPEG, GIF, BMP, TIFF. " +
        "Requires pngpaste (macOS), xclip/wl-paste (Linux), or PowerShell (Windows).",
      inputSchema: {
        type: "object" as const,
        properties: {
          filename: {
            type: "string",
            description:
              "Optional custom filename (without extension). " +
              "Only alphanumeric characters, dashes, and underscores are allowed. " +
              "A random name is used if omitted.",
          },
        },
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "paste_image") {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }

  // Cleanup old temp files on every call (cheap operation)
  cleanupOldFiles();

  // Grab image from clipboard
  let imageData: Buffer | null;
  try {
    imageData = getClipboardImage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  if (!imageData || imageData.length === 0) {
    return {
      content: [{ type: "text", text: "No image found in clipboard. Copy an image first." }],
      isError: false,
    };
  }

  // Build safe file path
  const safeName = sanitizeFilename((args as Record<string, unknown>)?.filename as string | undefined);
  const format = detectFormat(imageData);
  const fileName = `${safeName}.${format}`;
  const filePath = join(getTempDir(), fileName);

  // Write file with restrictive permissions (owner-only read/write)
  writeFileSync(filePath, imageData, { mode: 0o600 });

  // Verify
  const stat = statSync(filePath);
  const sizeKB = Math.round(stat.size / 1024);

  return {
    content: [
      {
        type: "text",
        text:
          `Image saved from clipboard.\n` +
          `Path: ${filePath}\n` +
          `Format: ${format.toUpperCase()}\n` +
          `Size: ${sizeKB} KB\n\n` +
          `Use the Read tool to view this image.`,
      },
    ],
    isError: false,
  };
});

server.onerror = (error) => console.error("[MCP Error]", error);
process.on("SIGINT", async () => { await server.close(); process.exit(0); });

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`${SERVER_NAME} v${SERVER_VERSION} running on stdio`);
