// 在 Windows 发布构建中隐藏额外的控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    mecha_desktop_lib::run()
}
