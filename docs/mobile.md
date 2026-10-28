# Mobile Development

Native test builds use the shared Rust encoder, project format, pixel fonts, drawing geometry, and playback model. The mobile shell separates Slots, Text, Canvas, Preview, and Send screens.

## Editing Parity

| Desktop Capability | Mobile Control | Verification |
|---|---|---|
| Eight slots, eight animation frames per slot | Add > Animation; each slot has its own frame strip | 64-frame export and send tests |
| Slot name, order, enable, duplicate, delete | Menu beside each slot; Slot Options | Targeted deletion, final-slot reset, and Undo tests |
| Frame add, duplicate, delete, reorder | Duplicate and New buttons; Frame Options | Editing flow and undo tests |
| Previous-frame onion skin | Onion button; Frame Options > Onion Skin | Overlay and toggle tests; overlay is excluded from saved pixels |
| Copy previous frame | Frame Options > Copy Previous | Shared frame cloning |
| All-slot and individual-slot playback | Preview > Playback | Scrub test reaches slot 8, frame 8 |
| Playback speed, effects, all nine modes | Frame counter > Playback Speed; Motion | Shared playback simulation and encoder |
| Twelve pixel fonts, including Comic, Punk, and Script | Text > Font; More > Stamp Text | Twelve-face picker and coverage tests |
| Multiple fonts within one bitmap or frame | More > Stamp Text; choose a font for each stamp | Mixed-font stamping test preserves existing pixels |
| Pixel pictographs | Text > Pictographs; Stamp Text > Pictographs | Shared shipped glyph palette |
| Pencil, eraser, line, rectangle, ellipse, fill | Drawing Tool | Shared geometry; gesture tests |
| Brush size and filled shapes | Drawing Tool | Shape gesture test |
| Rectangular selection and drag move | Drawing Tool > Select | Selection gesture test |
| Copy, cut, paste, erase, select all, nudge | Select toolbar; More > Selection | Shared selection functions; clipboard works across frames and slots |
| Clear, invert, horizontal/vertical flip, shift, width | Canvas > Transform | Shared transform functions |
| Image import and horizontal animation strips | More > Import Image | Shared bounded image decoder; native picker needs device testing |
| Undo and Redo | Canvas toolbar/options; Project Options | Shared project history |
| LED preview color | Project Options > LED Color | Shared palette; local preference |
| Whole-project and single-slot files | Project Options; Slot Options > Export Slot | Shared `.badge` and `.badgemsg` codecs |
| Brightness, enabled-slot upload, capacity | Send checklist, Brightness, Badge Memory | Shared encoder; 64-frame transport specification test |

The home screen is titled Badge Slots. Each card has a separate options button for deleting, duplicating, renaming, ordering, enabling, or exporting that slot. Delete asks for confirmation and Undo restores the complete creation. Deleting the last creation replaces it with a blank slot to retain the shared one-to-eight-slot document format.

Empty previews and the canvas show unlit pixels. The drawing screen keeps a full badge monitor visible above the canvas in portrait and beside it in landscape. Focus keeps a smaller full badge monitor while hiding the slot header and filmstrip.

The canvas starts at Fit with all 44 display columns visible. Fit, 2×, and 4× are direct controls; pinch zoom stays anchored beneath the fingers. Two fingers pan without drawing. Zoom and pan remain in place when switching frames or entering Focus. A magnifier shows the target pixel beside the finger while drawing.

Play animates the editing canvas and monitor together. Pause selects the visible animation frame for editing. Drawing is disabled during playback; zoom and pan still work. The filmstrip follows the playing frame, and tapping a thumbnail pauses on that frame. Focus provides Previous and Next buttons; Frame Options retains duplication, blank frames, deletion, reordering, and Copy Previous.

The desktop model calls a slot a `Message`. A slot may contain text, a drawing, or an animation. Mobile retains this model; it does not flatten an animation into separate message slots.

Mobile selection and ordering use touch controls in place of desktop modifier-key gestures. Draw uses one finger: tap to toggle a pixel, start on a dark pixel to draw a stroke, or start on a lit pixel to erase a stroke. The Erase tool always clears pixels, including strokes that start on empty space. A stroke keeps its starting ink while crossing or revisiting pixels. Drawing commits one undo entry on pointer release. A pinch or canceled stroke never commits pixels.

## Common Actions

The mobile review follows [Apple’s toolbar guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars) and [Android’s action patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns): frequent actions stay visible in context; detailed operations stay in labeled sheets.

