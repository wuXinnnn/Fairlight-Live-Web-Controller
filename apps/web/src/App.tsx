import { useEffect, useMemo, useState } from 'react';
import { MixerPage } from './features/mixer/MixerPage.js';
import { SettingsPage } from './features/settings/SettingsPage.js';
import { navigate, useRoute } from './lib/router.js';
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
  const route = useRoute();
  const controlClient = useMemo(() => createControlClient(activeSocket), [activeSocket]);

  useEffect(() => bindMixerSocket(activeSocket), [activeSocket]);
  useEffect(() => {
    void loadViews(activeViewsClient);
  }, [activeViewsClient]);
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
  }, []);
  useEffect(() => {
    // Each route owns its scroll position: the mixer may be scrolled deep into a long bay when
    // the configuration page opens, and both pages start from the top.
    window.scrollTo(0, 0);
  }, [route]);

  return route === 'mixer' ? (
    <MixerPage controlClient={controlClient} onOpenSettings={() => navigate('views')} />
  ) : (
    <SettingsPage viewsClient={activeViewsClient} onBack={() => navigate('mixer')} />
  );
}
