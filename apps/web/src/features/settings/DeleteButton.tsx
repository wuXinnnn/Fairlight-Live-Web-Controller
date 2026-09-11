interface DeleteButtonProps {
  /** Accessible name. The caller builds it so each list keeps its own wording. */
  label: string;
  title: string;
  disabled?: boolean;
  onClick(): void;
}

/**
 * Takes a channel reference, or a whole group, out of the view. It is the third gesture that
 * removes — beside unchecking in AVAILABLE CHANNELS and dragging out of the list — and the only
 * one a keyboard can reach or that a missing reference offers at all.
 */
export function DeleteButton({ label, title, disabled, onClick }: DeleteButtonProps) {
  return (
    <button
      type="button"
      className="delete-button"
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M3 3 9 9M9 3 3 9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="square"
        />
      </svg>
    </button>
  );
}
