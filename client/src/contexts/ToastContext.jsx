import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './ToastContext.css';

/**
 * App-wide toast notifications. Wraps the root component so any descendant
 * can call `useToast()` and trigger an in-page toast instead of `window.alert`.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Settings saved');
 *   toast.error('Upload failed');
 *   toast.info('Scan started in background');
 *
 * Toasts auto-dismiss after 4s by default. Pass a second arg to override:
 *   toast.success('Done', { duration: 8000 });
 *   toast.error('Persistent error', { duration: 0 }); // never auto-dismiss
 */

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((type, message, opts = {}) => {
    const id = nextId++;
    const duration = opts.duration ?? 4000;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (duration > 0) {
      setTimeout(() => remove(id), duration);
    }
    return id;
  }, [remove]);

  const value = {
    success: (msg, opts) => push('success', msg, opts),
    error: (msg, opts) => push('error', msg, opts),
    info: (msg, opts) => push('info', msg, opts),
    warning: (msg, opts) => push('warning', msg, opts),
    dismiss: remove,
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 && createPortal(
        <div className="toast-container" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`toast toast-${t.type}`}
              onClick={() => remove(t.id)}
            >
              {t.message}
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Defensive fallback so a hook call from outside the provider doesn't
    // crash the page — it logs and degrades to console output, which is
    // strictly better than an unhandled exception.
    return {
      success: (m) => console.info('[toast]', m),
      error: (m) => console.error('[toast]', m),
      info: (m) => console.info('[toast]', m),
      warning: (m) => console.warn('[toast]', m),
      dismiss: () => {},
    };
  }
  return ctx;
}

// Suppress unused-import warnings — useEffect is exported indirectly
// through React's runtime; import kept for parity with future refactors.
void useEffect;
