import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const MODAL_OPEN_CLASS = 'is-modal-open';

interface ModalDialogOptions {
  onClose(): void;
}

interface ModalDialogHandle<T extends HTMLElement> {
  dialogRef: RefObject<T | null>;
  onKeyDown(event: KeyboardEvent<T>): void;
  /** Brings focus back into the dialog when a disabled control let it fall out to the body. */
  reclaimFocus(): void;
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
}

/**
 * Minimal modal behaviour for a self-drawn dialog: focus moves into the dialog when it mounts,
 * Tab cycles inside it, Escape closes it, page scrolling is locked, and focus returns to the
 * element that opened the dialog when it unmounts.
 */
export function useModalDialog<T extends HTMLElement>({
  onClose,
}: ModalDialogOptions): ModalDialogHandle<T> {
  const dialogRef = useRef<T | null>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add(MODAL_OPEN_CLASS);
    dialogRef.current?.focus();
    return () => {
      document.body.classList.remove(MODAL_OPEN_CLASS);
      if (opener !== null && opener.isConnected) {
        opener.focus();
      }
    };
  }, []);

  useEffect(() => {
    // Escape must work even when focus fell out of the dialog, e.g. after the pressed APPLY
    // button became disabled while its request was in flight.
    const onDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onDocumentKeyDown);
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown);
    };
  }, [onClose]);

  const reclaimFocus = useCallback((): void => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.contains(document.activeElement)) {
      dialog.focus();
    }
  }, []);

  const onKeyDown = (event: KeyboardEvent<T>): void => {
    if (event.key !== 'Tab' || dialogRef.current === null) {
      return;
    }
    const focusable = focusableElements(dialogRef.current);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return { dialogRef, onKeyDown, reclaimFocus };
}
