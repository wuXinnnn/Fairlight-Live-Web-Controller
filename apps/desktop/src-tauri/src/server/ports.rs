//! The seams between the supervisor's state machine and the world it runs in.
//!
//! Nothing in this file -- or in state.rs, ring.rs and mod.rs -- may refer to `tauri`. That is
//! what lets the whole state machine be unit tested with fakes, on any platform, with no
//! AppHandle, no real process and no real clock. The real implementations live in bridge.rs.

use super::state::ServerState;
use std::path::PathBuf;

/// Everything that varies between one launch and the next.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LaunchPlan {
    pub host: String,
    pub port: u16,
    pub web_root: PathBuf,
    pub data_dir: PathBuf,
}

impl LaunchPlan {
    /// The backend's side of the contract from Phase 7.1. Everything else in the environment
    /// is inherited, which is how EMBER_HOST / EMBER_PORT reach it when someone sets them.
    ///
    /// `PORT` is formatted from a `u16`, so it is always a decimal number: the backend does
    /// not validate it, and a non-numeric value would silently make it listen on a random
    /// port instead of failing.
    pub fn environment(&self) -> Vec<(&'static str, String)> {
        vec![
            ("HOST", self.host.clone()),
            ("PORT", self.port.to_string()),
            ("FLWC_WEB_ROOT", self.web_root.display().to_string()),
            ("FLWC_DATA_DIR", self.data_dir.display().to_string()),
            ("FLWC_EXIT_ON_STDIN_CLOSE", "1".to_owned()),
            ("NODE_ENV", "production".to_owned()),
        ]
    }
}

/// A running backend process.
///
/// There is no blocking `wait`: the handle lives behind the supervisor's mutex, and blocking
/// on it would hold that lock for as long as the backend runs.
pub trait ChildHandle: Send + 'static {
    /// Drops the write end of the pipe. The backend is started with
    /// `FLWC_EXIT_ON_STDIN_CLOSE=1`, so EOF here is what asks it to shut down gracefully --
    /// and it is also what happens by itself if the launcher crashes or is killed.
    fn close_stdin(&mut self);
    /// `None` while it is still running; `Some(code)` once it has exited, where `code` is
    /// `None` if it was terminated rather than exiting on its own.
    fn try_wait(&mut self) -> Option<Option<i32>>;
    fn kill(&mut self);
    /// The backend's log, one line at a time, ending when the process does. It is not a pipe:
    /// the backend writes straight to its log file and this reads that file (see bridge.rs).
    fn take_output(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>>;
}

pub trait ProcessSpawner: Send + Sync + 'static {
    fn spawn(&self, plan: &LaunchPlan) -> Result<Box<dyn ChildHandle>, String>;
}

pub trait HealthProbe: Send + Sync + 'static {
    /// One blocking `GET http://127.0.0.1:{port}/api/v1/health`; true when it answers 200
    /// with `{"status":"ok"}`. Its own timeout must be shorter than HEALTH_POLL_MS or the
    /// polling cadence slips.
    fn probe(&self, port: u16) -> bool;
}

pub trait EventSink: Send + Sync + 'static {
    fn state_changed(&self, state: &ServerState);
    fn log_line(&self, line: &str);
}

pub trait Clock: Send + Sync + 'static {
    /// Monotonic milliseconds; only differences are ever used.
    fn now_ms(&self) -> u64;
    fn sleep_ms(&self, milliseconds: u64);
}

/// Drains a child's output. The real implementation hands each stream to a thread; tests
/// drain it inline so no test needs a thread or a join.
pub trait LogPump: Send + Sync + 'static {
    fn pump(
        &self,
        lines: Box<dyn Iterator<Item = String> + Send>,
        emit: Box<dyn Fn(String) + Send + 'static>,
    );
}
