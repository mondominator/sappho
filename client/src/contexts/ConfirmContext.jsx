import { createContext, useContext, useState, useCallback, useRef } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Promise-based confirm dialog. Replaces `window.confirm` with a non-blocking,
 * styled, accessible alternative.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete book?',
 *     message: 'This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     confirmVariant: 'danger',
 *   });
 *   if (!ok) return;
 *
 * Or with positional shorthand for a quick yes/no prompt:
 *   const ok = await confirm('Delete this?');
 */

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState({
    open: false,
    title: 'Confirm',
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    confirmVariant: 'primary',
    alertMode: false,
  });
  // Resolver for the active confirm() call. Stored in a ref so successive
  // confirm() calls don't race against each other on state updates.
  const resolverRef = useRef(null);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      const config = typeof opts === 'string' ? { message: opts } : (opts || {});
      setState({
        open: true,
        title: config.title || 'Confirm',
        message: config.message || '',
        confirmLabel: config.confirmLabel || 'Confirm',
        cancelLabel: config.cancelLabel || 'Cancel',
        confirmVariant: config.confirmVariant || 'primary',
        alertMode: !!config.alertMode,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  }, []);

  const handleCancel = useCallback(() => {
    setState((s) => ({ ...s, open: false }));
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <ConfirmDialog
        isOpen={state.open}
        title={state.title}
        message={state.message}
        confirmLabel={state.confirmLabel}
        cancelLabel={state.cancelLabel}
        confirmVariant={state.confirmVariant}
        alertMode={state.alertMode}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // Defensive fallback so components used outside the provider still work
    // — they just fall back to the browser's blocking confirm. This is
    // strictly not worse than the pre-refactor state.
    return (opts) => {
      const message = typeof opts === 'string' ? opts : (opts && opts.message) || 'Are you sure?';
      // eslint-disable-next-line no-alert
      return Promise.resolve(window.confirm(message));
    };
  }
  return ctx;
}
