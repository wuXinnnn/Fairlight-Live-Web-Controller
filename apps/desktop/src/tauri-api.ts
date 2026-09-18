// The real LauncherApi: thin wrappers over `invoke` and `listen`, and nothing else. This is
// the one file the window tests replace rather than exercise -- covering it would mean
// mocking `@tauri-apps/api` and asserting the mock.

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  LauncherApi,
  LauncherSettings,
  LauncherSnapshot,
  LogEvent,
  ServerState,
} from './launcher-api.js';

export function createTauriLauncherApi(): LauncherApi {
  return {
    launcherState: () => invoke<LauncherSnapshot>('launcher_state'),
    // A command returning `()` resolves to null, so these await and discard rather than
    // asking `invoke` for a void.
    applySettings: async (settings: LauncherSettings) => {
      await invoke('apply_settings', { settings });
    },
    setStartHidden: async (hidden: boolean) => {
      await invoke('set_start_hidden', { hidden });
    },
    openInBrowser: async () => {
      await invoke('open_in_browser');
    },
    hideWindow: async () => {
      await invoke('hide_window');
    },
    setAutostart: (enabled: boolean) => invoke<boolean>('set_autostart', { enabled }),
    quit: async () => {
      await invoke('quit');
    },
    copy: writeClipboard,
    onServerState: (listener: (state: ServerState) => void) =>
      listen<ServerState>('server-state', (event) => listener(event.payload)),
    onServerLog: (listener: (event: LogEvent) => void) =>
      listen<LogEvent>('server-log', (event) => listener(event.payload)),
  };
}

/**
 * The webview is served over a custom protocol that is not a secure context on every
 * platform, so `navigator.clipboard` may be missing. The textarea fallback is the old
 * `execCommand` path, which works regardless; both are wrapped because a failed copy should
 * do nothing rather than throw into a click handler.
 */
async function writeClipboard(text: string): Promise<void> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall through to the textarea.
  }
  const holder = document.createElement('textarea');
  holder.value = text;
  holder.setAttribute('readonly', '');
  holder.style.position = 'fixed';
  holder.style.opacity = '0';
  document.body.append(holder);
  holder.select();
  try {
    document.execCommand('copy');
  } catch {
    // Nothing else to try.
  }
  holder.remove();
}
