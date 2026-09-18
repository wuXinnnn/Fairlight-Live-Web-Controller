//! Every path through the supervisor, driven by hand.
//!
//! No test here starts a process, opens a socket, sleeps or spawns a thread: the fakes below
//! stand in for all four, and `tick()` is called directly instead of by the runtime loop.

use super::ports::{
    ChildHandle, Clock, EventSink, HealthProbe, LaunchPlan, LogPump, ProcessSpawner,
};
use super::state::{FailureReason, ServerState, Stream};
use super::{Step, Supervisor, EXIT_WAIT_MS, HEALTH_POLL_MS, HEALTH_TIMEOUT_MS};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

// --- fakes -------------------------------------------------------------------------------

/// Flags a test can read after the child has been handed to the supervisor.
#[derive(Clone, Default)]
struct ChildFlags {
    stdin_closed: Arc<AtomicBool>,
    killed: Arc<AtomicBool>,
}

struct FakeChild {
    /// How many `try_wait` calls return "still running" before it exits. `None` means never.
    exit_after_polls: Option<u32>,
    exit_code: Option<i32>,
    exits_on_stdin_close: bool,
    polls: u32,
    flags: ChildFlags,
    stdout: Option<Vec<String>>,
    stderr: Option<Vec<String>>,
}

impl FakeChild {
    fn new(flags: ChildFlags) -> Self {
        Self {
            exit_after_polls: None,
            exit_code: Some(0),
            exits_on_stdin_close: true,
            polls: 0,
            flags,
            stdout: None,
            stderr: None,
        }
    }

    fn exiting_after(mut self, polls: u32, code: Option<i32>) -> Self {
        self.exit_after_polls = Some(polls);
        self.exit_code = code;
        self
    }

    fn never_exiting(mut self) -> Self {
        self.exit_after_polls = None;
        self.exits_on_stdin_close = false;
        self
    }

    fn with_stderr(mut self, lines: &[&str]) -> Self {
        self.stderr = Some(lines.iter().map(|line| (*line).to_owned()).collect());
        self
    }

    fn with_stdout(mut self, lines: &[&str]) -> Self {
        self.stdout = Some(lines.iter().map(|line| (*line).to_owned()).collect());
        self
    }
}

impl ChildHandle for FakeChild {
    fn close_stdin(&mut self) {
        self.flags.stdin_closed.store(true, Ordering::SeqCst);
        if self.exits_on_stdin_close {
            // Gone by the very next poll, the way the real backend is: Phase 7.1 measured it
            // exiting 9 ms after EOF.
            self.exit_after_polls = Some(self.polls);
        }
    }

    fn try_wait(&mut self) -> Option<Option<i32>> {
        self.polls += 1;
        match self.exit_after_polls {
            Some(limit) if self.polls > limit => Some(self.exit_code),
            _ => None,
        }
    }

    fn kill(&mut self) {
        self.flags.killed.store(true, Ordering::SeqCst);
        self.exit_after_polls = Some(0);
        self.exit_code = None;
    }

    fn take_stdout(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>> {
        self.stdout
            .take()
            .map(|lines| Box::new(lines.into_iter()) as Box<dyn Iterator<Item = String> + Send>)
    }

    fn take_stderr(&mut self) -> Option<Box<dyn Iterator<Item = String> + Send>> {
        self.stderr
            .take()
            .map(|lines| Box::new(lines.into_iter()) as Box<dyn Iterator<Item = String> + Send>)
    }
}

#[derive(Clone, Default)]
struct FakeSpawner {
    queue: Arc<Mutex<VecDeque<Result<FakeChild, String>>>>,
    plans: Arc<Mutex<Vec<LaunchPlan>>>,
}

impl FakeSpawner {
    fn queue(&self, outcome: Result<FakeChild, String>) {
        self.queue.lock().expect("queue").push_back(outcome);
    }

    fn plans(&self) -> Vec<LaunchPlan> {
        self.plans.lock().expect("plans").clone()
    }
}

impl ProcessSpawner for FakeSpawner {
    fn spawn(&self, plan: &LaunchPlan) -> Result<Box<dyn ChildHandle>, String> {
        self.plans.lock().expect("plans").push(plan.clone());
        match self.queue.lock().expect("queue").pop_front() {
            Some(Ok(child)) => Ok(Box::new(child)),
            Some(Err(message)) => Err(message),
            None => Err("the test queued no child".to_owned()),
        }
    }
}

#[derive(Clone)]
struct ScriptedProbe {
    /// The call number from which the probe starts succeeding. `None` means never.
    ready_from_call: Option<u32>,
    calls: Arc<AtomicU32>,
}

impl ScriptedProbe {
    fn never() -> Self {
        Self {
            ready_from_call: None,
            calls: Arc::new(AtomicU32::new(0)),
        }
    }

