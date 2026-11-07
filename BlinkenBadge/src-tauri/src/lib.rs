// Copyright 2026 Martin Bogomolni
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

#[cfg(not(target_os = "android"))]
mod ble;
#[cfg(target_os = "android")]
#[path = "ble_android.rs"]
mod ble;
mod file_access;
mod files;
mod firmware;
mod font;
#[cfg(desktop)]
mod menu;
#[cfg(mobile)]
mod menu {
    pub fn rebuild(_: &tauri::AppHandle) {}
}
mod protocol;
#[cfg(desktop)]
mod usb;
#[cfg(mobile)]
#[path = "usb_mobile.rs"]
mod usb;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use firmware::Firmware;
use protocol::{Message, Mode};

/// One badge message slot as described by the UI.
///
/// `frames` is a list of frames; each frame is 11 rows of booleans.
/// In `animation` mode every frame is padded to 48px and concatenated into a
/// filmstrip. In every other mode only the first frame is used, at whatever
/// width it has, which is what makes long scrolling text work.
#[derive(Debug, Deserialize)]
pub struct MessageSpec {
    pub frames: Vec<Vec<Vec<bool>>>,
    pub mode: Mode,
    pub speed: u8,
    #[serde(default)]
    pub blink: bool,
    #[serde(default)]
    pub ants: bool,
}

#[derive(Debug, Serialize)]
pub struct TextBitmap {
    pub rows: Vec<Vec<bool>>,
    pub columns: usize,
    pub width: usize,
    pub missing: Vec<char>,
}

/// A failed send.
///
/// This used to carry a byte offset so the UI could offer to resume. It could
/// not: the badge does not track a write position across a reconnect, so
/// continuing from the middle produced a garbled buffer rather than a finished
/// one. A failed BLE upload has to be sent again from the start.
#[derive(Debug, Serialize)]
pub struct SendError {
    pub message: String,
}

#[derive(Clone, Serialize)]
struct Progress {
    chunk: usize,
    total: usize,
}

fn to_messages(specs: &[MessageSpec], fw: Firmware) -> Result<Vec<Message>, String> {
    if specs.is_empty() {
        return Err("Add at least one message before sending.".into());
    }
    if specs.len() > 8 {
        return Err("A badge holds up to 8 messages.".into());
    }
    specs
        .iter()
        .map(|s| {
            if s.frames.is_empty() {
                return Err("A message has no frames.".to_string());
            }
            if s.frames.len() > protocol::ANIMATION_MAX_FRAMES {
                return Err("A slot holds up to 8 frames.".into());
            }
            let width = s.frames[0].first().map(Vec::len).unwrap_or(0);
            let checked_frames = if s.mode == Mode::Animation {
                &s.frames[..]
            } else {
                &s.frames[..1]
            };
            if width == 0
                || width > protocol::MAX_BYTE_COLUMNS * 8
                || checked_frames.iter().any(|f| {
                    f.len() != protocol::BADGE_HEIGHT || f.iter().any(|row| row.len() != width)
                })
            {
                return Err(
                    "Frames must have 11 equal-width rows within the badge capacity.".into(),
                );
            }
            let (bitmap, columns) = if s.mode == Mode::Animation {
                if s.frames.len() > protocol::ANIMATION_MAX_FRAMES {
                    return Err(protocol::ProtocolError::TooManyFrames {
                        got: s.frames.len(),
                    }
                    .to_string());
                }
                protocol::frames_to_bitmap(&s.frames, fw.animation_stride())
            } else {
                protocol::pixels_to_bitmap(&s.frames[0])
            };
            if columns == 0 {
                return Err("A message is empty. Draw something or remove it.".to_string());
            }
            Ok(Message {
                bitmap,
                columns,
                mode: s.mode,
                speed: s.speed,
                blink: s.blink,
                ants: s.ants,
            })
        })
        .collect()
}

fn encode(specs: &[MessageSpec], brightness: u8, fw: Firmware) -> Result<Vec<u8>, String> {
    let messages = to_messages(specs, fw)?;
    protocol::pack(&messages, brightness, protocol::Stamp::now()).map_err(|e| e.to_string())
}

