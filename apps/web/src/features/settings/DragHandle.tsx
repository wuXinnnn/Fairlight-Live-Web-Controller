import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { Ref } from 'react';

interface DragHandleProps {
  /** Accessible name, e.g. "Drag BASS" or "Drag group Rhythm". */
  label: string;
  handleRef: Ref<HTMLButtonElement>;
  attributes: DraggableAttributes;
  listeners: DraggableSyntheticListeners;
  disabled: boolean;
}

/** The only element of a row that starts a drag; other row controls keep their own behaviour. */
export function DragHandle({ label, handleRef, attributes, listeners, disabled }: DragHandleProps) {
  return (
    <button
      type="button"
      className="drag-handle"
      aria-label={label}
      title="Drag to reorder"
      ref={handleRef}
      {...attributes}
      {...listeners}
      disabled={disabled}
    >
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
        <path
          d="M4 2.5h1.4v1.4H4zm2.6 0H8v1.4H6.6zM4 5.3h1.4v1.4H4zm2.6 0H8v1.4H6.6zM4 8.1h1.4v1.4H4zm2.6 0H8v1.4H6.6z"
          fill="currentColor"
        />
      </svg>
    </button>
  );
}
