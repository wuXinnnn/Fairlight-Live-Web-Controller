import type { View } from '@flwc/shared';
import { useEffect, useRef, type MouseEvent } from 'react';
import { useModalDialog } from '../../components/use-modal-dialog.js';
import type { Route } from '../../lib/router.js';

/** An action that would lose unsaved edits, held until the operator confirms or cancels it. */
export type PendingAction =
  | { kind: 'navigate'; route: Route }
  | { kind: 'select'; view: View }
  | { kind: 'delete' }
  | { kind: 'create'; name: string };

interface DiscardChangesDialogProps {
  /** Saved name of the view whose edits would be lost. */
  viewName: string;
  action: PendingAction;
  onDiscard(): void;
  onKeepEditing(): void;
}

export function discardMessage(viewName: string, action: PendingAction): string {
  switch (action.kind) {
    case 'navigate':
      return `Return to the mixer without saving changes to "${viewName}"?`;
    case 'select':
      return `Switch to "${action.view.name}" without saving changes to "${viewName}"?`;
    case 'delete':
      return `Delete "${viewName}" and discard its unsaved changes?`;
    case 'create':
      return `Create "${action.name}" without saving changes to "${viewName}"?`;
  }
}

/**
 * Confirmation shown before an action discards unsaved view edits. Escape and a backdrop press
 * keep editing; focus starts on KEEP EDITING so an accidental Enter never discards.
 */
export function DiscardChangesDialog({
  viewName,
  action,
  onDiscard,
  onKeepEditing,
}: DiscardChangesDialogProps) {
  const { dialogRef, onKeyDown } = useModalDialog<HTMLDivElement>({ onClose: onKeepEditing });
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
  }, []);

  const onBackdropMouseDown = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onKeepEditing();
    }
  };

  return (
    <div className="connection-backdrop" onMouseDown={onBackdropMouseDown}>
      <div
        ref={dialogRef}
        className="connection-dialog discard-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-dialog-title"
        aria-describedby="discard-dialog-message"
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="connection-dialog__header">
          <div>
            <span>VIEW CONFIGURATION</span>
            <h2 id="discard-dialog-title">UNSAVED CHANGES</h2>
          </div>
        </header>
        <div className="connection-dialog__body">
          <p className="discard-dialog__message" id="discard-dialog-message">
            {discardMessage(viewName, action)}
          </p>
        </div>
        <footer className="connection-dialog__footer">
          <button type="button" className="utility-button" onClick={onDiscard}>
            DISCARD
          </button>
          <button type="button" className="primary-button" ref={keepRef} onClick={onKeepEditing}>
            KEEP EDITING
          </button>
        </footer>
      </div>
    </div>
  );
}
