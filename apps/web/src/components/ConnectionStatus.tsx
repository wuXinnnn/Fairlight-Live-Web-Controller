import { useEffect } from 'react';
import { useStore } from 'zustand';
import { controlsAvailable, mixerStore, setNotice } from '../store/mixer-store.js';

export function ConnectionStatus() {
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
      <div className={`connection-status ${online ? 'is-online' : 'is-offline'}`} role="status">
        <span className="connection-status__lamp" aria-hidden="true" />
        <span>{statusText}</span>
      </div>
      {notice === null ? null : (
        <div className="notice" role="alert">
          {notice}
        </div>
      )}
    </>
  );
}
