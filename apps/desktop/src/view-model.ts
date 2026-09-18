// Every decision the window makes, as plain functions over plain data: what the big word
// says, which address is shown, whether Apply is available, what a port field is worth, and
// how the log buffer is trimmed. The component below does nothing but render these.

import type { LauncherSettings, LauncherSnapshot, ServerState } from './launcher-api.js';

/** Mirrors LOG_RING_LINES in src-tauri/src/server/mod.rs: the ring the Rust side keeps. */
export const LOG_LINES = 500;

export type StatusLabel = 'STOPPED' | 'STARTING' | 'RUNNING' | 'FAILED';

/** What the user is editing, before Apply. The port is text so a half-typed value survives. */
export interface Draft {
  portText: string;
  bindLan: boolean;
}

export function statusLabel(state: ServerState): StatusLabel {
  switch (state.kind) {
    case 'stopped':
      return 'STOPPED';
    case 'starting':
      return 'STARTING';
    case 'running':
      return 'RUNNING';
    case 'failed':
      return 'FAILED';
  }
}

/**
 * The address to put on a tablet. The LAN one when there is one, because that is the whole
 * point; localhost otherwise, which is the truth when access from the network is off.
 */
export function displayUrl(snapshot: Pick<LauncherSnapshot, 'localUrl' | 'lanUrl'>): string {
  return snapshot.lanUrl ?? snapshot.localUrl;
}

/**
 * A port is 1-65535. Zero is excluded because the backend would then take whatever the OS
 * gave it and the window could not print an address for it.
 */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) {
    return null;
  }
  const port = Number(text.trim());
  return port >= 1 && port <= 65535 ? port : null;
}

export function draftFrom(settings: LauncherSettings): Draft {
  return { portText: String(settings.port), bindLan: settings.bindLan };
}

/** The settings a draft would save, or null when the port is not usable. */
export function settingsFrom(draft: Draft, saved: LauncherSettings): LauncherSettings | null {
  const port = parsePort(draft.portText);
  return port === null ? null : { ...saved, port, bindLan: draft.bindLan };
}

export function isDraftChanged(draft: Draft, saved: LauncherSettings): boolean {
  return parsePort(draft.portText) !== saved.port || draft.bindLan !== saved.bindLan;
}

/** A backend that is not running is one Apply can start again, unchanged settings or not. */
export function isRestartable(state: ServerState): boolean {
  return state.kind === 'failed' || state.kind === 'stopped';
}

/**
 * Apply is offered when the port is usable, no restart is already in flight, and there is
 * either something to change or something to bring back.
 */
export function canApply(
  draft: Draft,
  saved: LauncherSettings,
  restarting: boolean,
  server: ServerState,
): boolean {
  if (restarting || parsePort(draft.portText) === null) {
    return false;
  }
  return isDraftChanged(draft, saved) || isRestartable(server);
}

export function applyLabel(restarting: boolean): string {
  return restarting ? 'Restarting…' : 'Apply';
}

/** A restart is over once the backend has settled either way. */
export function isRestartSettled(state: ServerState): boolean {
  return state.kind === 'running' || state.kind === 'failed';
}

/** The sentence under the status line when something went wrong. */
export function failureSummary(state: ServerState): string | null {
  if (state.kind !== 'failed') {
    return null;
  }
  const cause = {
    spawnFailed: 'The backend could not be started',
    exitedBeforeReady: 'The backend exited before it was ready',
    healthTimeout: 'The backend never answered its health check',
    exitedWhileRunning: 'The backend stopped while it was running',
  }[state.reason];
  const code = state.exitCode === null ? 'no exit code' : `exit code ${state.exitCode}`;
  return `${cause} (${code}).`;
}

/** The lines a failure wants highlighted: the tail the Rust side sent with it. */
export function failureTail(state: ServerState): string[] {
  return state.kind === 'failed' ? state.tail : [];
}

/** Appends a line, keeping at most `limit` of them. */
export function appendLine(lines: string[], line: string, limit = LOG_LINES): string[] {
  if (limit <= 0) {
    return [];
  }
  const next = [...lines, line];
  return next.length <= limit ? next : next.slice(next.length - limit);
}

export function trimLines(lines: string[], limit = LOG_LINES): string[] {
  if (limit <= 0) {
    return [];
  }
  return lines.length <= limit ? [...lines] : lines.slice(lines.length - limit);
}
