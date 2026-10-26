// src/components/HistoryPanel.jsx
//
// Merged view: locally tracked transfers (live status: pending → in block →
// bridging → arrived) plus Subscan-fetched history, deduped by hash with
// local entries taking priority. The old Vue panel only rendered the fetched
// list, so in-flight transfers were invisible until finalized — fixed here.

import { useEffect, useMemo, useState } from 'react';
import { useEngine } from '@/state/engine';
import { useI18n } from '@/i18n';
import { toast } from '@/ui/dialogs';
import { fetchTransactions, markTransferComplete } from '@/state/transfer';
import { getSubscanApiKey, setSubscanApiKey } from '@/state/substrateWallet';

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
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const list = useMemo(() => {
    const map = new Map();
    // local entries first — they win the dedup and carry the live status
    for (const tx of s.transactions) map.set(tx.hash || `local-${tx.id}`, tx);
    for (const tx of s.fetchedTransactions) {
      const key = tx.hash || tx.extrinsicIndex;
      if (key && !map.has(key)) map.set(key, tx);
    }
    return [...map.values()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }, [s.transactions, s.fetchedTransactions]);

  const refresh = async () => {
    setIsLoading(true);
    try {
      await fetchTransactions();
    } finally {
      setIsLoading(false);
    }
  };

  const saveApiKey = async () => {
    setSubscanApiKey(keyDraft);
    setKeyDraft('');
    setShowKeyInput(false);
    toast({ type: 'ok', title: t('notifications.success'), message: t('history.apiKeySaved'), duration: 2000 });
    await refresh();
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
        <h2>{t('history.title')}</h2>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn link" onClick={() => setShowKeyInput((v) => !v)} title={t('history.apiKeyLabel')}>
            {t('history.apiKeyManage')}
          </button>
          <button className="btn link" onClick={refresh} disabled={isLoading}>
            {isLoading ? '…' : t('history.refresh')}
          </button>
        </span>
      </div>

      {(s.historyStatus === 'needsKey' || showKeyInput) && (
        <div className="notice">
          <p style={{ margin: '0 0 8px' }}>{t('history.needsKey')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="mono"
              style={{ flex: 1 }}
              placeholder={t('history.apiKeyPlaceholder')}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
            <button className="btn small primary" onClick={saveApiKey} disabled={!keyDraft.trim()}>
              {t('history.apiKeySave')}
            </button>
          </div>
          <p className="small-text" style={{ margin: '6px 0 0' }}>
            <a href="https://pro.subscan.io/" target="_blank" rel="noreferrer">{t('history.apiKeyGet')}</a>
          </p>
        </div>
      )}

      {s.historyStatus === 'unavailable' && (
        <p className="warning">{t('history.unavailable')}</p>
      )}

      {list.length === 0 ? (
        <p className="empty-state">{t('history.empty')}</p>
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
              {tx.direction === 'evmToConsensus' && tx.status === 'bridging' && tx.id && (
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
