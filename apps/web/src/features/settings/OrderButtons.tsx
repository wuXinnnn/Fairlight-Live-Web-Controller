import type { MoveDirection } from './view-order.js';

interface OrderButtonsProps {
  /** Name used in the accessible labels, e.g. "BASS" or "group Rhythm". */
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  disabled?: boolean;
  onMove(direction: MoveDirection): void;
}

function Chevron({ direction }: { direction: MoveDirection }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path
        d={direction === -1 ? 'M2.5 7.5 6 4l3.5 3.5' : 'M2.5 4.5 6 8l3.5-3.5'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function OrderButtons({
  label,
  canMoveUp,
  canMoveDown,
  disabled = false,
  onMove,
}: OrderButtonsProps) {
  return (
    <div className="order-buttons" aria-label={`${label} order`}>
      <button
        type="button"
        aria-label={`Move ${label} up`}
        onClick={() => onMove(-1)}
        disabled={disabled || !canMoveUp}
      >
        <Chevron direction={-1} />
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        onClick={() => onMove(1)}
        disabled={disabled || !canMoveDown}
      >
        <Chevron direction={1} />
      </button>
    </div>
  );
}
