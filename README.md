# claude-paste-image

MCP server that captures images from your system clipboard so Claude Code (or any MCP client) can read and analyze them.

Copy a screenshot or image → call the `paste_image` tool → get a file path → Claude reads the image.

## Features

- **Cross-platform**: macOS, Linux (X11 & Wayland), Windows
- **Format detection**: PNG, JPEG, GIF, BMP, TIFF (auto-detected from magic bytes)
- **Secure**: filename sanitization, restrictive file permissions (0o600), no shell interpolation
- **Auto-cleanup**: temporary files are deleted after 30 minutes
- **Zero config**: no API keys, no external services, works offline
- **Minimal dependencies**: only `@modelcontextprotocol/sdk`

## Prerequisites

| Platform | Requirement |
|----------|------------|
| macOS | `pngpaste` (`brew install pngpaste`) — optional, falls back to built-in osascript |
| Linux (X11) | `xclip` (`apt install xclip`) |
| Linux (Wayland) | `wl-clipboard` (`apt install wl-clipboard`) |
| Windows | PowerShell (pre-installed) |

## Installation

### Option 1: npx (no install)

```bash
claude mcp add paste-image -- npx -y claude-paste-image
```

### Option 2: Global install

```bash
npm install -g claude-paste-image
claude mcp add paste-image -- claude-paste-image
```

### Option 3: From source

```bash
git clone https://github.com/jokai-sor/claude-paste-image.git
cd claude-paste-image
npm install && npm run build
claude mcp add paste-image -- node /absolute/path/to/dist/index.js
```

## Usage

1. Copy an image to your clipboard (screenshot, browser image, etc.)
2. In Claude Code, the `paste_image` tool will be available
3. Claude captures the image, saves it to a temp file, and reads it for analysis

### Tool: `paste_image`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `filename` | string | No | Custom filename (alphanumeric, dashes, underscores). Random UUID if omitted. |

### Example output

```
Image saved from clipboard.
Path: /tmp/claude-paste-images/a1b2c3d4.png
Format: PNG
Size: 142 KB

Use the Read tool to view this image.
```

## How it works

1. MCP client calls the `paste_image` tool
2. Server runs a platform-specific command to read the clipboard:
   - macOS: `pngpaste` or `osascript` (AppleScript)
   - Linux: `xclip` (X11) or `wl-paste` (Wayland)
   - Windows: PowerShell with `System.Windows.Forms.Clipboard`
3. Image format is detected from magic bytes
4. File is saved to a temp directory with restrictive permissions
5. File path is returned for the client to read

## Security

- Filenames are sanitized: path separators stripped, only `[a-zA-Z0-9_-]` allowed
- Files are written with mode `0o600` (owner-only read/write)
- Temp directory has mode `0o700` (owner-only access)
- All external commands use `execFileSync` (no shell interpretation)
- Stale files are auto-deleted after 30 minutes

## License

MIT
