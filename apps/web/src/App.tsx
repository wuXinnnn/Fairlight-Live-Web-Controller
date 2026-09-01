import { useEffect, useMemo, useState } from 'react';
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
  const [activeSocket] = useState<MixerSocket>(() => socket ?? createBrowserSocket());
  const controlClient = useMemo(() => createControlClient(activeSocket), [activeSocket]);

  useEffect(() => bindMixerSocket(activeSocket), [activeSocket]);

  return <MixerPage controlClient={controlClient} />;
}
