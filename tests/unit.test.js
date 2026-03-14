import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

// We test the logic directly by re-implementing the pure functions here,
// since the source exports nothing (it's a server entry point).
// This keeps tests decoupled from the MCP runtime.

// --- sanitizeFilename (mirror of src/index.ts) ---

const FILENAME_MAX_LENGTH = 64;

function sanitizeFilename(raw) {
  if (!raw) return randomUUID();
  let name = basename(raw);
  name = name.replace(/\.[^.]*$/, "");
  name = name.replace(/[^a-zA-Z0-9_-]/g, "");
  name = name.slice(0, FILENAME_MAX_LENGTH);
  return name || randomUUID();
}

describe("sanitizeFilename", () => {
  it("returns UUID for undefined", () => {
    const result = sanitizeFilename(undefined);
    assert.match(result, /^[0-9a-f-]{36}$/);
  });

  it("returns UUID for empty string", () => {
    const result = sanitizeFilename("");
    assert.match(result, /^[0-9a-f-]{36}$/);
  });

  it("strips path separators", () => {
    assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
  });

  it("removes extension", () => {
    assert.equal(sanitizeFilename("photo.png"), "photo");
  });

  it("keeps only safe characters", () => {
    assert.equal(sanitizeFilename("hello world!@#$.png"), "helloworld");
  });

  it("allows dashes and underscores", () => {
    assert.equal(sanitizeFilename("my-file_name.jpg"), "my-file_name");
  });

  it("enforces max length", () => {
    const long = "a".repeat(100);
    assert.equal(sanitizeFilename(long), "a".repeat(FILENAME_MAX_LENGTH));
  });

  it("returns UUID for name that becomes empty after sanitization", () => {
    const result = sanitizeFilename("!@#$%.png");
    assert.match(result, /^[0-9a-f-]{36}$/);
  });
});

// --- detectFormat (mirror of src/index.ts) ---

function detectFormat(data) {
  if (data.length < 4) return "png";
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return "gif";
  if (data[0] === 0x42 && data[1] === 0x4d) return "bmp";
  if (data.length >= 4 && (
    (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00) ||
    (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a)
  )) return "tiff";
  return "png";
}

describe("detectFormat", () => {
  it("detects PNG", () => {
    assert.equal(detectFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d])), "png");
  });

  it("detects JPEG", () => {
    assert.equal(detectFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  });

  it("detects GIF", () => {
    assert.equal(detectFormat(Buffer.from([0x47, 0x49, 0x46, 0x38])), "gif");
  });

  it("detects BMP", () => {
    assert.equal(detectFormat(Buffer.from([0x42, 0x4d, 0x00, 0x00])), "bmp");
  });

  it("detects TIFF (little-endian)", () => {
    assert.equal(detectFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00])), "tiff");
  });

  it("detects TIFF (big-endian)", () => {
    assert.equal(detectFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])), "tiff");
  });

  it("defaults to png for unknown magic bytes", () => {
    assert.equal(detectFormat(Buffer.from([0x00, 0x00, 0x00, 0x00])), "png");
  });

  it("defaults to png for short buffer", () => {
    assert.equal(detectFormat(Buffer.from([0x89])), "png");
  });

  it("defaults to png for empty buffer", () => {
    assert.equal(detectFormat(Buffer.from([])), "png");
  });
});