/// One face, as the editor needs to know it.
#[derive(serde::Serialize)]
struct FaceInfo {
    id: String,
    name: String,
    notice: String,
    /// Whether to offer this face in the picker. Every face is sent either
    /// way, because measuring has to follow the same fallback chain the
    /// renderer does.
    pickable: bool,
    /// Pixel advance per character this face can draw. Sent whole so the
    /// editor can measure a string without a round trip per keystroke.
    advances: Vec<(char, usize)>,
}

/// Hand the faces' own widths to the editor so it can budget typing against
/// the width a string will actually occupy rather than its character count.
///
/// Order matters: it is the fallback order, so the editor resolves a glyph the
/// same way `font::layout` does. Measuring one way and drawing another is how
/// an editor comes to accept a string that will not fit.
#[tauri::command]
fn font_metrics() -> Vec<FaceInfo> {
    font::FACES
        .iter()
        .map(|f| FaceInfo {
            id: f.id.to_string(),
            name: f.name.to_string(),
            notice: f.notice.to_string(),
            pickable: f.pickable,
            advances: f
                .glyphs
                .iter()
                .map(|(c, g)| (*c, g.advance as usize))
                .collect(),
        })
        .collect()
}

#[tauri::command]
fn render_text(text: String, face: Option<String>) -> Result<TextBitmap, String> {
    if text.len() > 64 * 1024 {
        return Err("Text exceeds the size limit.".into());
    }
    let chosen = face
        .as_deref()
        .and_then(font::face)
        .unwrap_or_else(|| font::face(font::DEFAULT_FACE).expect("default face"));
    if font::measure(chosen, &text) > protocol::MAX_BYTE_COLUMNS * 8 {
        return Err("Text exceeds badge capacity.".into());
    }
    let l = font::layout(chosen, &text);
    Ok(TextBitmap {
        columns: l.width.div_ceil(8),
        width: l.width,
        rows: l.rows,
        missing: l.missing,
    })
}

/// Pick an image and hand it back as a data URL for the frontend to decode.
/// Returns None if cancelled.
#[tauri::command]
async fn pick_image(app: AppHandle) -> Result<Option<String>, String> {
    #[cfg(mobile)]
    return files::mobile_image(app).await;
    #[cfg(desktop)]
    {
        use base64::Engine;
        use tauri_plugin_dialog::DialogExt;
        let path = app
            .dialog()
            .file()
            .add_filter("Image", &["png", "gif", "bmp", "jpg", "jpeg", "webp"])
            .blocking_pick_file();
        let Some(path) = path else { return Ok(None) };
        let path = path
            .into_path()
            .map_err(|e| format!("Could not resolve that file: {e}"))?;
        let bytes = file_access::read_bounded(&path, file_access::MAX_IMAGE_BYTES)?;
        let mime = match path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "gif" => "image/gif",
            "bmp" => "image/bmp",
            "webp" => "image/webp",
            "jpg" | "jpeg" => "image/jpeg",
            other => return Err(format!("Unsupported image type: .{other}")),
        };
        let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
        Ok(Some(format!("data:{mime};base64,{b64}")))
    }
}

#[tauri::command]
async fn ble_scan(_app: AppHandle, timeout_ms: Option<u64>) -> Result<Vec<ble::BadgeInfo>, String> {
    let _guard = DEVICE_OPERATION
        .try_lock()
        .map_err(|_| "A device operation is already running.")?;
    #[cfg(target_os = "android")]
    return ble::scan(_app, timeout_ms.unwrap_or(6000).clamp(100, 10000)).await;
    #[cfg(not(target_os = "android"))]
    ble::scan(timeout_ms.unwrap_or(6000).clamp(100, 10000))
        .await
        .map_err(|e| e.to_string())
}

/// Whether a badge is plugged in over USB. Cheap enough to poll.
#[tauri::command]
fn usb_find() -> Result<Option<usb::UsbInfo>, String> {
    usb::find().map_err(|e| e.to_string())
}

