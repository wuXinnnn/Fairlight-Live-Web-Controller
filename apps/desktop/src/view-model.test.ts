import { describe, expect, it } from 'vitest';
import type { LauncherSettings, ServerState } from './launcher-api.js';
import {
  appendLine,
  applyLabel,
  canApply,
  displayUrl,
  draftFrom,
  failureSummary,
  failureTail,
  isDraftChanged,
  isRestartSettled,
  parsePort,
  settingsFrom,
  statusLabel,
  trimLines,
} from './view-model.js';

const saved: LauncherSettings = { version: 1, port: 3000, bindLan: true, startHidden: false };

describe('statusLabel', () => {
  it('has one word for each state', () => {
    expect(statusLabel({ kind: 'stopped' })).toBe('STOPPED');
    expect(statusLabel({ kind: 'starting' })).toBe('STARTING');
    expect(statusLabel({ kind: 'running', port: 3000 })).toBe('RUNNING');
    expect(statusLabel({ kind: 'failed', reason: 'healthTimeout', exitCode: null, tail: [] })).toBe(
      'FAILED',
    );
  });
});

describe('displayUrl', () => {
  it('prefers the address a tablet can reach', () => {
    expect(displayUrl({ localUrl: 'http://localhost:3000', lanUrl: 'http://10.0.0.5:3000' })).toBe(
      'http://10.0.0.5:3000',
    );
  });

  it('falls back to localhost when there is no LAN address', () => {
    expect(displayUrl({ localUrl: 'http://localhost:3100', lanUrl: null })).toBe(
      'http://localhost:3100',
    );
  });
});

describe('parsePort', () => {
  it('accepts the usable range', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('3000')).toBe(3000);
    expect(parsePort('65535')).toBe(65535);
    expect(parsePort('  3100  ')).toBe(3100);
  });

  it('rejects everything outside it', () => {
    // Zero would make the backend take a port from the OS that the window cannot print.
    expect(parsePort('0')).toBeNull();
    expect(parsePort('65536')).toBeNull();
    expect(parsePort('')).toBeNull();
    expect(parsePort('-1')).toBeNull();
    expect(parsePort('30 00')).toBeNull();
    expect(parsePort('3000a')).toBeNull();
    expect(parsePort('3e3')).toBeNull();
    expect(parsePort('123456')).toBeNull();
  });
});

describe('the draft', () => {
  it('starts as the saved settings', () => {
    expect(draftFrom(saved)).toEqual({ portText: '3000', bindLan: true });
  });

  it('knows when it differs from what is saved', () => {
    expect(isDraftChanged({ portText: '3000', bindLan: true }, saved)).toBe(false);
    expect(isDraftChanged({ portText: '3100', bindLan: true }, saved)).toBe(true);
    expect(isDraftChanged({ portText: '3000', bindLan: false }, saved)).toBe(true);
  });

  it('turns into settings that keep the fields it does not own', () => {
    const hidden = { ...saved, startHidden: true };
    expect(settingsFrom({ portText: '3100', bindLan: false }, hidden)).toEqual({
      version: 1,
      port: 3100,
      bindLan: false,
      startHidden: true,
    });
  });

  it('turns into nothing when the port is unusable', () => {
    expect(settingsFrom({ portText: '', bindLan: true }, saved)).toBeNull();
  });
});

describe('canApply', () => {
  it('is offered for a valid change', () => {
    expect(canApply({ portText: '3100', bindLan: true }, saved, false)).toBe(true);
    expect(canApply({ portText: '3000', bindLan: false }, saved, false)).toBe(true);
  });

  it('is not offered when nothing changed', () => {
    expect(canApply({ portText: '3000', bindLan: true }, saved, false)).toBe(false);
  });

  it('is not offered for an unusable port', () => {
    expect(canApply({ portText: '99999', bindLan: true }, saved, false)).toBe(false);
    expect(canApply({ portText: '', bindLan: true }, saved, false)).toBe(false);
  });

  it('is not offered while a restart is in flight', () => {
    expect(canApply({ portText: '3100', bindLan: true }, saved, true)).toBe(false);
  });
});

describe('applyLabel', () => {
  it('says what the button is doing', () => {
    expect(applyLabel(false)).toBe('Apply');
    expect(applyLabel(true)).toBe('Restarting…');
  });
});

describe('isRestartSettled', () => {
  it('is true once the backend has landed either way', () => {
    expect(isRestartSettled({ kind: 'running', port: 3000 })).toBe(true);
    expect(
      isRestartSettled({ kind: 'failed', reason: 'spawnFailed', exitCode: null, tail: [] }),
    ).toBe(true);
  });

  it('is false while it is still moving', () => {
    expect(isRestartSettled({ kind: 'starting' })).toBe(false);
    expect(isRestartSettled({ kind: 'stopped' })).toBe(false);
  });
});

describe('failureSummary', () => {
  const failure = (over: Partial<Extract<ServerState, { kind: 'failed' }>>): ServerState => ({
    kind: 'failed',
    reason: 'exitedWhileRunning',
    exitCode: 1,
    tail: [],
    ...over,
  });

  it('is nothing at all unless something failed', () => {
    expect(failureSummary({ kind: 'running', port: 3000 })).toBeNull();
    expect(failureSummary({ kind: 'stopped' })).toBeNull();
  });

  it('names the cause and the exit code', () => {
    expect(failureSummary(failure({}))).toBe(
      'The backend stopped while it was running (exit code 1).',
    );
    expect(failureSummary(failure({ reason: 'spawnFailed', exitCode: null }))).toBe(
      'The backend could not be started (no exit code).',
    );
    expect(failureSummary(failure({ reason: 'exitedBeforeReady', exitCode: 7 }))).toContain(
      'exited before it was ready',
    );
    expect(failureSummary(failure({ reason: 'healthTimeout', exitCode: null }))).toContain(
      'never answered its health check',
    );
  });

  it('carries the output that came with the failure', () => {
    expect(failureTail(failure({ tail: ['EADDRINUSE'] }))).toEqual(['EADDRINUSE']);
    expect(failureTail({ kind: 'starting' })).toEqual([]);
  });
});

describe('the log buffer', () => {
  it('appends while there is room', () => {
    expect(appendLine(['a'], 'b', 3)).toEqual(['a', 'b']);
  });

  it('drops the oldest lines past the limit', () => {
    expect(appendLine(['a', 'b', 'c'], 'd', 3)).toEqual(['b', 'c', 'd']);
  });

  it('trims an oversized batch down to the limit', () => {
    expect(trimLines(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);
    expect(trimLines(['a'], 2)).toEqual(['a']);
  });

  it('keeps nothing when there is no room at all', () => {
    expect(appendLine(['a'], 'b', 0)).toEqual([]);
    expect(trimLines(['a'], 0)).toEqual([]);
  });

  it('defaults to the same 500 lines the Rust ring keeps', () => {
    const many = Array.from({ length: 640 }, (_unused, index) => `line ${index}`);
    expect(trimLines(many)).toHaveLength(500);
    expect(trimLines(many)[0]).toBe('line 140');
    expect(appendLine(many, 'newest')).toHaveLength(500);
  });
});
