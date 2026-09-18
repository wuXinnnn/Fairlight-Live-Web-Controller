//! The backend process, from spawn to exit.
//!
//! The state machine is a synchronous `tick()` that can be stepped one call at a time. At
//! runtime a thread does `while tick() == Continue { sleep(HEALTH_POLL_MS) }`; in tests the
//! same `tick()` is called directly, so every path below is covered without a real process, a
//! real socket, a real clock or a thread.
//!
//! The launcher never restarts the backend by itself. Phase 7.1 made the same call for the
//! console scripts: a backend that keeps dying should show the user why, not hide it behind a
//! restart loop.

pub mod ports;
pub mod ring;
pub mod state;

use ports::{ChildHandle, Clock, EventSink, HealthProbe, LaunchPlan, LogPump, ProcessSpawner};
use ring::LogRing;
use state::{FailureReason, ServerState, Stream};
use std::sync::{Arc, Mutex};

/// How often the readiness probe runs, and how long it may keep failing. Phase 7.1 measured
/// spawn-to-healthy at a little over a second; 30 s is generous enough that a slow first run
/// on a cold disk is not reported as a failure.
pub const HEALTH_POLL_MS: u64 = 500;
pub const HEALTH_TIMEOUT_MS: u64 = 30_000;

/// How long a graceful shutdown is given after stdin closes, and how often it is checked.
/// The backend's own SHUTDOWN_TIMEOUT_MS is 5000 and it was measured exiting in 9 ms; this is
/// the same budget plus the freedom to stop waiting as soon as it is gone.
pub const EXIT_WAIT_MS: u64 = 5_000;
pub const EXIT_POLL_MS: u64 = 100;

/// How many log lines are kept in memory for the window, and how many travel with a failure.
pub const LOG_RING_LINES: usize = 500;
pub const FAILURE_TAIL_LINES: usize = 20;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Step {
    Continue,
    Done,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Idle,
    WaitingReady { started_at_ms: u64 },
    Up,
}

/// The log lines and whoever wants to hear about them, shared between the supervisor and the
/// threads draining the child's pipes.
pub struct LogHub<Ev: EventSink> {
    ring: Mutex<LogRing>,
    sink: Arc<Ev>,
}

impl<Ev: EventSink> LogHub<Ev> {
    fn new(sink: Arc<Ev>) -> Self {
        Self {
            ring: Mutex::new(LogRing::new(LOG_RING_LINES)),
            sink,
        }
    }

    fn record(&self, stream: Stream, line: String) {
        self.ring.lock().expect("log ring").push(line.clone());
        self.sink.log_line(stream, &line);
    }

    fn tail(&self, count: usize) -> Vec<String> {
        self.ring.lock().expect("log ring").tail(count)
    }

    fn clear(&self) {
        self.ring.lock().expect("log ring").clear();
    }
}

struct Inner {
    state: ServerState,
    child: Option<Box<dyn ChildHandle>>,
    phase: Phase,
    port: u16,
    /// Bumped by every start, stop and failure. A tick names the generation it was started
    /// for, so a supervisor thread left over from a previous run stops instead of reporting
    /// on a process that is no longer the current one.
    generation: u64,
}

pub struct Supervisor<Sp, Pr, Ev, Cl, Lp>
where
    Sp: ProcessSpawner,
    Pr: HealthProbe,
    Ev: EventSink,
    Cl: Clock,
    Lp: LogPump,
{
    spawner: Sp,
    probe: Pr,
    clock: Cl,
    pump: Lp,
    hub: Arc<LogHub<Ev>>,
    inner: Mutex<Inner>,
}

