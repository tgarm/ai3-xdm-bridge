// src/components/HistoryPanel.jsx
//
// The PROGRESS panel: transfers started in this app, tracked live on-chain
// (block scan + destination balance polling) and persisted across sessions.
// Subscan is only an external link — it is no longer a data source (the API
// now requires a key).

import { useEffect, useMemo, useState } from 'react';
import { useEngine } from '@/state/engine';
import { useI18n } from '@/i18n';
import { checkFinality, markTransferComplete } from '@/state/transfer';

const SUBSCAN_URL = 'https://autonomys.subscan.io';
const AUTO_EVM_EXPLORER = 'https://explorer.auto-evm.mainnet.autonomys.xyz';

const directionKey = (tx) => ({
  consensusToEVM: 'history.c2e',
  evmToConsensus: 'history.e2c',
  evmToLinkedEvm: 'history.e2l',
  consensusToConsensus: 'history.c2c',
}[tx.direction] || 'history.c2c');

function statusBadge(tx) {
  if (tx.success === true) return 'ok';
  if (tx.success === false) return 'danger';
  if (['pending', 'in block', 'bridging', 'sending'].includes(tx.status)) return 'warn';
  if (['arrived', 'completed', 'success', 'finalized on consensus'].includes(tx.status)) return 'ok';
  return 'info';
}

const STATUS_KEY = {
  pending: 'Pending',
  'in block': 'InBlock',
  bridging: 'Bridging',
  arrived: 'Arrived',
  completed: 'Completed',
  'finalized on consensus': 'Finalized',
};

function statusText(tx, t) {
  if (tx.success === true) return t('history.statusValues.Success');
  if (tx.success === false) return t('history.statusValues.Failed');
  if (tx.status && STATUS_KEY[tx.status]) return t(`history.statusValues.${STATUS_KEY[tx.status]}`);
  if (tx.status) return tx.status.charAt(0).toUpperCase() + tx.status.slice(1);
  if (tx.direction === 'consensusToEVM') return t('history.statusValues.Pending');
  return t('history.statusValues.Unknown');
}

const formatHash = (hash) => `${hash.substring(0, 10)}…`;
const formatAddress = (addr) => `${addr.substring(0, 6)}…${addr.substring(addr.length - 4)}`;

export function HistoryPanel() {
  const s = useEngine();
  const { t, locale } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const list = useMemo(() =>
    [...s.transactions].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
  [s.transactions]);

  const refresh = async () => {
    setIsLoading(true);
    try {
      await checkFinality();
    } finally {
      setIsLoading(false);
    }
  };

  const relativeTime = (timestamp) => {
    const date = new Date(timestamp);
    const diff = now - date.getTime();
    if (diff >= 24 * 60 * 60 * 1000) return date.toLocaleString(locale);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    const minutes = Math.round(diff / 60000);
    if (Math.abs(minutes) < 60) return rtf.format(-minutes, 'minute');
    return rtf.format(-Math.round(minutes / 60), 'hour');
  };

  const remainingMs = (tx) => {
    if (!tx.expectedArrival) return 0;
    return new Date(tx.expectedArrival).getTime() - now;
  };

  const formatCountdown = (ms) => {
    if (ms <= 0) return t('history.arrived');
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const showCountdown = (tx) => {
    if (!tx.expectedArrival) return false;
    if (tx.direction === 'evmToConsensus') return tx.status === 'bridging';
    if (tx.direction === 'evmToLinkedEvm') return tx.status === 'pending';
    return remainingMs(tx) > 0 && ['pending', 'in block', 'bridging'].includes(tx.status);
  };

  const hashLink = (tx) => {
    if (!tx.hash) return null;
    if (tx.direction === 'consensusToEVM') {
      return <a href={`${SUBSCAN_URL}/extrinsic/${tx.hash}`} target="_blank" rel="noreferrer">{formatHash(tx.hash)}</a>;
    }
    if (tx.hash.startsWith('0x')) {
      return <a href={`${AUTO_EVM_EXPLORER}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{formatHash(tx.hash)}</a>;
    }
    return <span className="mono">{formatHash(tx.hash)}</span>;
  };

  const destCell = (tx) => {
    const dest = tx.destination || tx.to;
    if (!dest) return null;
    const label = formatAddress(dest);
    if (tx.direction === 'consensusToEVM') {
      return <a href={`${AUTO_EVM_EXPLORER}/address/${dest}`} target="_blank" rel="noreferrer" className="mono">{label}</a>;
    }
    return <span className="mono">{label}</span>;
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('progress.title')}</h2>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {s.consensusAddress && (
            <a
              href={`${SUBSCAN_URL}/account/${s.consensusAddress}?tab=extrinsic`}
              target="_blank"
              rel="noreferrer"
              title={t('progress.viewOnSubscan')}
            >
              {t('progress.viewOnSubscan')} ↗
            </a>
          )}
          <button className="btn link" onClick={refresh} disabled={isLoading} title={t('history.refresh')}>
            {isLoading ? '…' : t('history.refresh')}
          </button>
        </span>
      </div>

      {list.length === 0 ? (
        <p className="empty-state">{t('progress.empty')}</p>
      ) : (
        <div className="tx-list">
          {list.map((tx, index) => (
            <div className="tx" key={tx.hash || `local-${tx.id}` || index}>
              <div className="tx-head">
                <span className="tx-amount">
                  {tx.direction === 'evmToLinkedEvm' ? '' : `${tx.amount} AI3`}
                  <span className="badge info" style={{ marginLeft: 8, fontWeight: 400 }}>
                    {t(directionKey(tx))}
                  </span>
                </span>
                <span className="tx-time">{relativeTime(tx.timestamp)}</span>
              </div>
              <div className="kv">
                <span>{t('history.status')}</span>
                <span className={`badge ${statusBadge(tx)}`}>{statusText(tx, t)}</span>
              </div>
              {tx.hash && (
                <div className="kv">
                  <span>{t('history.hash')}</span>
                  <span>{hashLink(tx)}</span>
                </div>
              )}
              {(tx.destination || tx.to) && (
                <div className="kv">
                  <span>{t('history.to')}</span>
                  <span>{destCell(tx)}</span>
                </div>
              )}
              {tx.blockNumber && (
                <div className="kv">
                  <span>{t('history.block')}</span>
                  <span className="mono">{tx.blockNumber}</span>
                </div>
              )}
              {showCountdown(tx) && (
                <p className="countdown">
                  {tx.direction === 'evmToConsensus'
                    ? t('history.challengeEnds', [formatCountdown(remainingMs(tx))])
                    : t('history.estimatedArrival', [formatCountdown(remainingMs(tx))])}
                </p>
              )}
              {/* Fallback for transfers that can't be auto-verified (no
                  balance baseline, watch retired): the user closes the loop
                  by hand. */}
              {tx.status === 'bridging' && tx.id && (
                <button
                  className="btn small"
                  style={{ marginTop: 8 }}
                  onClick={() => markTransferComplete(tx.id)}
                >
                  {t('history.markReceived')}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
