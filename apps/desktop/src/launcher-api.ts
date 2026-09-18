// The seam between the window and the Rust side. Everything the window can do goes through
// this interface, so the tests drive a fake instead of mocking `@tauri-apps/api` -- the same
// approach the mixer page takes with MixerSocket and FakeSocket.
//
// The shapes below mirror the serde output of src-tauri/src/server/state.rs and
// src-tauri/src/commands.rs, which has a Rust test asserting exactly this JSON.

export type FailureReason =
  'spawnFailed' | 'exitedBeforeReady' | 'healthTimeout' | 'exitedWhileRunning';

export type ServerState =
  | { kind: 'stopped' }
  | { kind: 'starting' }
  | { kind: 'running'; port: number }
  | { kind: 'failed'; reason: FailureReason; exitCode: number | null; tail: string[] };

export interface LauncherSettings {
  version: number;
  port: number;
  bindLan: boolean;
  startHidden: boolean;
}

export interface LauncherSnapshot {
  settings: LauncherSettings;
  server: ServerState;
  localUrl: string;
  lanUrl: string | null;
  autostartEnabled: boolean;
  log: string[];
  notice: string | null;
}

export interface LogEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export type Unlisten = () => void;

export interface LauncherApi {
  /** Everything the window needs to render, asked for once on mount. */
  launcherState(): Promise<LauncherSnapshot>;
  /** Saves the settings and, if the backend is affected, restarts it. */
  applySettings(settings: LauncherSettings): Promise<void>;
  openInBrowser(): Promise<void>;
  hideWindow(): Promise<void>;
  /** Returns the state the startup entry actually ended up in. */
  setAutostart(enabled: boolean): Promise<boolean>;
  quit(): Promise<void>;
  copy(text: string): Promise<void>;
  onServerState(listener: (state: ServerState) => void): Promise<Unlisten>;
  onServerLog(listener: (event: LogEvent) => void): Promise<Unlisten>;
}
