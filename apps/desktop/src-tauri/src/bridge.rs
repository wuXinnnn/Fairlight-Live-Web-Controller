//! The real implementations behind the supervisor's ports, and the only file in the launcher
//! that both talks to Tauri and touches the operating system.
//!
//! Keeping them here is what lets `server/` be unit tested: nothing under `server/` mentions
//! `tauri`, a process, a socket or a thread.

use crate::server::ports::{
    ChildHandle, Clock, EventSink, HealthProbe, LaunchPlan, LogPump, ProcessSpawner,
};
use crate::server::state::{ServerState, Stream};
use crate::server::{Step, Supervisor, HEALTH_POLL_MS};
use crate::settings::LauncherSettings;
use crate::tray;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::ShellExt;

/// The readiness probe's own timeout. It has to be shorter than HEALTH_POLL_MS or a backend
/// that accepts connections but never answers would stretch the polling cadence.
const HEALTH_REQUEST_TIMEOUT_MS: u64 = 300;

/// On Windows `node.exe` is a console program, and spawning one from a GUI application pops
/// up a console window for as long as it lives. CREATE_NO_WINDOW is what suppresses it.
/// tauri-plugin-shell's sidecar builder already sets this; it is set again below so the
/// guarantee is visible here rather than being a property of a dependency.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Where the launcher keeps its own files. All three are under the OS application-data
/// directories, never next to the executable: an installation under `%LOCALAPPDATA%\Programs`
/// is not somewhere an application should be writing.
pub fn settings_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join("launcher.json"))
}

pub fn data_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("data"))
}

pub fn log_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_log_dir()?.join("server.log"))
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
        web_root: app.path().resolve("web", BaseDirectory::Resource)?,
        data_dir: data_dir(app)?,
    })
}

// --- the child process --------------------------------------------------------------------

/// Yields one line at a time, lossily. pino writes UTF-8 JSON one line at a time, but a
/// dependency writing something else should degrade to mojibake rather than truncate the log.
struct Lines<R: BufRead> {
    reader: R,
    buffer: Vec<u8>,
}

impl<R: BufRead> Iterator for Lines<R> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        self.buffer.clear();
        match self.reader.read_until(b'\n', &mut self.buffer) {
            Ok(0) | Err(_) => None,
            Ok(_) => {
                while matches!(self.buffer.last(), Some(b'\n' | b'\r')) {
                    self.buffer.pop();
                }
                Some(String::from_utf8_lossy(&self.buffer).into_owned())
            }
        }
    }
}

fn lines_of<R: Read + Send + 'static>(stream: R) -> Box<dyn Iterator<Item = String> + Send> {
    Box::new(Lines {
        reader: BufReader::new(stream),
        buffer: Vec::new(),
    })
}

struct RealChild {
    child: Child,
    /// Held for the life of the process. Dropping it closes the pipe, which is the entire
    /// process boundary: the backend runs with FLWC_EXIT_ON_STDIN_CLOSE=1, so EOF here asks
    /// it to shut down -- and the same EOF arrives by itself if the launcher is killed,
    /// crashes, or the user logs out.
    stdin: Option<ChildStdin>,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
}

impl ChildHandle for RealChild {
    fn close_stdin(&mut self) {
        drop(self.stdin.take());
    }

    fn try_wait(&mut self) -> Option<Option<i32>> {
        match self.child.try_wait() {
            Ok(Some(status)) => Some(status.code()),
            // An error here means the handle is unusable; treating it as "gone" is the only
            // thing the supervisor can usefully do with it.
            Ok(None) => None,
            Err(_) => Some(None),
        }
    }

    fn kill(&mut self) {
        let _ = self.child.kill();
        // Reap it, so no zombie is left behind on the platforms that have them.
        let _ = self.child.wait();
    }

    fn take_stdout(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>> {
        self.stdout.take().map(lines_of)
    }

    fn take_stderr(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>> {
        self.stderr.take().map(lines_of)
    }
}

pub struct TauriSpawner {
    app: AppHandle,
}

impl ProcessSpawner for TauriSpawner {
    fn spawn(&self, plan: &LaunchPlan) -> Result<Box<dyn ChildHandle>, String> {
        let main_js = self
            .app
            .path()
            .resolve("server/dist/main.js", BaseDirectory::Resource)
            .map_err(|error| format!("the bundled backend is missing: {error}"))?;

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

        command.arg(main_js);
        for (key, value) in plan.environment() {
            command.env(key, value);
        }
        // Everything else in the environment is inherited on purpose: that is how EMBER_HOST
        // and EMBER_PORT reach the backend when someone has set them.
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("could not start the backend: {error}"))?;

        Ok(Box::new(RealChild {
            stdin: child.stdin.take(),
            stdout: child.stdout.take(),
            stderr: child.stderr.take(),
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

/// One thread per pipe. Both end by themselves when the child closes its end.
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
    stream: Stream,
    line: &'a str,
}

pub struct TauriSink {
    app: AppHandle,
    path: PathBuf,
    /// `None` once opening has failed: the window still gets every line, and a launcher that
    /// cannot write a log file is not a launcher that should refuse to run a desk.
    file: Mutex<Option<File>>,
}

impl TauriSink {
    pub fn new(app: AppHandle, path: PathBuf) -> Self {
        Self {
            app,
            path,
            file: Mutex::new(None),
        }
    }
}

impl EventSink for TauriSink {
    fn run_started(&self) {
        let opened = std::fs::create_dir_all(self.path.parent().unwrap_or(&self.path))
            .and_then(|()| {
                OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&self.path)
            })
            .ok();
        *self.file.lock().expect("log file") = opened;
    }

    fn state_changed(&self, state: &ServerState) {
        let _ = self.app.emit("server-state", state);
        tray::refresh(&self.app, state);
    }

    fn log_line(&self, stream: Stream, line: &str) {
        if let Some(file) = self.file.lock().expect("log file").as_mut() {
            let _ = writeln!(file, "{line}");
        }
        let _ = self.app.emit("server-log", LogEvent { stream, line });
    }
}

// --- wiring -------------------------------------------------------------------------------

pub type AppSupervisor = Supervisor<TauriSpawner, UreqProbe, TauriSink, SystemClock, ThreadPump>;

pub fn build_supervisor(app: AppHandle, log_path: PathBuf) -> AppSupervisor {
    let sink = Arc::new(TauriSink::new(app.clone(), log_path));
    Supervisor::new(
        TauriSpawner { app },
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
