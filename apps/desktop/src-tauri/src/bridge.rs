//! The real implementations behind the supervisor's ports, and the only file in the launcher
//! that both talks to Tauri and touches the operating system.
//!
//! Keeping them here is what lets `server/` be unit tested: nothing under `server/` mentions
//! `tauri`, a process, a socket or a thread.

use crate::server::ports::{
    ChildHandle, Clock, EventSink, HealthProbe, LaunchPlan, LogPump, ProcessSpawner,
};
use crate::server::state::ServerState;
use crate::server::{Step, Supervisor, HEALTH_POLL_MS};
use crate::settings::LauncherSettings;
use crate::tray;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// The readiness probe's own timeout. It has to be shorter than HEALTH_POLL_MS or a backend
/// that accepts connections but never answers would stretch the polling cadence.
const HEALTH_REQUEST_TIMEOUT_MS: u64 = 300;

/// How often the log file is checked for new lines while the backend runs.
const LOG_POLL_MS: u64 = 200;

/// On Windows `node.exe` is a console program, and spawning one from a GUI application pops
/// up a console window for as long as it lives. CREATE_NO_WINDOW is what suppresses it.
/// tauri-plugin-shell's sidecar builder already sets this; it is set again below so the
/// guarantee is visible here rather than being a property of a dependency.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Takes the verbatim prefix off a Windows path.
///
/// `PathResolver` canonicalises, which on Windows yields `\\?\F:\...`. Node reads that as a
/// UNC share and tries to stat `F:`, so every path handed to the child -- as an argument or
/// in its environment -- has to be a plain one. Only drive paths are touched: a genuine
/// `\\?\UNC\server\share` needs its prefix. No path on another platform starts with this, so
/// it is a no-op there rather than something to compile out.
fn simplified(path: PathBuf) -> PathBuf {
    match path.to_str().and_then(strip_verbatim_prefix) {
        Some(plain) => PathBuf::from(plain),
        None => path,
    }
}

fn strip_verbatim_prefix(path: &str) -> Option<&str> {
    let rest = path.strip_prefix(r"\\?\")?;
    let bytes = rest.as_bytes();
    let is_drive = bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    is_drive.then_some(rest)
}

/// Where the launcher keeps its own files. All three are under the OS application-data
/// directories, never next to the executable: an installation under `%LOCALAPPDATA%\Programs`
/// is not somewhere an application should be writing.
pub fn settings_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(simplified(app.path().app_config_dir()?).join("launcher.json"))
}

pub fn data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(simplified(app.path().app_data_dir()?).join("data"))
}

pub fn log_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(simplified(app.path().app_log_dir()?).join("server.log"))
}

/// The environment the backend is started with, for these settings.
pub fn launch_plan(app: &AppHandle, settings: &LauncherSettings) -> tauri::Result<LaunchPlan> {
    Ok(LaunchPlan {
        host: if settings.bind_lan {
            "0.0.0.0".to_owned()
        } else {
            "127.0.0.1".to_owned()
        },
        port: settings.port,
        web_root: simplified(app.path().resolve("web", BaseDirectory::Resource)?),
        data_dir: data_dir(app)?,
    })
}

// --- the log file -------------------------------------------------------------------------

/// Reads whole lines out of a file as they are appended, and stops once `writing` is cleared.
///
/// The backend's output goes straight into its log file rather than through a pipe, and this
/// is what puts it in front of the window. Measured on this machine: with stdout and stderr
/// piped, a launcher killed outright leaves the backend blocked and alive indefinitely -- the
/// HTTP server closes, but the process never exits, and not even its own shutdown timeout
/// gets it out. Writing to a file instead, the same kill has the backend gone in about
/// 250 ms. The log is better this way too: it is complete even for the crash that took the
/// launcher with it.
struct LogTail {
    file: File,
    partial: Vec<u8>,
    ready: Vec<String>,
    writing: Arc<AtomicBool>,
    finished: bool,
}

impl LogTail {
    fn open(path: &Path, writing: Arc<AtomicBool>) -> Option<Self> {
        Some(Self {
            file: File::open(path).ok()?,
            partial: Vec::new(),
            ready: Vec::new(),
            writing,
            finished: false,
        })
    }

    /// Appends whatever has arrived since the last read and splits off the complete lines.
    fn drain(&mut self) {
        let mut chunk = Vec::new();
        if self.file.read_to_end(&mut chunk).is_err() || chunk.is_empty() {
            return;
        }
        self.partial.extend_from_slice(&chunk);
        while let Some(end) = self.partial.iter().position(|byte| *byte == b'\n') {
            let mut line: Vec<u8> = self.partial.drain(..=end).collect();
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            // Lossy: pino writes UTF-8, but a dependency writing something else should show
            // up as mojibake rather than truncate the log.
            self.ready.push(String::from_utf8_lossy(&line).into_owned());
        }
    }
}

