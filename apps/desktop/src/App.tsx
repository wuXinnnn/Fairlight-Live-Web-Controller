import { useCallback, useEffect, useRef, useState } from 'react';
import type { LauncherApi, LauncherSnapshot, LauncherSettings } from './launcher-api.js';
import { createTauriLauncherApi } from './tauri-api.js';
import {
  appendLine,
  applyLabel,
  canApply,
  displayUrl,
  draftFrom,
  failureSummary,
  failureTail,
  isRestartSettled,
  settingsFrom,
  statusLabel,
  trimLines,
  type Draft,
} from './view-model.js';

interface AppProps {
  /** Tests pass a fake; production constructs the real adapter once. */
  api?: LauncherApi;
}

export function App({ api }: AppProps) {
  const [launcher] = useState<LauncherApi>(() => api ?? createTauriLauncherApi());
  const [snapshot, setSnapshot] = useState<LauncherSnapshot | null>(null);
  const [draft, setDraft] = useState<Draft>({ portText: '', bindLan: true });
  const [restarting, setRestarting] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  /** The address that was copied, so a new address stops claiming it was. */
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const logRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    const unsubscribes: Array<() => void> = [];

    const load = async () => {
      unsubscribes.push(
        await launcher.onServerState((server) => {
          setSnapshot((current) => (current === null ? current : { ...current, server }));
          if (isRestartSettled(server)) {
            setRestarting(false);
          }
        }),
      );
      unsubscribes.push(
        await launcher.onServerLog((event) => {
          setLog((current) => appendLine(current, event.line));
        }),
      );

      const loaded = await launcher.launcherState();
      if (!active) {
        return;
      }
      setSnapshot(loaded);
      setDraft(draftFrom(loaded.settings));
      setLog(trimLines(loaded.log));
    };

    void load();
    return () => {
      active = false;
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [launcher]);

  // New output always shows: this pane is only ever read from the bottom.
  useEffect(() => {
    const pane = logRef.current;
    if (pane !== null) {
      pane.scrollTop = pane.scrollHeight;
    }
  }, [log]);

  const saveSettings = useCallback(
    async (settings: LauncherSettings, restarts: boolean) => {
      if (restarts) {
        setRestarting(true);
        // The Rust side starts each run with an empty ring; the window follows suit rather
        // than mixing the old process's output into the new one's.
        setLog([]);
      }
      setSnapshot((current) => (current === null ? current : { ...current, settings }));
      try {
        await launcher.applySettings(settings);
        // Success does not clear the restarting flag: the restart is over when a Running or
        // Failed state arrives, which is the only thing that knows whether it worked.
        //
        // The addresses do have to be re-read. They are built from the port and the binding,
        // so leaving the old ones on screen would have the window naming a port that is no
        // longer listening. The log is left alone: it is fed by events, not by this.
        const fresh = await launcher.launcherState();
        setSnapshot((current) =>
          current === null
            ? current
            : {
                ...current,
                settings: fresh.settings,
                localUrl: fresh.localUrl,
                lanUrl: fresh.lanUrl,
                autostartEnabled: fresh.autostartEnabled,
              },
        );
        // Not every apply restarts -- changing only `Start hidden`, or applying the same
        // settings to a healthy backend, does not. Nothing would then arrive to end the
        // wait, so a settled state here is the signal.
        if (isRestartSettled(fresh.server)) {
          setRestarting(false);
        }
      } catch {
        setRestarting(false);
      }
    },
    [launcher],
  );

  if (snapshot === null) {
    return (
      <main className="shell">
        <p className="loading">Starting the launcher&#8230;</p>
      </main>
    );
  }

  const status = statusLabel(snapshot.server);
  const address = displayUrl(snapshot);
  const summary = failureSummary(snapshot.server);
  const tail = failureTail(snapshot.server);
  const applyAvailable = canApply(draft, snapshot.settings, restarting, snapshot.server);

  const onApply = () => {
    const settings = settingsFrom(draft, snapshot.settings);
    if (settings !== null) {
      void saveSettings(settings, true);
    }
  };

  const onCopy = () => {
    void launcher.copy(address);
    setCopiedUrl(address);
  };

  const onStartHidden = (startHidden: boolean) => {
    // Read only at startup, so there is nothing to restart and nothing to Apply.
    void saveSettings({ ...snapshot.settings, startHidden }, false);
  };

  const onAutostart = (enabled: boolean) => {
    setSnapshot({ ...snapshot, autostartEnabled: enabled });
    void launcher.setAutostart(enabled).then((actual) => {
      setSnapshot((current) =>
        current === null ? current : { ...current, autostartEnabled: actual },
      );
    });
  };

  return (
    <main className="shell">
      <header className="status">
        <p className={`status-word status-${status.toLowerCase()}`}>{status}</p>
        <div className="address">
          <span className="address-url">{address}</span>
          <button type="button" onClick={onCopy}>
            {copiedUrl === address ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>

      {snapshot.notice !== null && <p className="notice">{snapshot.notice}</p>}
      {summary !== null && <p className="failure">{summary}</p>}

      <fieldset>
        <legend>Server</legend>
        <div className="row">
          <label htmlFor="port">Port</label>
          <input
            id="port"
            type="number"
            min={1}
            max={65535}
            value={draft.portText}
            onChange={(event) => setDraft({ ...draft, portText: event.target.value })}
          />
          <button type="button" onClick={onApply} disabled={!applyAvailable}>
            {applyLabel(restarting)}
          </button>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.bindLan}
            onChange={(event) => setDraft({ ...draft, bindLan: event.target.checked })}
          />
          Allow access from other devices on the network
        </label>
      </fieldset>

      <fieldset>
        <legend>Startup</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={snapshot.autostartEnabled}
            onChange={(event) => onAutostart(event.target.checked)}
          />
          Start with Windows
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={snapshot.settings.startHidden}
            onChange={(event) => onStartHidden(event.target.checked)}
          />
          Start hidden in the tray
        </label>
      </fieldset>

      <div className="actions">
        <button type="button" onClick={() => void launcher.openInBrowser()}>
          Open in browser
        </button>
        <button type="button" onClick={() => void launcher.hideWindow()}>
          Hide to tray
        </button>
        <button type="button" className="danger" onClick={() => void launcher.quit()}>
          Exit
        </button>
      </div>

      <section className="log">
        <label htmlFor="server-log">Server log</label>
        <textarea id="server-log" ref={logRef} readOnly value={log.join('\n')} />
        {tail.length > 0 && (
          <pre className="log-tail" aria-label="Last output before the failure">
            {tail.join('\n')}
          </pre>
        )}
      </section>
    </main>
  );
}
