// src/components/LogsPanel.jsx
import { useEffect, useRef, useState } from 'react';
import { useEngine, clearLogs } from '@/state/engine';
import { useI18n } from '@/i18n';

export function LogsPanel() {
  const s = useEngine();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const listRef = useRef(null);

  // newest entry stays visible; only scroll while the panel is open
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, s.logs.length]);

  return (
    <details className="section" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        {t('logging.logs')}
        <span className="muted small-text">{s.logs.length}</span>
        <span className="summary-mark">{open ? '−' : '+'}</span>
      </summary>
      <div className="section-body">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button className="btn small ghost danger" onClick={clearLogs}>{t('logging.clear')}</button>
        </div>
        <div className="log-list" ref={listRef}>
          {s.logs.map((log) => (
            <p className="log-line" key={log.key}>
              <span className="log-time">{log.time}</span>
              <span className="log-message">{log.message}</span>
            </p>
          ))}
        </div>
      </div>
    </details>
  );
}
