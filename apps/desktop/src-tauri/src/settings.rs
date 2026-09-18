//! The launcher's own settings: which port the backend listens on, whether it is reachable
//! from the network, and whether the window shows itself at startup.
//!
//! Deliberately not where the Ember+ endpoint lives. That belongs to the backend's
//! `config.json` and is edited in the mixer page's CONNECTION panel; duplicating it here would
//! give two places to set one thing.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The only settings-file layout this launcher understands.
pub const SETTINGS_VERSION: u32 = 1;

/// Defaults. The port matches the backend's own default so the address a user already knows
/// keeps working; binding to the network is on because the whole point is to reach the mixer
/// page from a tablet.
pub const DEFAULT_PORT: u16 = 3000;
pub const DEFAULT_BIND_LAN: bool = true;
pub const DEFAULT_START_HIDDEN: bool = false;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherSettings {
    pub version: u32,
    pub port: u16,
    pub bind_lan: bool,
    pub start_hidden: bool,
}

impl Default for LauncherSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            port: DEFAULT_PORT,
            bind_lan: DEFAULT_BIND_LAN,
            start_hidden: DEFAULT_START_HIDDEN,
        }
    }
}

impl LauncherSettings {
    /// Port 0 would make the backend listen on whatever the OS hands out, which the window
    /// could then not print an address for. Everything else in 1..=65535 is the user's call.
    pub fn is_valid(&self) -> bool {
        self.version == SETTINGS_VERSION && self.port > 0
    }
}

/// What `load` had to fall back on, so the caller can log it once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadOutcome {
    Loaded,
    Missing,
    Unreadable(String),
    Unusable(String),
}

/// Reads the settings file, falling back to defaults for anything it cannot use. A launcher
/// that refuses to start because its own settings file is damaged would be worse than one
/// that starts on defaults and says so.
pub fn load(path: &Path) -> (LauncherSettings, LoadOutcome) {
    let text = match fs::read_to_string(path) {
        Ok(text) => text,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return (LauncherSettings::default(), LoadOutcome::Missing)
        }
        Err(error) => {
            return (
                LauncherSettings::default(),
                LoadOutcome::Unreadable(error.to_string()),
            )
        }
    };

    match serde_json::from_str::<LauncherSettings>(&text) {
        Ok(settings) if settings.is_valid() => (settings, LoadOutcome::Loaded),
        Ok(settings) => (
            LauncherSettings::default(),
            LoadOutcome::Unusable(format!(
                "unsupported settings (version {}, port {})",
                settings.version, settings.port
            )),
        ),
        Err(error) => (
            LauncherSettings::default(),
            LoadOutcome::Unusable(error.to_string()),
        ),
    }
}

/// Writes through a temporary file so a crash mid-write cannot leave a half-written settings
/// file behind. `fs::rename` replaces an existing file on every platform this runs on.
pub fn save(path: &Path, settings: &LauncherSettings) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = temporary_path(path);
    fs::write(&temporary, serde_json::to_vec_pretty(settings)?)?;
    fs::rename(&temporary, path)
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    /// A directory of its own per test; `std::fs` is the thing under test, so no helper crate.
    fn scratch(tag: &str) -> PathBuf {
        let dir = env::temp_dir().join(format!("flwc-settings-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    #[test]
    fn missing_file_falls_back_to_defaults() {
        let path = scratch("missing").join("launcher.json");
        let (settings, outcome) = load(&path);
        assert_eq!(settings, LauncherSettings::default());
        assert_eq!(outcome, LoadOutcome::Missing);
    }

    #[test]
    fn damaged_file_falls_back_to_defaults() {
        let path = scratch("damaged").join("launcher.json");
        fs::write(&path, "{ not json").expect("write");
        let (settings, outcome) = load(&path);
        assert_eq!(settings, LauncherSettings::default());
        assert!(matches!(outcome, LoadOutcome::Unusable(_)));
    }

    #[test]
    fn unknown_version_falls_back_to_defaults() {
        let path = scratch("version").join("launcher.json");
        fs::write(
            &path,
            r#"{"version":99,"port":4000,"bindLan":false,"startHidden":true}"#,
        )
        .expect("write");
        let (settings, outcome) = load(&path);
        assert_eq!(settings, LauncherSettings::default());
        assert!(matches!(outcome, LoadOutcome::Unusable(_)));
    }

    #[test]
    fn port_zero_is_rejected() {
        let path = scratch("port-zero").join("launcher.json");
        fs::write(
            &path,
            r#"{"version":1,"port":0,"bindLan":true,"startHidden":false}"#,
        )
        .expect("write");
        let (settings, outcome) = load(&path);
        assert_eq!(settings.port, DEFAULT_PORT);
        assert!(matches!(outcome, LoadOutcome::Unusable(_)));
    }

    #[test]
    fn round_trips_through_the_file() {
        let path = scratch("round-trip").join("nested").join("launcher.json");
        let written = LauncherSettings {
            version: SETTINGS_VERSION,
            port: 3100,
            bind_lan: false,
            start_hidden: true,
        };
        save(&path, &written).expect("save");
        let (read_back, outcome) = load(&path);
        assert_eq!(read_back, written);
        assert_eq!(outcome, LoadOutcome::Loaded);
        assert!(!path.with_file_name("launcher.json.tmp").exists());
    }

    #[test]
    fn saving_twice_replaces_the_file() {
        let path = scratch("replace").join("launcher.json");
        save(&path, &LauncherSettings::default()).expect("first save");
        let second = LauncherSettings {
            port: 4100,
            ..LauncherSettings::default()
        };
        save(&path, &second).expect("second save");
        assert_eq!(load(&path).0, second);
    }
}