/// Send over USB HID.
///
/// Deliberately not folded into `send_to_badge`: that function is mostly
/// machinery for BLE's failure modes (a stall detector, resume offsets, a
/// device picker), none of which apply here. A USB transfer either opens the
/// device and completes in well under a second, or fails immediately.
#[tauri::command]
async fn send_to_badge_usb(
    app: AppHandle,
    messages: Vec<MessageSpec>,
    brightness: u8,
) -> Result<usize, SendError> {
    let _guard = DEVICE_OPERATION.try_lock().map_err(|_| SendError {
        message: "A device operation is already running.".into(),
    })?;
    // Ask the device rather than trusting whatever the UI last saw: the badge
    // may have been swapped since.
    let fw = usb::find()
        .map_err(|e| SendError {
            message: e.to_string(),
        })?
        .map(|i| i.firmware)
        .unwrap_or_default();
    let data = encode(&messages, brightness, fw).map_err(|message| SendError { message })?;

    // hidapi is blocking, so keep it off the async runtime's threads.
    tokio::task::spawn_blocking(move || {
        usb::send(&data, move |chunk, total| {
            let _ = app.emit("send-progress", Progress { chunk, total });
        })
    })
    .await
    .map_err(|e| SendError {
        message: format!("The USB transfer task stopped unexpectedly: {e}"),
    })?
    .map_err(|e| SendError {
        message: e.to_string(),
    })
}

#[tauri::command]
async fn send_to_badge(
    app: AppHandle,
    messages: Vec<MessageSpec>,
    brightness: u8,
    device_id: Option<String>,
) -> Result<usize, SendError> {
    let _guard = DEVICE_OPERATION.try_lock().map_err(|_| SendError {
        message: "A device operation is already running.".into(),
    })?;
    // Validate before opening a connection. Encode again after firmware detection.
    encode(&messages, brightness, Firmware::default()).map_err(|message| SendError { message })?;
    #[cfg(target_os = "android")]
    {
        let stock = encode(&messages, brightness, Firmware::Stock)
            .map_err(|message| SendError { message })?;
        let magic = encode(&messages, brightness, Firmware::BadgeMagic)
            .map_err(|message| SendError { message })?;
        return ble::send(app, device_id, stock, magic)
            .await
            .map_err(|message| SendError { message });
    }
    #[cfg(not(target_os = "android"))]
    ble::send(
        |fw| encode(&messages, brightness, fw),
        device_id.as_deref(),
        |chunk, total| {
            let _ = app.emit("send-progress", Progress { chunk, total });
        },
    )
    .await
    .map_err(|e| SendError {
        message: e.to_string(),
    })
}

static DEVICE_OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(file_access::FileAccess::default())
        .setup(|_app| {
            #[cfg(desktop)]
            {
                usb::watch(_app.handle().clone());
                menu::install(_app.handle())?;
                pending_from_argv();
            }
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            render_text,
            font_metrics,
            pick_image,
            ble_scan,
            usb_find,
            send_to_badge,
            send_to_badge_usb,
            files::pick_open,
            files::mobile_import,
            files::mobile_export,
            files::pick_save,
            files::read_text,
            files::write_text,
            files::recovery_write,
            files::recovery_read,
            files::recovery_clear,
            files::recent_list,
            files::recent_clear,
            take_pending_files,
            confirm_exit,
        ]);
    #[cfg(target_os = "android")]
    let builder = builder.plugin(ble::init());
    builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Double-clicking a .badge file, or "Open With". macOS delivers it
            // as an Apple Event at any time, including before the window is
            // ready, so the frontend re-asks for a pending file once it mounts
            // rather than relying on catching the event live.
            //
            // `Opened` exists only on macOS. Windows and Linux pass the file as
            // an argument instead, which `pending_from_argv` handles at startup.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        remember_pending(app, path.display().to_string());
                    }
                }
            }
            // Quit from the menu or Cmd+Q does not go through the window's
            // close handler, so without this the one path most likely to be
            // used in a hurry is the one that loses work silently.
            tauri::RunEvent::ExitRequested { api, .. }
                if !EXIT_OK.load(std::sync::atomic::Ordering::SeqCst) =>
            {
                api.prevent_exit();
                let _ = app.emit("quit-requested", ());
            }
            _ => {}
        });
}

