import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DiscardChangesDialog, discardMessage } from './DiscardChangesDialog.js';

const other = { id: 'other', name: 'Other', channels: [], groups: [] };

describe('discardMessage', () => {
  it('describes each pending action', () => {
    expect(discardMessage('Grouped', { kind: 'navigate', route: 'mixer' })).toBe(
      'Return to the mixer without saving changes to "Grouped"?',
    );
    expect(discardMessage('Grouped', { kind: 'select', view: other })).toBe(
      'Switch to "Other" without saving changes to "Grouped"?',
    );
    expect(discardMessage('Grouped', { kind: 'delete' })).toBe(
      'Delete "Grouped" and discard its unsaved changes?',
    );
    expect(discardMessage('Grouped', { kind: 'create', name: 'Third' })).toBe(
      'Create "Third" without saving changes to "Grouped"?',
    );
  });
});

describe('DiscardChangesDialog', () => {
  it('is a labelled modal dialog that starts on KEEP EDITING', () => {
    const onDiscard = vi.fn();
    const onKeepEditing = vi.fn();
    render(
      <DiscardChangesDialog
        viewName="Grouped"
        action={{ kind: 'navigate', route: 'mixer' }}
        onDiscard={onDiscard}
        onKeepEditing={onKeepEditing}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'UNSAVED CHANGES' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(
      'Return to the mixer without saving changes to "Grouped"?',
    );
    expect(screen.getByRole('button', { name: 'KEEP EDITING' })).toHaveFocus();
    expect(document.body).toHaveClass('is-modal-open');

    fireEvent.click(screen.getByRole('button', { name: 'DISCARD' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'KEEP EDITING' }));
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
  });

  it('keeps editing on Escape and on a backdrop press, but not on a press inside', () => {
    const onKeepEditing = vi.fn();
    render(
      <DiscardChangesDialog
        viewName="Grouped"
        action={{ kind: 'delete' }}
        onDiscard={vi.fn()}
        onKeepEditing={onKeepEditing}
      />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(onKeepEditing).toHaveBeenCalledTimes(2);
  });
});
