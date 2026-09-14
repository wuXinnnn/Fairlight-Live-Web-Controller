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
      // A page turn may never start here. ON is the one control on a strip that a slip of the
      // thumb can change without any way back, and it sits a finger's width from the gaps and
      // the meter, both of which are meant to be dragged.
      data-swipe="none"
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
