//! Desktop launcher for the Fairlight Live Web Controller.
//!
//! It runs the same `apps/server/dist/main.js` the console scripts and the container run, as
//! a child process with its stdin held open, and shows the address to open on a tablet. The
//! mixer page itself stays in a browser: this window is a launcher, not a container for it.

mod bridge;
mod cli;
mod commands;
mod net;
mod server;
mod settings;
mod tray;

use commands::LauncherState;
use settings::LoadOutcome;
use std::sync::{Arc, Mutex};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

/// Builds and runs the launcher.
pub fn run() {
    let options = cli::parse_args(std::env::args().skip(1));

    tauri::Builder::default()
        // single-instance has to be registered first: it is what decides whether this process
        // is the one that keeps running at all.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            commands::show_window(app);
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        // The startup entry launches the executable with no arguments on purpose. Whether a
        // login start shows the window or only the tray icon is decided by the saved
        // `Start hidden in the tray` setting, the same way it is for a start from the Start
        // menu -- one checkbox, one answer, however the launcher was started.
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            commands::launcher_state,
            commands::apply_settings,
            commands::open_in_browser,
            commands::hide_window,
            commands::set_autostart,
            commands::set_start_hidden,
            commands::quit,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            let settings_path = bridge::settings_path(&handle)?;
            let (mut launcher_settings, outcome) = settings::load(&settings_path);
            // A development-only override, so the launcher can be tried out without taking
            // the port a checkout's `pnpm dev` is already using.
            if let Some(port) = options.port {
                launcher_settings.port = port;
            }

            let supervisor = Arc::new(bridge::build_supervisor(
                handle.clone(),
                bridge::log_path(&handle)?,
            ));
            app.manage(Arc::new(LauncherState {
                settings: Mutex::new(launcher_settings),
                settings_path,
                supervisor: Arc::clone(&supervisor),
                notice: notice_for(&outcome),
            }));

            tray::build(&handle)?;

            let plan = bridge::launch_plan(&handle, &launcher_settings)?;
            let generation = supervisor.start(&plan);
            bridge::supervise(Arc::clone(&supervisor), generation);

            if !launcher_settings.start_hidden && !options.hidden {
                commands::show_window(&handle);
            }
            Ok(())
        })
        // The close button hides; only the tray's Exit and the window's Exit button quit.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the launcher")
        .run(|app, event| {
            // Whatever route the launcher takes out -- the tray's Exit, a session ending, a
            // shutdown -- the child is stopped before this process goes away. If the process
            // never gets here, because it crashed or was killed, the child still exits: its
            // stdin pipe dies with us.
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app.state::<Arc<LauncherState>>().supervisor.stop();
            }
        });
}

fn notice_for(outcome: &LoadOutcome) -> Option<String> {
    match outcome {
        LoadOutcome::Loaded | LoadOutcome::Missing => None,
        LoadOutcome::Unreadable(detail) => Some(format!(
            "Could not read launcher.json, using defaults: {detail}"
        )),
        LoadOutcome::Unusable(detail) => Some(format!(
            "launcher.json was not usable, using defaults: {detail}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_healthy_settings_file_produces_no_notice() {
        assert_eq!(notice_for(&LoadOutcome::Loaded), None);
        // A first run has no file yet; that is normal, not something to report.
        assert_eq!(notice_for(&LoadOutcome::Missing), None);
    }

    #[test]
    fn a_damaged_settings_file_says_so() {
        let notice =
            notice_for(&LoadOutcome::Unusable("expected value".to_owned())).expect("a notice");
        assert!(notice.contains("using defaults"));
        assert!(notice.contains("expected value"));

        let notice =
            notice_for(&LoadOutcome::Unreadable("access denied".to_owned())).expect("a notice");
        assert!(notice.contains("access denied"));
    }
}
