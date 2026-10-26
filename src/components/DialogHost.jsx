// src/components/DialogHost.jsx
import { useSyncExternalStore } from 'react';
import { subscribe, getSnapshot, dismissToast, resolveAlert } from '@/ui/dialogs';

export function DialogHost() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  const current = snap.alerts[0];

  return (
    <>
      <div className="toast-host">
        {snap.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <div className="toast-head">
              <p className="toast-title">{t.title}</p>
              <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="close">×</button>
            </div>
            {t.message && <p className="toast-message">{t.message}</p>}
          </div>
        ))}
      </div>
      {current && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>{current.title}</h3>
            <p>{current.message}</p>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => resolveAlert(current.id)}>
                {current.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
