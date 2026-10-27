# Mobile Development

Native test builds use the shared Rust encoder, project format, pixel fonts, drawing geometry, and playback model. The mobile shell separates Slots, Text, Canvas, Preview, and Send screens.

## Editing Parity

| Desktop Capability | Mobile Control | Verification |
|---|---|---|
| Eight slots, eight animation frames per slot | Add > Animation; each slot has its own frame strip | 64-frame export and send tests |
| Slot name, order, enable, duplicate, delete | Slot Options | Shared project model; Undo restores edits |
| Frame add, duplicate, delete, reorder | Frame strip; Frame Options | Editing flow test |
| Previous-frame onion skin | Frame Options > Onion Skin | Overlay and toggle tests; overlay is excluded from saved pixels |
| Copy previous frame | Frame Options > Copy Previous | Shared frame cloning |
| All-slot and individual-slot playback | Preview > Playback | Scrub test reaches slot 8, frame 8 |
| Playback speed, effects, all nine modes | Motion | Shared playback simulation and encoder |
| Serif, Sans, Cartoon, Futuristic fonts | Text > Font; Canvas > Insert > Stamp Text | Font picker and face-selection test |
| Multiple fonts within one bitmap or frame | Insert > Stamp Text; choose a font for each stamp | Mixed-font stamping test preserves existing pixels |
| Pixel pictographs | Text > Pictographs; Stamp Text > Pictographs | Shared shipped glyph palette |
| Pencil, eraser, line, rectangle, ellipse, fill | Drawing Tool | Shared geometry; gesture tests |
| Brush size and filled shapes | Drawing Tool | Shape gesture test |
| Rectangular selection and drag move | Drawing Tool > Select | Selection gesture test |
| Copy, cut, paste, erase, select all, nudge | Canvas > Selection | Shared selection functions; clipboard works across frames and slots |
| Clear, invert, horizontal/vertical flip, shift, width | Canvas > Transform | Shared transform functions |
| Image import and horizontal animation strips | Canvas > Insert > Import Image | Shared bounded image decoder; native picker needs device testing |
| Undo and Redo | Canvas toolbar/options; Project Options | Shared project history |
| LED preview color | Project Options > LED Color | Shared palette; local preference |
| Whole-project and single-slot files | Project Options; Slot Options > Export Slot | Shared `.badge` and `.badgemsg` codecs |
| Brightness, enabled-slot upload, capacity | Send | Shared encoder; 64-frame transport specification test |

The desktop model calls a slot a `Message`. A slot may contain text, a drawing, or an animation. Mobile retains this model; it does not flatten an animation into separate message slots.

Mobile selection and ordering use touch controls in place of desktop modifier-key gestures. Drawing commits one undo entry on pointer release. A pinch or canceled stroke never commits pixels.

## Platform Differences

| Area | Current State |
|---|---|
| USB HID | Desktop only; mobile test builds use Bluetooth |
| Files | Import into a private device draft; export explicit copies through native pickers |
| Drafts | Autosave after 400 ms; retain on normal exit and relaunch |
| Open With / share intents | Not registered on mobile; use Import Project or Import Slot |
| Bluetooth PIN | Unsupported, as on desktop; disable the badge PIN before sending |
| Android transfer progress | Busy state and completion/error; per-chunk progress is not exposed yet |
| Store releases | Not configured; these builds are for device testing |

## Compatibility Targets

| Platform | Minimum Build Target | Physical Device Used |
|---|---|---|
| iOS / iPadOS | 15.0, ARM64 | iPhone 17 Pro Max, iOS 27.0.1 |
| Android | API 24, Android 7.0 | OnePlus CPH2583, Android 16, ARM64 |

Minimum targets are compilation targets, not a completed compatibility certification. Older OS versions, tablets, Android ARMv7/x86_64, accessibility services, and physical badge transfers need further testing. Xcode 27.1's installed device SDK was used locally; its matching simulator SDK was unavailable.

## Test Builds

Run commands from `BlinkenBadge/` after `npm ci`.

1. Configure the Android SDK, JDK 21, and NDK 28.2.13676358.
2. Set `ANDROID_HOME`, `JAVA_HOME`, and `NDK_HOME` to those installations.
3. Install Rust target `aarch64-linux-android`.
4. Build the Android APK:
   ```bash
   npm run tauri -- android build --debug --target aarch64 --apk --ci
   ```
5. Install `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk` with ADB.
6. Install Rust target `aarch64-apple-ios`.
7. Build the signed iPhone application:
   ```bash
   APPLE_DEVELOPMENT_TEAM=5QAGYV54MK npm run tauri -- ios build --debug --target aarch64 --export-method debugging --config src-tauri/tauri.mobile-dev.conf.json --ci
   ```
8. Install the resulting application with Xcode or `xcrun devicectl`.

Both development applications use `com.martin.blinkenbadge.dev` and the display name `BlinkenBadge Dev`. Desktop application identifiers remain unchanged. Mobile production configurations build separate `dist-ios/` and `dist-android/` frontends.

CI builds an Android ARM64 debug APK and an unsigned iOS ARM64 archive without store signing credentials. Both builds are required by the aggregate `checks` job.

## Device Acceptance

1. Create an animation in each of eight slots.
2. Add eight distinct frames to each slot.
3. Toggle onion skin and verify ghost pixels never appear on the badge.
4. Duplicate, reorder, delete, and undo frames and slots.
5. Stamp different fonts into separate areas of one frame.
6. Copy a selection between frames and between slots.
7. Rotate the device while editing and while previewing the full sequence.
8. Export the project, relaunch, and import the exported copy.
9. Transfer a short project to the physical badge on each phone.
10. Transfer the 64-frame project and verify slot order, frame order, speed, and brightness.
