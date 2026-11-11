//! Android owns permissions and GATT callbacks; Rust retains the shared encoder.
use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{PluginHandle, TauriPlugin},
    AppHandle, Manager, Wry,
};

struct Bridge(PluginHandle<Wry>);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BadgeInfo {
    pub id: String,
    pub name: Option<String>,
    pub rssi: Option<i16>,
    pub services: Vec<String>,
}
#[derive(Deserialize)]
struct ScanReply {
    badges: Vec<BadgeInfo>,
}
#[derive(Deserialize)]
struct SendReply {
    bytes: usize,
}

pub fn init() -> TauriPlugin<Wry> {
    tauri::plugin::Builder::new("badge-mobile")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.martin.blinkenbadge", "BadgePlugin")?;
            app.manage(Bridge(handle));
            Ok(())
        })
        .build()
}

pub async fn scan(app: AppHandle, timeout_ms: u64) -> Result<Vec<BadgeInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Bridge>()
            .0
            .run_mobile_plugin::<ScanReply>("scan", serde_json::json!({"timeoutMs": timeout_ms}))
            .map(|reply| reply.badges)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub async fn send(
    app: AppHandle,
    device_id: Option<String>,
    stock: Vec<u8>,
    magic: Vec<u8>,
) -> Result<usize, String> {
    let device_id = device_id.ok_or("Select a badge before sending.")?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<Bridge>()
            .0
            .run_mobile_plugin::<SendReply>(
                "send",
                serde_json::json!({
                    "deviceId": device_id,
                    "stock": base64::engine::general_purpose::STANDARD.encode(stock),
                    "magic": base64::engine::general_purpose::STANDARD.encode(magic)
                }),
            )
            .map(|reply| reply.bytes)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
