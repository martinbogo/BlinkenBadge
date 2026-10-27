# BlinkenBadge Desktop

Desktop application for macOS, Windows, and Linux.

See [README.md](../README.md) for full project documentation and [PROTOCOL.md](../PROTOCOL.md) for wire specifications.

## Source Layout

| Path | Description |
|---|---|
| `src/` | React frontend: editor canvas, timeline, preview, transport bar |
| `src/doc.ts` | Serializer and deserializer for `.badge` and `.badgemsg` formats |
| `src/badge.ts` | Display mode preview simulation |
| `src/draw.ts` | Canvas drawing primitives |
| `src-tauri/src/protocol.rs` | Wire format encoder |
| `src-tauri/src/usb.rs` | USB HID transport and hotplug polling |
| `src-tauri/src/ble.rs` | Bluetooth LE transport |
| `src-tauri/src/files.rs` | File operations, recent files, crash recovery |
| `src-tauri/src/menu.rs` | Native application menus |

## Development

1. Install frontend dependencies:
   ```bash
   npm install
   ```
2. Start the desktop application in development mode:
   ```bash
   npm run tauri dev
   ```
3. Run frontend unit tests:
   ```bash
   npm test
   ```
4. Run Rust unit tests:
   ```bash
   cd src-tauri && cargo test
   ```

## Recommended IDE Setup

Use [VS Code](https://code.visualstudio.com/) with:
- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
