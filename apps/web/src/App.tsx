import { useEffect, useMemo, useState } from 'react';
import { MixerPage } from './features/mixer/MixerPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import {
  bindMixerSocket,
  createBrowserSocket,
  createControlClient,
  type MixerSocket,
} from './lib/socket.js';
import { createViewsClient, type ViewsClient } from './lib/views-api.js';
import { loadViews } from './store/view-store.js';

interface AppProps {
  socket?: MixerSocket;
  viewsClient?: ViewsClient;
}

export function App({ socket, viewsClient }: AppProps) {
  const [activeSocket] = useState<MixerSocket>(() => socket ?? createBrowserSocket());
  const [activeViewsClient] = useState<ViewsClient>(() => viewsClient ?? createViewsClient());
  const [page, setPage] = useState<'mixer' | 'settings'>('mixer');
  const controlClient = useMemo(() => createControlClient(activeSocket), [activeSocket]);

  useEffect(() => bindMixerSocket(activeSocket), [activeSocket]);
  useEffect(() => {
    void loadViews(activeViewsClient);
  }, [activeViewsClient]);

  return page === 'mixer' ? (
    <MixerPage controlClient={controlClient} onOpenSettings={() => setPage('settings')} />
  ) : (
    <SettingsPage viewsClient={activeViewsClient} onBack={() => setPage('mixer')} />
  );
}
