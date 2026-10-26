// src/components/TransferPanel.jsx
//
// The core action card. UX rules (doc/07): the transfer button is never
// silently disabled — when inactive, a hint line states exactly why.

import { alert } from '@/ui/dialogs';
import { useEngine } from '@/state/engine';
import { useI18n } from '@/i18n';
import { MIN_TRANSFER_AMOUNT } from '@/constants';
import {
  canTransfer,
  canPrepareFunds,
  consensusConnected,
  evmConnected,
  sourceBalance,
  setAmount,
  setAmountPercent,
  setDirection,
  performTransfer,
} from '@/state/transfer';

const PERCENTS = [25, 50, 75, 100];

// Engine status keys (transfer.js) → transfer.status.<key> i18n entries.
// Unknown keys fall back to the raw string instead of a missing-translation
// marker, so new polkadot status types degrade gracefully.
const STATUS_KEYS = new Set([
  'pending', 'broadcast', 'inBlock', 'finalized',
  'preparingFunds', 'sendingFunds', 'sending',
  'retracted', 'finalityTimeout', 'dropped', 'invalid', 'usurped',
]);

function statusLabel(raw, t) {
  if (!raw) return null;
  return STATUS_KEYS.has(raw) ? t(`transfer.status.${raw}`) : raw;
}

export function TransferPanel() {
  const s = useEngine();
  const { t } = useI18n();

  const isC2E = s.direction === 'consensusToEVM';
  const amountNum = parseFloat(s.amount) || 0;
  const srcBal = sourceBalance(s);

  let reason = null;
  if (!s.isTransferring) {
    if (!consensusConnected(s)) reason = 'transfer.needConsensusWallet';
    else if (isC2E && !evmConnected(s)) reason = 'transfer.needBothWallets';
    else if (!isC2E && !s.substrateLinkedEvmAddress) reason = 'transfer.needLinkedEvm';
    else if (amountNum < MIN_TRANSFER_AMOUNT) reason = 'transfer.amountTooLow';
    else if (amountNum > srcBal) reason = 'transfer.insufficientBalance';
  }

  const enabled = s.isTransferring || canTransfer(s) || canPrepareFunds(s);
  const label = s.isTransferring
    ? (statusLabel(s.currentStatus, t) || t('transfer.buttonTransferring'))
    : canPrepareFunds(s)
      ? t('transfer.prepareFundButton')
      : t('transfer.button');

  const onSwap = () => {
    const next = isC2E ? 'evmToConsensus' : 'consensusToEVM';
    setDirection(next);
    if (next === 'evmToConsensus') {
      alert({
        title: t('transfer.e2cWarning.title'),
        message: t('transfer.e2cWarning.message'),
        confirmText: t('transfer.e2cWarning.confirmButton'),
      });
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <button className="direction-btn" onClick={onSwap} title={t('transfer.swapTitle')}>
          <span>{isC2E ? t('transfer.c2eTitle') : t('transfer.e2cTitle')}</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M4.5 1l-3 3 3 3 .7-.7L3.7 4.8H11v-1H3.7l1.5-1.5-.7-1.3zM11.5 9l-.7.7 1.5 1.5H5v1h7.3l-1.5 1.5.7.7 3-3-3-3z"/>
          </svg>
        </button>
      </div>

      <div className="kv">
        <span>{t('transfer.available')}</span>
        <span className="mono balance-value">{s.isTransferring ? '…' : `${srcBal.toFixed(4)} AI3`}</span>
      </div>

      <div className="input-wrap" style={{ marginTop: 10 }}>
        <input
          type="number"
          inputMode="decimal"
          min={MIN_TRANSFER_AMOUNT}
          step="0.001"
          placeholder={t('transfer.amountPlaceholder')}
          value={s.amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-label={t('transfer.amountPlaceholder')}
        />
        <span className="suffix">AI3</span>
      </div>

      <div className="btn-group">
        {PERCENTS.map((p) => (
          <button
            key={p}
            className="btn"
            onClick={() => setAmountPercent(p)}
            disabled={!srcBal}
          >
            {p === 100 ? t('transfer.max') : `${p}%`}
          </button>
        ))}
      </div>

      {amountNum >= MIN_TRANSFER_AMOUNT && (
        <p className="hint-line">
          {t('transfer.receive', [(amountNum * 0.9999).toFixed(4)])}
        </p>
      )}

      {reason && <p className="hint-line warn">{t(reason, [MIN_TRANSFER_AMOUNT])}</p>}
      <p className="hint-line">{t('transfer.minTransfer', [MIN_TRANSFER_AMOUNT])}</p>
      <p className="hint-line">{isC2E ? t('transfer.arrivalNoteC2E') : t('transfer.arrivalNoteE2C')}</p>

      <button
        className="btn primary big"
        style={{ marginTop: 14 }}
        onClick={performTransfer}
        disabled={!enabled}
      >
        {label}
      </button>
      {s.isTransferring && s.currentStatus && (
        <p className="transfer-status">{statusLabel(s.currentStatus, t)}</p>
      )}
    </div>
  );
}
