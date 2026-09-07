import { useEffect } from 'react';
import { useStore } from 'zustand';
import { controlsAvailable, mixerStore, setNotice } from '../store/mixer-store.js';

interface ConnectionStatusProps {
  onOpen(): void;
}

export function ConnectionStatus({ onOpen }: ConnectionStatusProps) {
  const socketConnected = useStore(mixerStore, (state) => state.socketConnected);
  const emberStatus = useStore(mixerStore, (state) => state.emberStatus);
  const notice = useStore(mixerStore, (state) => state.notice);
  const online = useStore(mixerStore, controlsAvailable);

  useEffect(() => {
    if (notice === null) {
      return;
    }
    const timeout = window.setTimeout(() => {
      setNotice(null);
    }, 4000);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [notice]);

  const statusText = online
    ? 'MIXER ONLINE'
    : socketConnected
      ? `EMBER ${emberStatus.toUpperCase()}`
      : 'SOCKET OFFLINE';

  return (
    <>
      {/* The live region wraps the button: a button's content is its name, not an announcement. */}
      <div className="connection-status-region" role="status">
        <button
          type="button"
          className={`connection-status ${online ? 'is-online' : 'is-offline'}`}
          onClick={onOpen}
          aria-label="Connection settings"
          aria-haspopup="dialog"
          title="Open connection settings"
        >
          <span className="connection-status__lamp" aria-hidden="true" />
          <span>{statusText}</span>
        </button>
      </div>
      {notice === null ? null : (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}
    </>
  );
}
