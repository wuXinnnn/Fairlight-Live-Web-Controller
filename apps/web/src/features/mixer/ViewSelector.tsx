import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { setActiveView, viewStore } from '../../store/view-store.js';

export function ViewSelector() {
  const { views, activeViewId, loading } = useStore(
    viewStore,
    useShallow((state) => ({
      views: state.views,
      activeViewId: state.activeViewId,
      loading: state.loading,
    })),
  );

  return (
    <label className="view-selector">
      <span>VIEW</span>
      <select
        aria-label="Mixer view"
        value={activeViewId ?? ''}
        disabled={loading}
        onChange={(event) => setActiveView(event.target.value || null)}
      >
        <option value="">All Channels</option>
        {views.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
      </select>
    </label>
  );
}
