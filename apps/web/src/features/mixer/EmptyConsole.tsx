import { emptyStateDetail, emptyStateTitle, type MixerEmptyState } from './empty-state.js';

interface EmptyConsoleProps {
  state: MixerEmptyState;
  onOpenConnection(): void;
}

/** The mixer page's empty surface: one of the reason-specific states from `empty-state.ts`. */
export function EmptyConsole({ state, onOpenConnection }: EmptyConsoleProps) {
  const detail = emptyStateDetail(state);
  const offline = state.kind === 'socket-offline' || state.kind === 'ember-offline';
  return (
    <section
      className={`empty-console is-${state.kind} ${offline ? 'is-offline' : ''}`}
      aria-live="polite"
    >
      <p className="empty-console__title">
        <span className="empty-console__pulse" aria-hidden="true" />
        {emptyStateTitle(state)}
      </p>
      {detail !== null && <p className="empty-console__detail">{detail}</p>}
      {state.kind === 'ember-offline' && state.lastError !== null && (
        <p className="empty-console__error">{state.lastError}</p>
      )}
      {state.kind === 'ember-offline' && (
        <button type="button" className="primary-button" onClick={onOpenConnection}>
          CONFIGURE CONNECTION
        </button>
      )}
    </section>
  );
}
