//! Everything the window can ask for, plus the same actions as plain functions so the tray
//! menu can call them without going through IPC.

use crate::bridge::{self, AppSupervisor};
use crate::net;
use crate::server::state::ServerState;
use crate::server::LOG_RING_LINES;
use crate::settings::{self, LauncherSettings};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_opener::OpenerExt;

/// The window's label, and the only window there is.
pub const MAIN_WINDOW: &str = "main";

pub struct LauncherState {
    /// `LauncherSettings` is `Copy`, so this lock is never held across a call into the
    /// supervisor -- which matters, because a restart emits state changes that come back
    /// through the tray and read the settings again.
    pub settings: Mutex<LauncherSettings>,
    pub settings_path: PathBuf,
    pub supervisor: Arc<AppSupervisor>,
    /// A one-line explanation shown above the log when the settings file could not be used.
    pub notice: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStateDto {
    settings: LauncherSettings,
    server: ServerState,
    local_url: String,
    lan_url: Option<String>,
    autostart_enabled: bool,
    log: Vec<String>,
    notice: Option<String>,
}

fn launcher(app: &AppHandle) -> State<'_, Arc<LauncherState>> {
    app.state::<Arc<LauncherState>>()
}

pub fn current_settings(app: &AppHandle) -> LauncherSettings {
    *launcher(app).settings.lock().expect("settings")
}

/// The IPv4 interfaces of this machine, as the pure picker in `net` wants them.
fn interfaces() -> Vec<net::Interface> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| {
            let is_loopback = interface.is_loopback();
            match interface.addr {
                if_addrs::IfAddr::V4(v4) => Some(net::Interface {
                    name: interface.name,
                    address: v4.ip,
                    is_loopback,
                }),
                if_addrs::IfAddr::V6(_) => None,
            }
        })
        .collect()
}

fn urls(app: &AppHandle) -> net::Urls {
    let settings = current_settings(app);
    net::urls(
        settings.port,
        settings.bind_lan,
        net::pick_lan_ipv4(&interfaces()),
    )
}

/// The address worth showing on the tray: the one a tablet can use, if there is one.
pub fn best_url(app: &AppHandle) -> Option<String> {
    let urls = urls(app);
    urls.lan.or(Some(urls.local))
}

pub fn show_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn hide_window_now(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.hide();
    }
}

pub fn open_in_browser_now(app: &AppHandle) {
    // localhost rather than the LAN address: this opens a browser on the machine the
    // launcher is running on, where loopback always works even with bind_lan off.
    let url = format!("{}/", urls(app).local);
    let _ = app.opener().open_url(url, None::<&str>);
}

/// Stops the backend and then exits. Deliberately synchronous: the process must not go away
/// before its child has, or the child's stdin pipe would be the only thing stopping it.
pub fn quit_now(app: &AppHandle) {
    launcher(app).supervisor.stop();
    app.exit(0);
}

#[tauri::command]
pub fn launcher_state(app: AppHandle) -> LauncherStateDto {
    let state = launcher(&app);
    let urls = urls(&app);
    LauncherStateDto {
        settings: current_settings(&app),
        server: state.supervisor.state(),
        local_url: urls.local,
        lan_url: urls.lan,
        autostart_enabled: app.autolaunch().is_enabled().unwrap_or(false),
        log: state.supervisor.log_tail(LOG_RING_LINES),
        notice: state.notice.clone(),
    }
}

#[tauri::command]
pub async fn apply_settings(app: AppHandle, settings: LauncherSettings) -> Result<(), String> {
    if !settings.is_valid() {
        return Err(format!("port {} is not usable", settings.port));
    }

    let state = Arc::clone(&launcher(&app));
    let previous = {
        let mut held = state.settings.lock().expect("settings");
        let previous = *held;
        *held = settings;
        previous
    };

    settings::save(&state.settings_path, &settings)
        .map_err(|error| format!("could not save the settings: {error}"))?;

    // Only the two things the backend is started with are worth a restart; start_hidden is
    // read at startup and nowhere else.
    if previous.port == settings.port && previous.bind_lan == settings.bind_lan {
        return Ok(());
    }

    let plan = bridge::launch_plan(&app, &settings).map_err(|error| error.to_string())?;
    // Restarting waits out the old process's graceful exit, which is why it does not run on
    // the thread answering IPC.
    tauri::async_runtime::spawn_blocking(move || {
        let generation = state.supervisor.restart(&plan);
        bridge::supervise(Arc::clone(&state.supervisor), generation);
    })
    .await
    .map_err(|error| format!("the restart did not complete: {error}"))
}

#[tauri::command]
pub fn open_in_browser(app: AppHandle) {
    open_in_browser_now(&app);
}

#[tauri::command]
pub fn hide_window(app: AppHandle) {
    hide_window_now(&app);
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let autostart = app.autolaunch();
    let outcome = if enabled {
        autostart.enable()
    } else {
        autostart.disable()
    };
    outcome.map_err(|error| format!("could not change the startup entry: {error}"))?;
    Ok(autostart.is_enabled().unwrap_or(enabled))
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    quit_now(&app);
}
