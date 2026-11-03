'use client';
import { useEffect, useRef } from 'react';

/** Native dialog supplies modal focus containment, inert background and Escape. */
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[autofocus]')?.focus();
    const cancel = (event: Event) => {
      event.preventDefault();
      close.current();
    };
    dialog?.addEventListener('cancel', cancel);
    return () => {
      dialog?.removeEventListener('cancel', cancel);
      dialog?.close();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return ref;
}