impl Iterator for LogTail {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        loop {
            if !self.ready.is_empty() {
                return Some(self.ready.remove(0));
            }
            if self.finished {
                return None;
            }
            // Read the flag first, then the file: whatever the backend wrote on its way out
            // is already on disk by the time the process is gone, so this last pass sees it.
            let writing = self.writing.load(Ordering::SeqCst);
            self.drain();
            if !writing {
                self.finished = true;
            } else if self.ready.is_empty() {
                std::thread::sleep(Duration::from_millis(LOG_POLL_MS));
            }
        }
    }
}

/// Truncates the log and hands back two append handles, one per stream. Append mode is what
/// keeps the two of them from overwriting each other's lines.
fn open_log(path: &Path) -> Result<(File, File), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create the log directory: {error}"))?;
    }
    File::create(path).map_err(|error| format!("could not create the log file: {error}"))?;
    let open = || {
        OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|error| format!("could not open the log file: {error}"))
    };
    Ok((open()?, open()?))
}

// --- the child process --------------------------------------------------------------------

struct RealChild {
    child: Child,
    /// Held for the life of the process. Dropping it closes the pipe, which is the entire
    /// process boundary: the backend runs with FLWC_EXIT_ON_STDIN_CLOSE=1, so EOF here asks
    /// it to shut down -- and the same EOF arrives by itself if the launcher is killed,
    /// crashes, or the user logs out.
    stdin: Option<ChildStdin>,
    /// Cleared once the process is known to be gone, which is what ends the log tail.
    writing: Arc<AtomicBool>,
    output: Option<LogTail>,
}

impl ChildHandle for RealChild {
    fn close_stdin(&mut self) {
        drop(self.stdin.take());
    }

    fn try_wait(&mut self) -> Option<Option<i32>> {
        match self.child.try_wait() {
            Ok(None) => None,
            Ok(Some(status)) => {
                self.writing.store(false, Ordering::SeqCst);
                Some(status.code())
            }
            // An error here means the handle is unusable; treating it as "gone" is the only
            // thing the supervisor can usefully do with it.
            Err(_) => {
                self.writing.store(false, Ordering::SeqCst);
                Some(None)
            }
        }
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        // Reap it, so no zombie is left behind on the platforms that have them.
        let _ = self.child.wait();
        self.writing.store(false, Ordering::SeqCst);
    }

    fn take_output(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>> {
        self.output
            .take()
            .map(|tail| Box::new(tail) as Box<dyn Iterator<Item = String> + Send>)
    }
}

pub struct TauriSpawner {
    app: AppHandle,
    log_path: PathBuf,
}

impl ProcessSpawner for TauriSpawner {
    fn spawn(&self, plan: &LaunchPlan) -> Result<Box<dyn ChildHandle>, String> {
        let main_js = simplified(
            self.app
                .path()
                .resolve("server/dist/main.js", BaseDirectory::Resource)
                .map_err(|error| format!("the bundled backend is missing: {error}"))?,
        );

        // The sidecar builder is used for what it resolves -- the executable next to our own,
        // with the platform's extension -- and then handed over as a plain std Command, so we
        // own the child and can close its stdin without giving up the handle. Its own
        // CommandChild can only close stdin by being dropped, which would also drop kill().
        let mut command: Command = self
            .app
            .shell()
            .sidecar("node")
            .map_err(|error| format!("the bundled Node runtime is missing: {error}"))?
            .into();

        let (out, err) = open_log(&self.log_path)?;

        command.arg(main_js);
        for (key, value) in plan.environment() {
            command.env(key, value);
        }
        // Everything else in the environment is inherited on purpose: that is how EMBER_HOST
        // and EMBER_PORT reach the backend when someone has set them.
        //
        // stdin is the only pipe; see LogTail for why the output goes to a file instead.
        command.stdin(Stdio::piped());
        command.stdout(Stdio::from(out));
        command.stderr(Stdio::from(err));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("could not start the backend: {error}"))?;

        let writing = Arc::new(AtomicBool::new(true));
        Ok(Box::new(RealChild {
            stdin: child.stdin.take(),
            output: LogTail::open(&self.log_path, Arc::clone(&writing)),
            writing,
            child,
        }))
    }
}

// --- the readiness probe --------------------------------------------------------------------

pub struct UreqProbe {
    agent: ureq::Agent,
}

