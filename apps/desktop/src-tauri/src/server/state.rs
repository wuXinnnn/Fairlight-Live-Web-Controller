//! What the window is told about the backend process.

use serde::Serialize;

/// Why the backend is not running. The window shows a different sentence for each, because
/// "it exited before it was ready" and "it stopped answering after running fine" send the
/// user to very different places.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FailureReason {
    /// The process could not be started at all -- a missing sidecar or resource.
    SpawnFailed,
    /// It started and then exited before the health check ever passed.
    ExitedBeforeReady,
    /// It stayed up but never answered the health check.
    HealthTimeout,
    /// It had been answering and then went away on its own.
    ExitedWhileRunning,
}

/// There is no `Stopping`: a stop is synchronous from the caller's point of view and the
/// window shows its own `Restarting…` label while it waits. Adding a state for it would mean
/// the window had two sources of truth for the same moment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ServerState {
    Stopped,
    Starting,
    Running {
        port: u16,
    },
    Failed {
        reason: FailureReason,
        /// `None` when the process was killed rather than exiting by itself.
        exit_code: Option<i32>,
        tail: Vec<String>,
    },
}

/// Which pipe a log line came from, so the window can mark the noisy one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stream {
    Stdout,
    Stderr,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The window's TypeScript mirrors these names by hand, so the wire shape is locked down
    /// here rather than discovered when a field silently stops arriving.
    #[test]
    fn the_wire_shape_is_what_the_window_expects() {
        let json = |state: &ServerState| serde_json::to_string(state).expect("serialise");

        assert_eq!(json(&ServerState::Stopped), r#"{"kind":"stopped"}"#);
        assert_eq!(json(&ServerState::Starting), r#"{"kind":"starting"}"#);
        assert_eq!(
            json(&ServerState::Running { port: 3000 }),
            r#"{"kind":"running","port":3000}"#
        );
        assert_eq!(
            json(&ServerState::Failed {
                reason: FailureReason::ExitedWhileRunning,
                exit_code: Some(1),
                tail: vec!["boom".to_owned()],
            }),
            r#"{"kind":"failed","reason":"exitedWhileRunning","exitCode":1,"tail":["boom"]}"#
        );
    }

    #[test]
    fn a_killed_process_has_no_exit_code() {
        let json = serde_json::to_string(&ServerState::Failed {
            reason: FailureReason::HealthTimeout,
            exit_code: None,
            tail: Vec::new(),
        })
        .expect("serialise");
        assert!(json.contains(r#""exitCode":null"#));
    }

    #[test]
    fn stream_names_are_lower_case() {
        assert_eq!(
            serde_json::to_string(&Stream::Stdout).unwrap(),
            r#""stdout""#
        );
        assert_eq!(
            serde_json::to_string(&Stream::Stderr).unwrap(),
            r#""stderr""#
        );
    }
}
