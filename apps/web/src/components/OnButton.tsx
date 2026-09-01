interface OnButtonProps {
  label: string;
  on: boolean;
  disabled?: boolean;
  pending?: boolean;
  onToggle(on: boolean): void;
}

export function OnButton({
  label,
  on,
  disabled = false,
  pending = false,
  onToggle,
}: OnButtonProps) {
  return (
    <button
      type="button"
      className={`on-button ${on ? 'is-on' : ''} ${pending ? 'is-pending' : ''}`}
      aria-label={`${label} ${on ? 'on' : 'off'}`}
      aria-pressed={on}
      disabled={disabled || pending}
      onClick={() => {
        onToggle(!on);
      }}
    >
      <span className="on-button__lamp" aria-hidden="true" />
      ON
    </button>
  );
}