    fn ready_from(call: u32) -> Self {
        Self {
            ready_from_call: Some(call),
            calls: Arc::new(AtomicU32::new(0)),
        }
    }

    fn calls(&self) -> u32 {
        self.calls.load(Ordering::SeqCst)
    }
}

impl HealthProbe for ScriptedProbe {
    fn probe(&self, _port: u16) -> bool {
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        matches!(self.ready_from_call, Some(first) if call >= first)
    }
}

/// Time only moves when something sleeps, so a test controls it exactly.
#[derive(Clone, Default)]
struct FakeClock {
    now: Arc<AtomicU64>,
}

impl FakeClock {
    fn advance(&self, milliseconds: u64) {
        self.now.fetch_add(milliseconds, Ordering::SeqCst);
    }
}

impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.now.load(Ordering::SeqCst)
    }

    fn sleep_ms(&self, milliseconds: u64) {
        self.advance(milliseconds);
    }
}

#[derive(Default)]
struct RecordingSink {
    states: Mutex<Vec<ServerState>>,
    lines: Mutex<Vec<(Stream, String)>>,
}

impl RecordingSink {
    fn states(&self) -> Vec<ServerState> {
        self.states.lock().expect("states").clone()
    }

    fn lines(&self) -> Vec<(Stream, String)> {
        self.lines.lock().expect("lines").clone()
    }
}

impl EventSink for RecordingSink {
    fn state_changed(&self, state: &ServerState) {
        self.states.lock().expect("states").push(state.clone());
    }

    fn log_line(&self, stream: Stream, line: &str) {
        self.lines
            .lock()
            .expect("lines")
            .push((stream, line.to_owned()));
    }
}

/// Drains the child's output on the calling thread, so a test never has to join anything.
struct InlinePump;

impl LogPump for InlinePump {
    fn pump(
        &self,
        lines: Box<dyn Iterator<Item = String> + Send>,
        emit: Box<dyn Fn(String) + Send + 'static>,
    ) {
        for line in lines {
            emit(line);
        }
    }
}

// --- harness -----------------------------------------------------------------------------

type TestSupervisor = Supervisor<FakeSpawner, ScriptedProbe, RecordingSink, FakeClock, InlinePump>;

struct Harness {
    supervisor: TestSupervisor,
    spawner: FakeSpawner,
    probe: ScriptedProbe,
    clock: FakeClock,
    sink: Arc<RecordingSink>,
    flags: ChildFlags,
}

fn harness(probe: ScriptedProbe) -> Harness {
    let spawner = FakeSpawner::default();
    let clock = FakeClock::default();
    let sink = Arc::new(RecordingSink::default());
    let supervisor = Supervisor::new(
        spawner.clone(),
        probe.clone(),
        Arc::clone(&sink),
        clock.clone(),
        InlinePump,
    );
    Harness {
        supervisor,
        spawner,
        probe,
        clock,
        sink,
        flags: ChildFlags::default(),
    }
}

fn plan() -> LaunchPlan {
    LaunchPlan {
        host: "127.0.0.1".to_owned(),
        port: 3100,
        web_root: PathBuf::from("/resources/web"),
        data_dir: PathBuf::from("/data"),
    }
}

impl Harness {
    fn child(&self) -> FakeChild {
        FakeChild::new(self.flags.clone())
    }

    fn killed(&self) -> bool {
        self.flags.killed.load(Ordering::SeqCst)
    }

    fn stdin_closed(&self) -> bool {
        self.flags.stdin_closed.load(Ordering::SeqCst)
    }

    /// Ticks until the state machine says it is finished, advancing the clock the way the
    /// runtime loop would. The cap is generous but finite so a bug cannot hang the suite.
    fn run(&self, generation: u64) -> u32 {
        for ticks in 1..=1_000 {
            if self.supervisor.tick(generation) == Step::Done {
                return ticks;
            }
            self.clock.advance(HEALTH_POLL_MS);
        }
        panic!("the supervisor never finished");
    }
}

// --- tests -------------------------------------------------------------------------------

