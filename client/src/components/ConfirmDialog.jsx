import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './ConfirmDialog.css';

/**
 * Reusable confirmation dialog to replace browser confirm() and alert() calls.
 *
 * Usage:
 *   <ConfirmDialog
 *     isOpen={showDialog}
 *     title="Delete Audiobook"
 *     message={`Delete "${audiobook.title}"? This action cannot be undone.`}
 *     confirmLabel="Delete"
 *     confirmVariant="danger"
 *     onConfirm={() => handleDelete()}
 *     onCancel={() => setShowDialog(false)}
 *   />
 *
 * For alert-style (info only, no cancel):
 *   <ConfirmDialog
 *     isOpen={showAlert}
 *     title="Success"
 *     message="Metadata refreshed from file"
 *     confirmLabel="OK"
 *     alertMode
 *     onConfirm={() => setShowAlert(false)}
 *     onCancel={() => setShowAlert(false)}
 *   />
 */
export default function ConfirmDialog({
  isOpen,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary', // 'primary' | 'danger'
  alertMode = false, // If true, only show confirm button (like alert())
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  // Focus confirm button when dialog opens
  useEffect(() => {
    if (isOpen && confirmRef.current) {
      confirmRef.current.focus();
    }
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <h3 id="confirm-dialog-title" className="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-message" className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          {!alertMode && (
            <button
              className="confirm-dialog-btn confirm-dialog-btn-cancel"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`confirm-dialog-btn confirm-dialog-btn-${confirmVariant}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
