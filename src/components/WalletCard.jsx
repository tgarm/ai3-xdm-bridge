// src/components/WalletCard.jsx
//
// Both wallet cards (Consensus / Auto-EVM) share one layout: connect button
// → address (click to copy) → balances. Kept as two subcomponents because
// the Consensus side carries the account selector and the linked EVM row.

import { useState } from 'react';
import { useEngine } from '@/state/engine';
import { useI18n } from '@/i18n';
import { toast } from '@/ui/dialogs';
import { consensusConnected, connectConsensus, connectEVM, disconnectConsensus, disconnectEVM, updateBalances, switchConsensusAccount, substrateAccountOptions } from '@/state/transfer';

const truncate = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

function useCopyAddress() {
  const { t } = useI18n();
  return async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ type: 'ok', title: t('notifications.success'), message: t('notifications.addressCopied'), duration: 2000 });
    } catch (err) {
      console.error('Failed to copy address:', err);
      toast({ type: 'danger', title: t('notifications.error'), message: t('notifications.addressCopyFailed') });
    }
  };
}

function Balance({ value, loading }) {
  return (
    <span className="balance-value mono">
      {loading ? '…' : `${value} AI3`}
    </span>
  );
}

function WalletActions({ onRefresh, refreshing, onDisconnect }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button className="btn small" onClick={onRefresh} disabled={refreshing}>
        {refreshing ? '…' : t('wallet.refreshBalance')}
      </button>
      <button className="btn small ghost danger" onClick={onDisconnect}>
        {t('wallet.disconnect')}
      </button>
    </div>
  );
}

function ConsensusWallet() {
  const s = useEngine();
  const { t } = useI18n();
  const copyAddress = useCopyAddress();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const connected = consensusConnected(s);
  const accounts = substrateAccountOptions(s);

  const onButtonClick = async () => {
    setConnecting(true);
    try {
      await connectConsensus();
    } finally {
      setConnecting(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await updateBalances();
      toast({ type: 'ok', title: t('notifications.success'), message: t('notifications.balancesRefreshed'), duration: 2000 });
    } catch (error) {
      console.error('Balance refresh error:', error);
      toast({ type: 'danger', title: t('notifications.error'), message: t('notifications.balanceRefreshFailed') });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('wallet.consensusChain')}</h2>
        <span className={`badge ${connected ? 'ok' : ''}`}>{connected ? t('wallet.connected') : t('wallet.disconnected')}</span>
      </div>

      {!connected && (
        <button className="btn primary big" onClick={onButtonClick} disabled={connecting}>
          {connecting ? '…' : t('wallet.connectSubwallet')}
        </button>
      )}

      {connected && (
        <>
          <div className="address-row">
            <span className="mono" title={t('wallet.copyAddressTooltip')} onClick={() => copyAddress(s.consensusAddress)}>
              {s.consensusAddress}
            </span>
          </div>

          {accounts.length > 1 && (
            <div className="field" style={{ marginTop: 10 }}>
              <span>{t('wallet.selectAccount')}</span>
              <select value={s.consensusAccount?.address || ''} onChange={(e) => switchConsensusAccount(e.target.value)}>
                {accounts.map((acc) => (
                  <option key={acc.address} value={acc.address}>{acc.label}</option>
                ))}
              </select>
            </div>
          )}

          <div className="kv">
            <span>{t('wallet.consensusChain')}</span>
            <Balance value={s.consensusBalance} loading={s.consensusBalanceLoading} />
          </div>

          {s.substrateLinkedEvmAddress && (
            <>
              <div className="kv">
                <span>{t('wallet.linkedEvmAddress')}</span>
                <span
                  className="mono"
                  title={t('wallet.copyAddressTooltip')}
                  style={{ cursor: 'pointer' }}
                  onClick={() => copyAddress(s.substrateLinkedEvmAddress)}
                >
                  {truncate(s.substrateLinkedEvmAddress)}
                </span>
              </div>
              <div className="kv">
                <span>{t('wallet.evmChain')}</span>
                <Balance value={s.substrateLinkedEvmBalance} loading={s.substrateLinkedEvmBalanceLoading} />
              </div>
            </>
          )}

          <WalletActions
            onRefresh={onRefresh}
            refreshing={refreshing}
            onDisconnect={disconnectConsensus}
          />
        </>
      )}
    </div>
  );
}

function EvmWallet() {
  const s = useEngine();
  const { t } = useI18n();
  const copyAddress = useCopyAddress();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const connected = !!s.evmAddress;
  const hasInjected = typeof window.ethereum !== 'undefined';

  const onButtonClick = async () => {
    setConnecting(true);
    try {
      await connectEVM();
    } finally {
      setConnecting(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await updateBalances();
      toast({ type: 'ok', title: t('notifications.success'), message: t('notifications.balancesRefreshed'), duration: 2000 });
    } catch (error) {
      console.error('Balance refresh error:', error);
      toast({ type: 'danger', title: t('notifications.error'), message: t('notifications.balanceRefreshFailed') });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('wallet.evmChain')}</h2>
        <span className={`badge ${connected ? 'ok' : ''}`}>{connected ? t('wallet.connected') : t('wallet.disconnected')}</span>
      </div>

      {!connected && !hasInjected && (
        <p className="wallet-note">{t('wallet.evmNotDetected')}</p>
      )}
      {!connected && (
        <button className="btn primary big" onClick={onButtonClick} disabled={connecting || !hasInjected}>
          {connecting ? '…' : t('wallet.connectMetamask')}
        </button>
      )}

      {connected && (
        <>
          <div className="address-row">
            <span className="mono" title={t('wallet.copyAddressTooltip')} onClick={() => copyAddress(s.evmAddress)}>
              {s.evmAddress}
            </span>
          </div>
          <div className="kv">
            <span>{t('wallet.evmChain')}</span>
            <Balance value={s.evmBalance} loading={s.evmBalanceLoading} />
          </div>
          <WalletActions
            onRefresh={onRefresh}
            refreshing={refreshing}
            onDisconnect={disconnectEVM}
          />
        </>
      )}
    </div>
  );
}

export function WalletCard({ variant }) {
  return variant === 'evm' ? <EvmWallet /> : <ConsensusWallet />;
}
