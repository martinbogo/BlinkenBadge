fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "render_text",
            "font_metrics",
            "pick_image",
            "ble_scan",
            "usb_find",
            "send_to_badge",
            "send_to_badge_usb",
            "pick_open",
            "mobile_import",
            "mobile_export",
            "pick_save",
            "read_text",
            "write_text",
            "recovery_write",
            "recovery_read",
            "recovery_clear",
            "recent_list",
            "recent_clear",
            "take_pending_files",
            "confirm_exit",
        ]),
    ))
    .expect("Could not build application permissions");
}
