//! The tray icon: what the launcher is when its window is hidden.

use crate::commands;
use crate::server::state::ServerState;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

/// Looked up again on every state change, so the tooltip can follow the server.
const TRAY_ID: &str = "launcher";

const MENU_OPEN: &str = "open-in-browser";
const MENU_SHOW: &str = "show-window";
const MENU_EXIT: &str = "exit";

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open in browser", true, None::<&str>)?;
    let show = MenuItem::with_id(app, MENU_SHOW, "Show window", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let exit = MenuItem::with_id(app, MENU_EXIT, "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &show, &separator, &exit])?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("the application icon".into()))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(tooltip(&ServerState::Stopped, None))
        .menu(&menu)
        // Left click shows the window; the menu is the right-click gesture people expect.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            MENU_OPEN => commands::open_in_browser_now(app),
            MENU_SHOW => commands::show_window(app),
            MENU_EXIT => commands::quit_now(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                commands::show_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Called from the event sink on every state change.
pub fn refresh(app: &AppHandle, state: &ServerState) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let address = commands::best_url(app);
    let _ = tray.set_tooltip(Some(tooltip(state, address.as_deref())));
}

fn tooltip(state: &ServerState, address: Option<&str>) -> String {
    let status = match state {
        ServerState::Stopped => "Stopped".to_owned(),
        ServerState::Starting => "Starting\u{2026}".to_owned(),
        ServerState::Running { .. } => match address {
            Some(address) => format!("Running at {address}"),
            None => "Running".to_owned(),
        },
        ServerState::Failed { .. } => "Failed".to_owned(),
    };
    format!("Fairlight Live Web Controller\n{status}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::state::FailureReason;

    #[test]
    fn the_tooltip_names_the_address_while_running() {
        let tooltip = tooltip(
            &ServerState::Running { port: 3000 },
            Some("http://192.168.1.40:3000"),
        );
        assert!(tooltip.contains("Running at http://192.168.1.40:3000"));
    }

    #[test]
    fn the_tooltip_still_says_running_without_an_address() {
        let tooltip = tooltip(&ServerState::Running { port: 3000 }, None);
        assert!(tooltip.ends_with("Running"));
    }

    #[test]
    fn the_other_states_have_their_own_words() {
        assert!(tooltip(&ServerState::Stopped, None).ends_with("Stopped"));
        assert!(tooltip(&ServerState::Starting, None).contains("Starting"));
        let failed = ServerState::Failed {
            reason: FailureReason::ExitedWhileRunning,
            exit_code: Some(1),
            tail: Vec::new(),
        };
        assert!(tooltip(&failed, Some("http://localhost:3000")).ends_with("Failed"));
    }
}