/// Set once the frontend has dealt with unsaved work and really means it.
static EXIT_OK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn confirm_exit(app: AppHandle) {
    EXIT_OK.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// Files the OS asked us to open that the UI has not collected yet.
static PENDING: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[cfg(target_os = "macos")]
fn remember_pending(app: &AppHandle, path: String) {
    let Ok(path) = files::grant_native(app, &path) else {
        return;
    };
    if let Ok(mut q) = PENDING.lock() {
        q.push(path.clone());
    }
    // Harmless if nothing is listening yet; `take_pending_files` is the catch-up.
    let _ = app.emit("open-file", path);
}

/// Windows and Linux pass the file as an argument instead of an event.
#[cfg(desktop)]
fn pending_from_argv() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Ok(mut q) = PENDING.lock() {
        for a in args {
            let p = std::path::Path::new(&a);
            let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
            if (ext == files::PROJECT_EXT || ext == files::MESSAGE_EXT) && p.exists() {
                q.push(a);
            }
        }
    }
}

#[tauri::command]
fn take_pending_files(app: AppHandle) -> Vec<String> {
    PENDING
        .lock()
        .map(|mut q| {
            std::mem::take(&mut *q)
                .into_iter()
                .filter_map(|p| files::grant_native(&app, &p).ok())
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_text_is_rejected_before_rendering() {
        assert!(render_text("A".repeat(6000), None).is_err());
    }

    #[test]
    fn ragged_and_oversized_ipc_frames_are_rejected() {
        let mut spec = MessageSpec {
            frames: vec![blank_frame(44)],
            mode: Mode::Fixed,
            speed: 4,
            blink: false,
            ants: false,
        };
        spec.frames[0][0].push(true);
        assert!(to_messages(&[spec], Firmware::default()).is_err());
        let spec = MessageSpec {
            frames: vec![blank_frame(protocol::MAX_BYTE_COLUMNS * 8 + 1)],
            mode: Mode::Fixed,
            speed: 4,
            blink: false,
            ants: false,
        };
        assert!(to_messages(&[spec], Firmware::default()).is_err());
    }

    fn blank_frame(width: usize) -> Vec<Vec<bool>> {
        vec![vec![false; width]; protocol::BADGE_HEIGHT]
    }

    #[test]
    fn animation_mode_builds_a_filmstrip() {
        let spec = MessageSpec {
            frames: vec![blank_frame(44), blank_frame(44), blank_frame(44)],
            mode: Mode::Animation,
            speed: 8,
            blink: false,
            ants: false,
        };
        let msgs = to_messages(&[spec], Firmware::default()).unwrap();
        // 3 frames padded to 48px = 144px = 18 byte columns
        assert_eq!(msgs[0].columns, 18);
    }

    #[test]
    fn non_animation_modes_use_only_the_first_frame() {
        let spec = MessageSpec {
            frames: vec![blank_frame(80), blank_frame(44)],
            mode: Mode::ScrollLeft,
            speed: 4,
            blink: false,
            ants: false,
        };
        let msgs = to_messages(&[spec], Firmware::default()).unwrap();
        assert_eq!(
            msgs[0].columns, 10,
            "80px = 10 byte columns, second frame ignored"
        );
    }

    #[test]
    fn an_unknown_face_falls_back_to_the_default() {
        let a = render_text("HI".into(), Some("no-such-face".into())).unwrap();
        let b = render_text("HI".into(), None).unwrap();
        assert_eq!(a.rows, b.rows, "a stale face id must not blank the stamp");
    }

    #[test]
    fn render_text_round_trips_through_the_font() {
        let out = render_text("HI".into(), None).unwrap();
        assert_eq!(out.columns, 2);
        assert_eq!(out.width, 16);
        assert_eq!(out.rows.len(), protocol::BADGE_HEIGHT);
        assert!(out.missing.is_empty());
        // 'H' crossbar row 5 = 0xFE = 7 lit pixels then dark
        assert_eq!(
            out.rows[5][0..8].to_vec(),
            vec![true, true, true, true, true, true, true, false]
        );
    }

    #[test]
    fn empty_input_is_rejected_with_a_readable_message() {
        assert!(encode(&[], 100, Firmware::default()).is_err());
    }
}
