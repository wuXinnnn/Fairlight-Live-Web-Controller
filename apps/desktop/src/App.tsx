import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  LauncherApi,
  LauncherSettings,
  LauncherSnapshot,
  ServerState,
} from './launcher-api.js';
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
  /**
   * Kept out of the snapshot because it has its own source of truth. A `server-state` event
   * can land while `launcher_state` is still in flight -- the backend reaching Running
   * within the first few hundred milliseconds is the normal case, not a rare one -- and the
   * event is by definition newer than the snapshot that was already on its way.
   */
  const [server, setServer] = useState<ServerState | null>(null);
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
        await launcher.onServerState((next) => {
          setServer(next);
          if (isRestartSettled(next)) {
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
      // Only if no event beat the snapshot here.
      setServer((current) => current ?? loaded.server);
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

  /** Apply: save the backend's settings and wait out the restart they cause. */
  const applySettings = useCallback(
    async (settings: LauncherSettings) => {
      setRestarting(true);
      // The Rust side starts each run with an empty ring; the window follows suit rather
      // than mixing the old process's output into the new one's.
      setLog([]);
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
      <main className="shell shell--loading">
        <p className="loading">Starting the launcher&#8230;</p>
      </main>
    );
  }

  const serverState = server ?? snapshot.server;
  const status = statusLabel(serverState);
  const address = displayUrl(snapshot);
  const summary = failureSummary(serverState);
  const tail = failureTail(serverState);
  const applyAvailable = canApply(draft, snapshot.settings, restarting, serverState);

  const onApply = () => {
    const settings = settingsFrom(draft, snapshot.settings);
    if (settings !== null) {
      void applySettings(settings);
    }
  };

  const onCopy = () => {
    void launcher.copy(address);
    setCopiedUrl(address);
  };

  const onStartHidden = (startHidden: boolean) => {
    // Its own command, not Apply: this is read once at startup and must not be able to put
    // the backend through a restart.
    setSnapshot({ ...snapshot, settings: { ...snapshot.settings, startHidden } });
    void launcher.setStartHidden(startHidden);
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
      <header className="console-header">
        <div className="console-brand">
          <span className="console-brand__eyebrow">FAIRLIGHT LIVE</span>
          <h1>LAUNCHER</h1>
        </div>
        {/* The live region wraps the word, so a state change is announced and not only painted. */}
        <div className={`console-status is-${status.toLowerCase()}`} role="status">
          <span className="console-status__lamp" aria-hidden="true" />
          <span>{status}</span>
        </div>
        <div className="console-address">
          <span className="console-address__url">{address}</span>
          <button
            type="button"
            className={`utility-button console-address__copy${
              copiedUrl === address ? ' is-confirmed' : ''
            }`}
            onClick={onCopy}
          >
            {copiedUrl === address ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>

      <div className="console-body">
        <div className="console-stack">
          {snapshot.notice !== null && (
            <div className="console-banner" role="status">
              <strong>NOTICE</strong>
              <span>{snapshot.notice}</span>
            </div>
          )}
          {summary !== null && (
            <div className="console-banner console-banner--failure" role="alert">
              <strong>FAILURE</strong>
              <span>{summary}</span>
            </div>
          )}

          <section className="console-section">
            <div className="workbench-label">
              <span>01</span>
              <h2>Server</h2>
            </div>
            <div className="console-field">
              <label htmlFor="port">Port</label>
              <div className="console-field__control">
                <input
                  id="port"
                  type="number"
                  min={1}
                  max={65535}
                  value={draft.portText}
                  onChange={(event) => setDraft({ ...draft, portText: event.target.value })}
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={onApply}
                  disabled={!applyAvailable}
                >
                  {applyLabel(restarting)}
                </button>
              </div>
            </div>
            <label className={`console-check${draft.bindLan ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={draft.bindLan}
                onChange={(event) => setDraft({ ...draft, bindLan: event.target.checked })}
              />
              <span className="console-check__box" aria-hidden="true" />
              Allow access from other devices on the network
            </label>
          </section>

          <section className="console-section">
            <div className="workbench-label">
              <span>02</span>
              <h2>Startup</h2>
            </div>
            <label className={`console-check${snapshot.autostartEnabled ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={snapshot.autostartEnabled}
                onChange={(event) => onAutostart(event.target.checked)}
              />
              <span className="console-check__box" aria-hidden="true" />
              Start with Windows
            </label>
            <label className={`console-check${snapshot.settings.startHidden ? ' is-checked' : ''}`}>
              <input
                type="checkbox"
                checked={snapshot.settings.startHidden}
                onChange={(event) => onStartHidden(event.target.checked)}
              />
              <span className="console-check__box" aria-hidden="true" />
              Start hidden in the tray
            </label>
          </section>
        </div>

        <section className="console-section console-section--log">
          <div className="workbench-label">
            <span>03</span>
            {/*
              The heading is the pane's label. One string does both jobs, so the section is
              not titled twice over in a window this size.
            */}
            <h2>
              <label htmlFor="server-log">Server log</label>
            </h2>
          </div>
          <textarea
            id="server-log"
            className="console-log__pane"
            ref={logRef}
            readOnly
            value={log.join('\n')}
          />
          {tail.length > 0 && (
            <pre className="console-log__tail" aria-label="Last output before the failure">
              {tail.join('\n')}
            </pre>
          )}
        </section>
      </div>

      <footer className="console-footer">
        <div className="console-footer__group">
          <button
            type="button"
            className="utility-button"
            onClick={() => void launcher.openInBrowser()}
          >
            Open in browser
          </button>
          <button
            type="button"
            className="utility-button"
            onClick={() => void launcher.hideWindow()}
          >
            Hide to tray
          </button>
        </div>
        {/* Apart from the others: the one button here that ends the show. */}
        <button
          type="button"
          className="utility-button is-danger"
          onClick={() => void launcher.quit()}
        >
          Exit
        </button>
      </footer>
    </main>
  );
}