#[test]
fn the_environment_matches_the_backend_contract() {
    let environment = plan().environment();
    let lookup = |key: &str| {
        environment
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.clone())
    };
    assert_eq!(lookup("HOST").as_deref(), Some("127.0.0.1"));
    assert_eq!(lookup("PORT").as_deref(), Some("3100"));
    assert_eq!(lookup("FLWC_EXIT_ON_STDIN_CLOSE").as_deref(), Some("1"));
    assert_eq!(lookup("NODE_ENV").as_deref(), Some("production"));
    assert!(lookup("FLWC_WEB_ROOT").is_some());
    assert!(lookup("FLWC_DATA_DIR").is_some());
    // The Ember+ endpoint is never handed over here: it belongs to the backend's config.json.
    assert!(lookup("EMBER_HOST").is_none());
    assert!(lookup("EMBER_PORT").is_none());
}

#[test]
fn a_port_is_always_a_decimal_number() {
    // The backend does not validate PORT: a non-numeric value makes it listen on a random
    // port rather than fail, so the type has to be what guarantees this.
    for port in [1_u16, 3000, 65_535] {
        let plan = LaunchPlan { port, ..plan() };
        let rendered = plan
            .environment()
            .into_iter()
            .find(|(name, _)| *name == "PORT")
            .map(|(_, value)| value)
            .expect("PORT");
        assert_eq!(rendered.parse::<u16>(), Ok(port));
    }
}

#[test]
fn a_child_that_exits_before_it_is_ready_fails_with_its_output() {
    let harness = harness(ScriptedProbe::never());
    harness
        .spawner
        .queue(Ok(harness.child().exiting_after(1, Some(1)).with_stderr(
            &["listen EADDRINUSE", "at Server.setupListenHandle"],
        )));

    let generation = harness.supervisor.start(&plan());
    assert_eq!(harness.run(generation), 2);

    let states = harness.sink.states();
    assert_eq!(states.len(), 2);
    assert_eq!(states[0], ServerState::Starting);
    match &states[1] {
        ServerState::Failed {
            reason,
            exit_code,
            tail,
        } => {
            assert_eq!(*reason, FailureReason::ExitedBeforeReady);
            assert_eq!(*exit_code, Some(1));
            assert!(tail.iter().any(|line| line.contains("EADDRINUSE")));
        }
        other => panic!("expected a failure, got {other:?}"),
    }
    // It died on its own; there was nothing left to kill.
    assert!(!harness.killed());
}

#[test]
fn a_child_that_never_answers_is_killed_and_reported() {
    let harness = harness(ScriptedProbe::never());
    harness.spawner.queue(Ok(harness.child().never_exiting()));

    let generation = harness.supervisor.start(&plan());
    let ticks = harness.run(generation);

    // One probe per tick, right up to and including the tick that reaches the deadline.
    assert_eq!(ticks, (HEALTH_TIMEOUT_MS / HEALTH_POLL_MS) as u32 + 1);
    assert_eq!(harness.probe.calls(), ticks);
    assert!(harness.killed());
    match harness.supervisor.state() {
        ServerState::Failed {
            reason, exit_code, ..
        } => {
            assert_eq!(reason, FailureReason::HealthTimeout);
            assert_eq!(exit_code, None);
        }
        other => panic!("expected a failure, got {other:?}"),
    }
}

#[test]
fn a_child_that_dies_while_running_is_reported_and_not_restarted() {
    let harness = harness(ScriptedProbe::ready_from(2));
    harness
        .spawner
        .queue(Ok(harness.child().exiting_after(10, Some(0))));

    let generation = harness.supervisor.start(&plan());
    harness.run(generation);

    let states = harness.sink.states();
    assert_eq!(states[0], ServerState::Starting);
    assert_eq!(states[1], ServerState::Running { port: 3100 });
    assert!(matches!(
        states[2],
        ServerState::Failed {
            reason: FailureReason::ExitedWhileRunning,
            exit_code: Some(0),
            ..
        }
    ));
    assert_eq!(states.len(), 3);

    // Nothing restarts it, and nothing else is reported.
    assert_eq!(harness.supervisor.tick(generation), Step::Done);
    assert_eq!(harness.sink.states().len(), 3);
}

