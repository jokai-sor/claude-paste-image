# Changelog

## 0.1.0 (2026-03-13)

- Initial release
- Capture images from system clipboard (PNG, JPEG, GIF, BMP, TIFF)
- Cross-platform: macOS (pngpaste / osascript fallback), Linux (xclip / wl-paste), Windows (PowerShell)
- Automatic temp file cleanup (30 min TTL)
- Secure filename sanitization and restrictive file permissions
