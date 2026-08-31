import { useEffect, useMemo, useRef } from 'react';
import { MixerPage } from './features/mixer/MixerPage.js';
import {
  bindMixerSocket,
  createBrowserSocket,
  createControlClient,
  type MixerSocket,
} from './lib/socket.js';

interface AppProps {
  socket?: MixerSocket;
}

export function App({ socket }: AppProps) {
  const socketRef = useRef<MixerSocket | null>(null);
  socketRef.current ??= socket ?? createBrowserSocket();
  const activeSocket = socketRef.current;
  const controlClient = useMemo(() => createControlClient(activeSocket), [activeSocket]);

  useEffect(() => bindMixerSocket(activeSocket), [activeSocket]);

  return <MixerPage controlClient={controlClient} />;
}