impl Default for UreqProbe {
    fn default() -> Self {
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(Duration::from_millis(HEALTH_REQUEST_TIMEOUT_MS)))
            .build();
        Self {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl HealthProbe for UreqProbe {
    fn probe(&self, port: u16) -> bool {
        // Always loopback, whatever the backend is bound to: this asks whether our own child
        // is up, not whether the network can see it.
        let url = format!("http://127.0.0.1:{port}/api/v1/health");
        let Ok(mut response) = self.agent.get(&url).call() else {
            return false;
        };
        if response.status() != 200 {
            return false;
        }
        let Ok(body) = response.body_mut().read_to_string() else {
            return false;
        };
        serde_json::from_str::<serde_json::Value>(&body)
            .map(|value| value.get("status").and_then(|s| s.as_str()) == Some("ok"))
            .unwrap_or(false)
    }
}

// --- the clock and the log pump ---------------------------------------------------------

pub struct SystemClock {
    base: Instant,
}

impl Default for SystemClock {
    fn default() -> Self {
        Self {
            base: Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        self.base.elapsed().as_millis() as u64
    }

    fn sleep_ms(&self, milliseconds: u64) {
        std::thread::sleep(Duration::from_millis(milliseconds));
    }
}

/// One thread for the log tail. It ends by itself once the backend is gone.
pub struct ThreadPump;

impl LogPump for ThreadPump {
    fn pump(
        &self,
        lines: Box<dyn Iterator<Item = String> + Send>,
        emit: Box<dyn Fn(String) + Send + 'static>,
    ) {
        std::thread::spawn(move || {
            for line in lines {
                emit(line);
            }
        });
    }
}

// --- the sink -----------------------------------------------------------------------------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LogEvent<'a> {
    line: &'a str,
}

pub struct TauriSink {
    app: AppHandle,
}

impl EventSink for TauriSink {
    fn state_changed(&self, state: &ServerState) {
        let _ = self.app.emit("server-state", state);
        tray::refresh(&self.app, state);
    }

    fn log_line(&self, line: &str) {
        let _ = self.app.emit("server-log", LogEvent { line });
    }
}

// --- wiring -------------------------------------------------------------------------------

pub type AppSupervisor = Supervisor<TauriSpawner, UreqProbe, TauriSink, SystemClock, ThreadPump>;

pub fn build_supervisor(app: AppHandle, log_path: PathBuf) -> AppSupervisor {
    let sink = Arc::new(TauriSink { app: app.clone() });
    Supervisor::new(
        TauriSpawner { app, log_path },
        UreqProbe::default(),
        sink,
        SystemClock::default(),
        ThreadPump,
    )
}

/// Runs the state machine until this generation is finished. This loop is the only part of
/// the supervisor that is not exercised by a unit test, and it is deliberately trivial.
pub fn supervise(supervisor: Arc<AppSupervisor>, generation: u64) {
    std::thread::spawn(move || {
        while supervisor.tick(generation) == Step::Continue {
            std::thread::sleep(Duration::from_millis(HEALTH_POLL_MS));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn a_verbatim_drive_path_loses_its_prefix() {
        assert_eq!(
            simplified(PathBuf::from(r"\\?\F:\app\dist\main.js")),
            PathBuf::from(r"F:\app\dist\main.js")
        );
    }

    #[test]
    fn a_plain_path_is_left_alone() {
        for path in [
            r"F:\app\dist\main.js",
            "/opt/app/dist/main.js",
            "relative/main.js",
        ] {
            assert_eq!(simplified(PathBuf::from(path)), PathBuf::from(path));
        }
    }

    #[test]
    fn a_verbatim_unc_path_keeps_its_prefix() {
        // Stripping this one would turn a valid share path into nonsense.
        let unc = r"\\?\UNC\server\share\main.js";
        assert_eq!(simplified(PathBuf::from(unc)), PathBuf::from(unc));
        assert_eq!(strip_verbatim_prefix(unc), None);
    }

    fn scratch(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("flwc-tail-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("scratch directory");
        dir.join("server.log")
    }

    #[test]
    fn the_tail_yields_complete_lines_and_stops_with_the_process() {
        let path = scratch("lines");
        let (mut out, _err) = open_log(&path).expect("log");
        let writing = Arc::new(AtomicBool::new(true));
        let mut tail = LogTail::open(&path, Arc::clone(&writing)).expect("tail");

        writeln!(out, "first").expect("write");
        // A half-written line is held back until its newline arrives.
        write!(out, "sec").expect("write");
        assert_eq!(tail.next(), Some("first".to_owned()));

        writeln!(out, "ond").expect("write");
        assert_eq!(tail.next(), Some("second".to_owned()));

        // What the backend wrote on its way out is still picked up.
        writeln!(out, "goodbye").expect("write");
        writing.store(false, Ordering::SeqCst);
        assert_eq!(tail.next(), Some("goodbye".to_owned()));
        assert_eq!(tail.next(), None);
    }

    #[test]
    fn both_log_handles_append_rather_than_overwrite() {
        let path = scratch("append");
        let (mut out, mut err) = open_log(&path).expect("log");
        writeln!(out, "from stdout").expect("write");
        writeln!(err, "from stderr").expect("write");
        assert_eq!(
            std::fs::read_to_string(&path).expect("read"),
            "from stdout\nfrom stderr\n"
        );
    }

    #[test]
    fn opening_the_log_truncates_the_previous_run() {
        let path = scratch("truncate");
        let (mut out, _err) = open_log(&path).expect("log");
        writeln!(out, "old run").expect("write");
        drop(out);

        let (_out, _err) = open_log(&path).expect("log");
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "");
    }
}
