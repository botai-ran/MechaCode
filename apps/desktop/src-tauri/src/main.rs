// Windows 发布构建时隐藏额外控制台窗口，保持桌面应用启动体验干净。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Tauri 桌面应用的原生入口。
fn main() {
    appsdesktop_lib::run()
}
