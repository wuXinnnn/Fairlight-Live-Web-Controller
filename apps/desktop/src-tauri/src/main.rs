// Prevents an additional console window on Windows in release. In a debug build the attribute
// is inactive on purpose, so `tauri dev` keeps a console to print panics to.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    flwc_launcher_lib::run()
}
