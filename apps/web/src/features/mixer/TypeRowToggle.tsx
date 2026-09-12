interface TypeRowToggleProps {
  enabled: boolean;
  onToggle(): void;
  /** Accessible description of what starts a new page; defaults to channel types. */
  label?: string;
}

export function TypeRowToggle({
  enabled,
  onToggle,
  label = 'Start each channel type on a new page',
}: TypeRowToggleProps) {
  return (
    <div className="type-row-control">
      <span>TYPE PAGES</span>
      <button
        type="button"
        className={`type-row-toggle ${enabled ? 'is-enabled' : ''}`}
        role="switch"
        aria-label={label}
        aria-checked={enabled}
        onClick={onToggle}
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
