import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { ConnectionClient } from '../../lib/connection-api.js';
import { mixerStore } from '../../store/mixer-store.js';
import { validateEndpoint, type EndpointFieldErrors } from './connection-form.js';
import { useModalDialog } from './use-modal-dialog.js';

interface ConnectionPanelProps {
  open: boolean;
  client: ConnectionClient;
  onClose(): void;
}

interface ConnectionDialogProps {
  client: ConnectionClient;
  onClose(): void;
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'The request could not be completed.';
}

/** Modal CONNECTION panel; mounts a fresh dialog each time it opens so its form starts clean. */
export function ConnectionPanel({ open, client, onClose }: ConnectionPanelProps) {
  return open ? <ConnectionDialog client={client} onClose={onClose} /> : null;
}

function ConnectionDialog({ client, onClose }: ConnectionDialogProps) {
  const { socketConnected, emberStatus, emberLastError } = useStore(
    mixerStore,
    useShallow((state) => ({
      socketConnected: state.socketConnected,
      emberStatus: state.emberStatus,
      emberLastError: state.emberLastError,
    })),
  );
  const { dialogRef, onKeyDown } = useModalDialog<HTMLFormElement>({ onClose });
  const hostRef = useRef<HTMLInputElement>(null);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EndpointFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    let active = true;
    client.get().then(
      (current) => {
        if (!active) {
          return;
        }
        setHost(current.host);
        setPort(String(current.port));
        setLoading(false);
      },
      (error: unknown) => {
        if (!active) {
          return;
        }
        setLoadError(messageOf(error));
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    // Move from the dialog container to the first field once the values are in, unless the
    // operator already started navigating.
    if (!loading && document.activeElement === dialogRef.current) {
      hostRef.current?.focus();
    }
  }, [loading, dialogRef]);

  const onBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const editHost = (value: string): void => {
    setHost(value);
    setFieldErrors((errors) => ({ ...errors, host: undefined }));
    setConfirming(false);
    setApplied(false);
  };

  const editPort = (value: string): void => {
    setPort(value);
    setFieldErrors((errors) => ({ ...errors, port: undefined }));
    setConfirming(false);
    setApplied(false);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting || loading) {
      return;
    }
    const validation = validateEndpoint(host, port);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setConfirming(false);
      return;
    }
    setFieldErrors({});
    if (emberStatus === 'connected' && !confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    setApplied(false);
    try {
      const response = await client.update(validation.value);
      setHost(response.host);
      setPort(String(response.port));
      setConfirming(false);
      setApplied(true);
    } catch (error) {
      setSubmitError(messageOf(error));
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || loading;
  const statusText = socketConnected ? emberStatus.toUpperCase() : 'SOCKET OFFLINE';
  const online = socketConnected && emberStatus === 'connected';
  const hostErrorId = fieldErrors.host === undefined ? undefined : 'connection-host-error';
  const portErrorId = fieldErrors.port === undefined ? undefined : 'connection-port-error';

  return (
    <div className="connection-backdrop" onMouseDown={onBackdropMouseDown}>
      <form
        ref={dialogRef}
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-dialog-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        noValidate
      >
        <header className="connection-dialog__header">
          <div>
            <span>CONTROL DESK / EMBER+</span>
            <h2 id="connection-dialog-title">CONNECTION</h2>
          </div>
          <button
            type="button"
            className="utility-button connection-dialog__close"
            onClick={onClose}
            aria-label="Close connection settings"
            title="Close"
          >
            ×
          </button>
        </header>

        <div className="connection-dialog__body">
          <div className="connection-dialog__fields">
            <div className="connection-dialog__field">
              <label htmlFor="connection-host">HOST</label>
              <input
                ref={hostRef}
                id="connection-host"
                value={host}
                onChange={(event) => editHost(event.target.value)}
                placeholder={loading ? 'Loading' : '10.0.0.8'}
                autoComplete="off"
                spellCheck={false}
                disabled={submitting}
                aria-invalid={fieldErrors.host !== undefined}
                aria-describedby={hostErrorId}
              />
              {fieldErrors.host !== undefined && (
                <p className="connection-dialog__field-error" id="connection-host-error">
                  {fieldErrors.host}
                </p>
              )}
            </div>
            <div className="connection-dialog__field">
              <label htmlFor="connection-port">PORT</label>
              <input
                id="connection-port"
                value={port}
                onChange={(event) => editPort(event.target.value)}
                placeholder={loading ? '' : '9000'}
                inputMode="numeric"
                autoComplete="off"
                disabled={submitting}
                aria-invalid={fieldErrors.port !== undefined}
                aria-describedby={portErrorId}
              />
              {fieldErrors.port !== undefined && (
                <p className="connection-dialog__field-error" id="connection-port-error">
                  {fieldErrors.port}
                </p>
              )}
            </div>
          </div>

          <dl
            className={`connection-dialog__status ${online ? 'is-online' : 'is-offline'}`}
            aria-live="polite"
          >
            <dt>EMBER</dt>
            <dd data-testid="connection-ember-status">{statusText}</dd>
            {emberLastError !== null && (
              <>
                <dt>LAST ERROR</dt>
                <dd data-testid="connection-last-error">{emberLastError}</dd>
              </>
            )}
          </dl>

          {confirming && (
            <p className="connection-dialog__confirm" role="status">
              The mixer is connected. Applying will disconnect the current device and reconnect to{' '}
              {host.trim()}:{port.trim()}.
            </p>
          )}
          {applied && (
            <p className="connection-dialog__applied" role="status">
              Settings applied. Watching the mixer reconnect.
            </p>
          )}
          {(loadError ?? submitError) !== null && (
            <p className="connection-dialog__error" role="alert">
              {loadError ?? submitError}
            </p>
          )}
        </div>

        <footer className="connection-dialog__footer">
          <button
            type="button"
            className="utility-button"
            onClick={confirming ? () => setConfirming(false) : onClose}
            disabled={submitting}
          >
            {confirming ? 'KEEP CURRENT' : 'CANCEL'}
          </button>
          <button type="submit" className="primary-button" disabled={busy}>
            {submitting ? 'APPLYING' : confirming ? 'CONFIRM RECONNECT' : 'APPLY'}
          </button>
        </footer>
      </form>
    </div>
  );
}