#[test]
fn stopping_closes_stdin_and_does_not_kill_a_child_that_goes_quietly() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness.spawner.queue(Ok(harness.child()));

    let generation = harness.supervisor.start(&plan());
    assert_eq!(harness.supervisor.tick(generation), Step::Continue);
    assert_eq!(
        harness.supervisor.state(),
        ServerState::Running { port: 3100 }
    );

    harness.supervisor.stop();

    assert!(harness.stdin_closed());
    assert!(!harness.killed());
    assert_eq!(harness.supervisor.state(), ServerState::Stopped);
    assert_eq!(
        harness.sink.states(),
        vec![
            ServerState::Starting,
            ServerState::Running { port: 3100 },
            ServerState::Stopped,
        ]
    );
}

#[test]
fn stopping_kills_a_child_that_outstays_the_grace_period() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness.spawner.queue(Ok(harness.child().never_exiting()));

    let generation = harness.supervisor.start(&plan());
    harness.supervisor.tick(generation);

    let before = harness.clock.now_ms();
    harness.supervisor.stop();

    assert!(harness.stdin_closed());
    assert!(harness.killed());
    assert_eq!(harness.clock.now_ms() - before, EXIT_WAIT_MS);
    assert_eq!(harness.supervisor.state(), ServerState::Stopped);
}

#[test]
fn a_tick_from_a_stopped_generation_reports_nothing() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness.spawner.queue(Ok(harness.child()));

    let generation = harness.supervisor.start(&plan());
    harness.supervisor.tick(generation);
    harness.supervisor.stop();

    // This is the supervising thread waking up one last time after the stop.
    assert_eq!(harness.supervisor.tick(generation), Step::Done);
    assert_eq!(harness.sink.states().len(), 3);
    assert_eq!(harness.supervisor.state(), ServerState::Stopped);
}

#[test]
fn restarting_hands_back_a_generation_that_supersedes_the_old_one() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness.spawner.queue(Ok(harness.child()));
    harness.spawner.queue(Ok(harness.child()));

    let first = harness.supervisor.start(&plan());
    harness.supervisor.tick(first);

    let second = harness.supervisor.restart(&plan());
    assert_ne!(first, second);
    // Both runs went through the spawner with the same plan; nothing is reused.
    assert_eq!(harness.spawner.plans(), vec![plan(), plan()]);
    assert_eq!(harness.supervisor.tick(first), Step::Done);
    assert_eq!(harness.supervisor.tick(second), Step::Continue);
    assert_eq!(
        harness.supervisor.state(),
        ServerState::Running { port: 3100 }
    );
}

#[test]
fn a_child_that_cannot_be_spawned_fails_immediately() {
    let harness = harness(ScriptedProbe::never());
    harness
        .spawner
        .queue(Err("node.exe is missing from the install".to_owned()));

    let generation = harness.supervisor.start(&plan());

    match harness.supervisor.state() {
        ServerState::Failed {
            reason,
            exit_code,
            tail,
        } => {
            assert_eq!(reason, FailureReason::SpawnFailed);
            assert_eq!(exit_code, None);
            assert!(tail.iter().any(|line| line.contains("node.exe is missing")));
        }
        other => panic!("expected a failure, got {other:?}"),
    }
    assert_eq!(harness.supervisor.tick(generation), Step::Done);
}

#[test]
fn output_reaches_both_the_window_and_the_ring() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness.spawner.queue(Ok(harness
        .child()
        .with_stdout(&["{\"msg\":\"Server listening\"}"])
        .with_stderr(&["a warning"])));

    harness.supervisor.start(&plan());

    let lines = harness.sink.lines();
    assert_eq!(lines[0].0, Stream::Stdout);
    assert!(lines[0].1.contains("Server listening"));
    assert_eq!(lines[1], (Stream::Stderr, "a warning".to_owned()));
    assert_eq!(harness.supervisor.log_tail(10).len(), 2);
}

#[test]
fn each_run_starts_with_an_empty_log() {
    let harness = harness(ScriptedProbe::ready_from(1));
    harness
        .spawner
        .queue(Ok(harness.child().with_stdout(&["first run"])));
    harness
        .spawner
        .queue(Ok(harness.child().with_stdout(&["second run"])));

    harness.supervisor.start(&plan());
    harness.supervisor.restart(&plan());

    assert_eq!(harness.supervisor.log_tail(10), vec!["second run"]);
}

#[test]
fn stopping_something_that_never_started_is_harmless() {
    let harness = harness(ScriptedProbe::never());
    harness.supervisor.stop();
    assert_eq!(harness.supervisor.state(), ServerState::Stopped);
    assert!(harness.sink.states().is_empty());
}