| Friction Found | Current Access |
|---|---|
| Speed hidden under More and Motion | Frame counter shows speed and opens a full-width Playback Speed slider |
| Copy and Paste hidden after selecting pixels | Select replaces the frame action row with Copy, Cut, Paste, Options, and Done; feedback confirms clipboard operations |
| Brush and filled-shape settings below the tool list | Compact settings row at the top of Tools |
| Text stamping, import, and clearing nested under generic groups | More exposes Stamp Text, Import Image, and Clear Frame directly; duplicate view/history shortcuts were removed |
| Sending requires returning to the slot list | Send beside the normal editor display and in Preview; Focus retains it under More |
| Send button below a potentially long preview list | Fixed transfer footer; scrollable checklist with compact full-display previews |
| Enabled slots can only be changed in individual menus | Send checklist controls the same saved enabled flags used by the desktop model |
| Disabled Send has no clear next step | Footer explains discovery, an empty selection, or excess memory; search retry and Connection Help are visible |
| Prior success message remains after transfer settings change | Badge, slot, and brightness changes reset the old success state |
| Font names, action icons, and limits lack context | Font/Motion labels, Tools/Focus/More/Menu captions, slot counts, and creation descriptions |
| Confirmation dismiss button says Done | Cancel for delete, replacement, and conversion confirmations |
| Autosave and portable files are easy to confuse | Main menu explains device autosave and exporting a separate project copy |

Selection commands replace the existing frame-control row while Select is active, so they do not reduce canvas height. Done returns to drawing. Tapping a frame thumbnail keeps the clipboard, allowing paste into another frame. Clear Frame preserves canvas width and remains undoable. All transform, insertion, file, and frame operations remain available. Fit, zoom, frame options, and history use the visible controls rather than duplicate entries in More.

Send explicitly prepares checked slots for a transfer; finding or selecting a badge does not upload. It does not claim a persistent connection or read back artwork. Busy state locks editing and navigation, and progress is indeterminate unless the transport reports actual chunks. Connection Help covers permissions, rediscovery, and unsupported PIN-protected transfers. Physical badge transfers and older-device acceptance remain necessary.

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

### Animation Results

Physical tests on October 28, 2026 used application commit `c35cbfa40af7141611894430c3ef1c6d36cffad0` and the development application on both devices. iPhone input used iPhone Mirroring. OnePlus input used USB ADB after Android Studio mirroring failed to forward input.

| Check | iPhone 17 Pro Max, iOS 27.0.1 | OnePlus CPH2583, Android 16 |
|---|---|---|
| Create eight distinct frames in one slot | Pass | Pass |
| New blank frame with previous-frame onion guide | Pass; saved ink counts `[5, 0]` | Pass; saved ink counts `[5, 0]` |
| Toggle onion guide off and on | Pass | Pass |
| Duplicate, reorder, delete, and undo frames | Pass | Pass |
| Eight-frame limit disables New and Duplicate | Pass | Pass |
| Change speed to 1/8 | Pass | Pass |
| Canvas playback and frame-strip advancement | Pass | Pass |
| Drawing during playback leaves saved artwork unchanged | Pass | Pass |
| Pause and erase a lit pixel in the visible frame | Pass; only frame 3 changed | Pass; only frame 6 changed |
| Undo restores the paused-frame edit | Pass | Pass; Redo also verified |
| 4× Focus and frame stepping retain zoom | Pass | Pass |
| Duplicate a slot and modify its first frame independently | Pass | Pass |
| All-slot preview reaches slot 3, frame 8 | Pass | Pass |
| Edit This Slot opens the previewed frame | Pass | Pass |
| Terminate and relaunch retains the complete saved project | Pass; exact project equality | Pass; exact project equality |
| Original user slots remain unchanged | Pass | Pass |

Each phone retains `QA Bounce` and `QA Bounce Copy`, with eight distinct frames per slot. The copied slot differs only in frame 1. No application changes were required by these tests. Saved-project comparisons confirm frame data; screenshots confirm visible controls and onion overlays. [Sanitized results](device-tests/2026-10-28/results.json) exclude user artwork, device identifiers, and draft paths.

| Evidence | iPhone | OnePlus |
|---|---|---|
| Blank frame with onion guide | [Screenshot](device-tests/2026-10-28/ios-onion.png) | [Screenshot](device-tests/2026-10-28/android-onion.png) |
| 4× Focus canvas | [Screenshot](device-tests/2026-10-28/ios-focus.png) | [Screenshot](device-tests/2026-10-28/android-focus.png) |

These tests cover two animation slots per phone. Physical pinch/pan gestures, rotation, eight-slot/64-frame device stress tests, native file round-trips, and older-device coverage remain unverified. Physical badge transfer was deferred because the badge was unavailable. Onion exclusion from transmitted artwork still requires a badge check.

### Remaining Acceptance

1. Create an animation in each of eight slots.
2. Add eight distinct frames to each slot.
3. Toggle onion skin and verify ghost pixels never appear on the badge.
4. Duplicate, reorder, delete, and undo frames and slots.
5. Stamp different fonts into separate areas of one frame.
6. Copy a selection between frames and between slots.
7. Try Fit, 2×, 4×, pinch, pan, and Focus; switch frames without losing the viewport.
8. Play in the canvas, then pause and edit the visible frame.
9. Rotate the device while editing and while previewing the full sequence.
10. Export the project, relaunch, and import the exported copy.
11. Transfer a short project to the physical badge on each phone.
12. Transfer the 64-frame project and verify slot order, frame order, speed, and brightness.
