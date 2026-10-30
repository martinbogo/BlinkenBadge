//! Mobile hosts use Bluetooth until native USB host integration is available.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct UsbInfo {
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub firmware: crate::firmware::Firmware,
}

pub fn find() -> Result<Option<UsbInfo>, String> {
    Ok(None)
}

pub fn send(_: &[u8], _: impl FnMut(usize, usize) + Send + 'static) -> Result<usize, String> {
    Err("USB transfers are unavailable in this mobile build; use Bluetooth.".into())
}