impl<Sp, Pr, Ev, Cl, Lp> Supervisor<Sp, Pr, Ev, Cl, Lp>
where
    Sp: ProcessSpawner,
    Pr: HealthProbe,
    Ev: EventSink,
    Cl: Clock,
    Lp: LogPump,
{
    pub fn new(spawner: Sp, probe: Pr, sink: Arc<Ev>, clock: Cl, pump: Lp) -> Self {
        Self {
            spawner,
            probe,
            clock,
            pump,
            hub: Arc::new(LogHub::new(sink)),
            inner: Mutex::new(Inner {
                state: ServerState::Stopped,
                child: None,
                phase: Phase::Idle,
                port: 0,
                generation: 0,
            }),
        }
    }

    pub fn state(&self) -> ServerState {
        self.inner.lock().expect("supervisor").state.clone()
    }

    pub fn log_tail(&self, count: usize) -> Vec<String> {
        self.hub.tail(count)
    }

    /// Starts the backend and returns the generation to tick for.
    pub fn start(&self, plan: &LaunchPlan) -> u64 {
        // Each run gets a clean log: the window shows the current process, not the last one.
        self.hub.clear();
        self.hub.sink.run_started();

        // Spawning and draining happen outside the lock, so nothing that can block or call
        // back into the app is done while the supervisor state is held.
        let spawned = self.spawner.spawn(plan);

        let (generation, state) = match spawned {
            Ok(mut child) => {
                self.attach_streams(&mut child);
                let started_at_ms = self.clock.now_ms();
                let mut inner = self.inner.lock().expect("supervisor");
                inner.generation += 1;
                inner.port = plan.port;
                inner.child = Some(child);
                inner.phase = Phase::WaitingReady { started_at_ms };
                inner.state = ServerState::Starting;
                (inner.generation, ServerState::Starting)
            }
            Err(message) => {
                self.hub.record(Stream::Stderr, message);
                let failed = ServerState::Failed {
                    reason: FailureReason::SpawnFailed,
                    exit_code: None,
                    tail: self.hub.tail(FAILURE_TAIL_LINES),
                };
                let mut inner = self.inner.lock().expect("supervisor");
                inner.generation += 1;
                inner.port = plan.port;
                inner.child = None;
                inner.phase = Phase::Idle;
                inner.state = failed.clone();
                (inner.generation, failed)
            }
        };

        self.hub.sink.state_changed(&state);
        generation
    }

    /// One step of the state machine. `Done` means this generation is finished and the
    /// supervising thread should stop.
    pub fn tick(&self, generation: u64) -> Step {
        let (phase, port, exit) = {
            let mut inner = self.inner.lock().expect("supervisor");
            if inner.generation != generation {
                return Step::Done;
            }
            // try_wait does not block, so it is safe to call while the lock is held.
            let exit = inner.child.as_mut().and_then(|child| child.try_wait());
            (inner.phase, inner.port, exit)
        };

        match (phase, exit) {
            (Phase::Idle, _) => Step::Done,
            (Phase::WaitingReady { .. }, Some(code)) => {
                self.fail(generation, FailureReason::ExitedBeforeReady, code)
            }
            (Phase::Up, Some(code)) => {
                self.fail(generation, FailureReason::ExitedWhileRunning, code)
            }
            (Phase::Up, None) => Step::Continue,
            (Phase::WaitingReady { started_at_ms }, None) => {
                // Probing outside the lock: it is a blocking HTTP call, and holding the lock
                // across it would stall stop() and every window command for its duration.
                if self.probe.probe(port) {
                    self.promote(generation, port)
                } else if self.clock.now_ms().saturating_sub(started_at_ms) >= HEALTH_TIMEOUT_MS {
                    self.kill_current(generation);
                    self.fail(generation, FailureReason::HealthTimeout, None)
                } else {
                    Step::Continue
                }
            }
        }
    }

    /// Closes stdin, waits out EXIT_WAIT_MS, and kills whatever is left.
    ///
    /// Bumping the generation first is what keeps a stop quiet: the supervising thread's next
    /// tick sees a stale generation and returns without reporting the exit as a failure.
    pub fn stop(&self) {
        let mut child = {
            let mut inner = self.inner.lock().expect("supervisor");
            inner.generation += 1;
            inner.phase = Phase::Idle;
            inner.child.take()
        };

        if let Some(child) = child.as_mut() {
            child.close_stdin();
            let deadline = self.clock.now_ms().saturating_add(EXIT_WAIT_MS);
            loop {
                if child.try_wait().is_some() {
                    break;
                }
                if self.clock.now_ms() >= deadline {
                    child.kill();
                    break;
                }
                self.clock.sleep_ms(EXIT_POLL_MS);
            }
        }

        let changed = {
            let mut inner = self.inner.lock().expect("supervisor");
            let changed = inner.state != ServerState::Stopped;
            inner.state = ServerState::Stopped;
            changed
        };
        if changed {
            self.hub.sink.state_changed(&ServerState::Stopped);
        }
    }

    pub fn restart(&self, plan: &LaunchPlan) -> u64 {
        self.stop();
        self.start(plan)
    }

    fn attach_streams(&self, child: &mut Box<dyn ChildHandle>) {
        for (stream, lines) in [
            (Stream::Stdout, child.take_stdout()),
            (Stream::Stderr, child.take_stderr()),
        ] {
            let Some(lines) = lines else { continue };
            let hub = Arc::clone(&self.hub);
            self.pump
                .pump(lines, Box::new(move |line| hub.record(stream, line)));
        }
    }

    fn kill_current(&self, generation: u64) {
        let mut inner = self.inner.lock().expect("supervisor");
        if inner.generation != generation {
            return;
        }
        if let Some(child) = inner.child.as_mut() {
            child.kill();
        }
    }

    fn promote(&self, generation: u64, port: u16) -> Step {
        let running = ServerState::Running { port };
        {
            let mut inner = self.inner.lock().expect("supervisor");
            if inner.generation != generation {
                return Step::Done;
            }
            inner.phase = Phase::Up;
            inner.state = running.clone();
        }
        self.hub.sink.state_changed(&running);
        Step::Continue
    }

    fn fail(&self, generation: u64, reason: FailureReason, exit_code: Option<i32>) -> Step {
        let failed = ServerState::Failed {
            reason,
            exit_code,
            tail: self.hub.tail(FAILURE_TAIL_LINES),
        };
        {
            let mut inner = self.inner.lock().expect("supervisor");
            if inner.generation != generation {
                return Step::Done;
            }
            // The run is over either way, so retire the generation: nothing else should
            // report on it.
            inner.generation += 1;
            inner.child = None;
            inner.phase = Phase::Idle;
            inner.state = failed.clone();
        }
        self.hub.sink.state_changed(&failed);
        Step::Done
    }
}

#[cfg(test)]
mod tests;
