// The test double for LauncherApi, in the spirit of apps/web/tests/fake-socket.ts: it
// records what the window asked for and lets a test push the events the Rust side would.

import type {
  LauncherApi,
  LauncherSettings,
  LauncherSnapshot,
  LogEvent,
  ServerState,
  Unlisten,
} from '../src/launcher-api.js';

export function snapshot(overrides: Partial<LauncherSnapshot> = {}): LauncherSnapshot {
  return {
    settings: { version: 1, port: 3000, bindLan: true, startHidden: false },
    server: { kind: 'running', port: 3000 },
    localUrl: 'http://localhost:3000',
    lanUrl: 'http://192.168.1.40:3000',
    autostartEnabled: false,
    log: [],
    notice: null,
    ...overrides,
  };
}

export class FakeLauncherApi implements LauncherApi {
  applied: LauncherSettings[] = [];
  copied: string[] = [];
  autostartCalls: boolean[] = [];
  opened = 0;
  hidden = 0;
  quits = 0;
  unlistened = 0;

  /** What `setAutostart` reports back; defaults to whatever was asked for. */
  autostartResult: boolean | null = null;
  /** When set, `applySettings` rejects with it. */
  applyError: Error | null = null;

  private current: LauncherSnapshot;
  private stateListeners: Array<(state: ServerState) => void> = [];
  private logListeners: Array<(event: LogEvent) => void> = [];

  constructor(initial: LauncherSnapshot = snapshot()) {
    this.current = initial;
  }

  launcherState(): Promise<LauncherSnapshot> {
    return Promise.resolve(this.current);
  }

  applySettings(settings: LauncherSettings): Promise<void> {
    this.applied.push(settings);
    return this.applyError === null ? Promise.resolve() : Promise.reject(this.applyError);
  }

  openInBrowser(): Promise<void> {
    this.opened += 1;
    return Promise.resolve();
  }

  hideWindow(): Promise<void> {
    this.hidden += 1;
    return Promise.resolve();
  }

  setAutostart(enabled: boolean): Promise<boolean> {
    this.autostartCalls.push(enabled);
    return Promise.resolve(this.autostartResult ?? enabled);
  }

  quit(): Promise<void> {
    this.quits += 1;
    return Promise.resolve();
  }

  copy(text: string): Promise<void> {
    this.copied.push(text);
    return Promise.resolve();
  }

  onServerState(listener: (state: ServerState) => void): Promise<Unlisten> {
    this.stateListeners.push(listener);
    return Promise.resolve(() => {
      this.unlistened += 1;
    });
  }

  onServerLog(listener: (event: LogEvent) => void): Promise<Unlisten> {
    this.logListeners.push(listener);
    return Promise.resolve(() => {
      this.unlistened += 1;
    });
  }

  /** Pushes a state change the way the Rust side's `server-state` event would. */
  emitState(state: ServerState): void {
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  /** Pushes a log line the way the Rust side's `server-log` event would. */
  emitLog(line: string, stream: LogEvent['stream'] = 'stdout'): void {
    for (const listener of this.logListeners) {
      listener({ stream, line });
    }
  }
}
