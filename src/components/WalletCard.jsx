// src/components/WalletCard.jsx
//
// Both wallet cards (Consensus / Auto-EVM) share one layout: one button per
// discovered wallet (PermaDrive pattern — with Phantom, SubWallet and
// MetaMask installed, the user picks which one to use) → address (click to
// copy) → balances. Kept as two subcomponents because the Consensus side
// carries the account selector and the linked EVM row.
//
// Chain identity colors (shared family rule): consensus = teal, EVM =
// purple. Card titles and the EVM-side rows inside the consensus card are
// tinted accordingly so users learn passively which chain holds the money.

import { useEffect, useState } from 'react';
import { useEngine } from '@/state/engine';
import { useI18n } from '@/i18n';
import { toast } from '@/ui/dialogs';
import { EVM_CHAIN_ID } from '@/constants';
import { discoverConsensusWallets, discoverEvmWallets } from '@/lib/wallets';
import { consensusConnected, connectConsensus, connectEVM, disconnectConsensus, disconnectEVM, updateBalances, switchConsensusAccount, substrateAccountOptions } from '@/state/transfer';

const truncate = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

// navigator.clipboard only exists in secure contexts (https / localhost) —
// LAN http testing has neither, so fall back to the legacy execCommand path.
async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand copy returned false');
  } finally {
    document.body.removeChild(ta);
  }
}

function useCopyAddress() {
  const { t } = useI18n();
  return async (text) => {
    try {
      await copyTextToClipboard(text);
      toast({ type: 'ok', title: t('notifications.success'), message: t('notifications.addressCopied'), duration: 2000 });
    } catch (err) {
      console.error('Failed to copy address:', err);
      toast({ type: 'danger', title: t('notifications.error'), message: t('notifications.addressCopyFailed') });
    }
  };
}

function Balance({ value, loading }) {
  // null = not loaded yet (or read failed) — show '—', never a fake 0.
  return (
    <span className="balance-value mono">
      {loading ? '…' : value == null ? '—' : `${value} AI3`}
    </span>
  );
}

// Icon-only refresh (PermaDrive WalletBalance pattern): the glyph is the
// label, the accessible name carries the meaning.
function WalletActions({ onRefresh, refreshing, onDisconnect }) {
  const { t } = useI18n();
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <button
        className="btn ghost small icon"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={t('wallet.refreshBalance')}
        title={t('wallet.refreshBalance')}
      >
        ⟳
      </button>
      <button className="btn small ghost danger" onClick={onDisconnect}>
        {t('wallet.disconnect')}
      </button>
    </div>
  );
}

// One button per discovered wallet; '…' while the connect prompt is open.
function WalletButtons({ wallets, connecting, onConnect, nameKey }) {
  return (
    <div className="btn-group" style={{ marginTop: 2 }}>
      {wallets.map((w, i) => (
        <button key={`${w[nameKey] ?? w.title}-${i}`} className="btn" disabled={connecting} onClick={() => onConnect(w)}>
          {connecting ? '…' : nameKey === 'name' ? w.name : w.title}
        </button>
      ))}
    </div>
  );
}

function ConsensusWallet() {
  const s = useEngine();
  const { t } = useI18n();
  const copyAddress = useCopyAddress();
  const [connecting, setConnecting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [wallets, setWallets] = useState(null);
  const connected = consensusConnected(s);
  const accounts = substrateAccountOptions(s);

  // Discovery is read-only (enable happens on click). Re-run whenever
  // disconnected: covers wallets that inject after first paint and newly
  // installed/enabled ones.
  useEffect(() => {
    if (connected) return undefined;
    setWallets(discoverConsensusWallets());
    const timer = setTimeout(() => setWallets(discoverConsensusWallets()), 800);
    return () => clearTimeout(timer);
  }, [connected]);

  const onConnect = async (wallet) => {
    setConnecting(true);
    try {
      await connectConsensus(wallet);
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
        <h2 className="txt-consensus">{t('wallet.consensusChain')}</h2>
        <span className={`badge ${connected ? 'ok' : ''}`}>{connected ? t('wallet.connected') : t('wallet.disconnected')}</span>
      </div>

      {!connected && (wallets == null ? null : wallets.length === 0 ? (
        <p className="wallet-note">{t('wallet.noConsensusWallet')}</p>
      ) : (
        <WalletButtons wallets={wallets} connecting={connecting} onConnect={onConnect} />
      ))}

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
                <span className="txt-evm">{t('wallet.linkedEvmAddress')}</span>
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
                <span className="txt-evm">{t('wallet.evmChain')}</span>
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
  const [wallets, setWallets] = useState(null);
  const connected = !!s.evmAddress;

  // Async discovery (EIP-6963 announcements take ~500 ms); re-run whenever
  // disconnected, same as the consensus side.
  useEffect(() => {
    if (connected) return undefined;
    let alive = true;
    discoverEvmWallets().then((list) => {
      if (alive) setWallets(list);
    });
    return () => {
      alive = false;
    };
  }, [connected]);

  const onConnect = async (wallet) => {
    setConnecting(true);
    try {
      await connectEVM(wallet);
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
        <h2 className="txt-evm">{t('wallet.evmChain')}</h2>
        <span className={`badge ${connected ? 'ok' : ''}`}>{connected ? t('wallet.connected') : t('wallet.disconnected')}</span>
      </div>

      {!connected && (wallets == null ? null : wallets.length === 0 ? (
        <p className="wallet-note">{t('wallet.evmNotDetected')}</p>
      ) : (
        <WalletButtons wallets={wallets} connecting={connecting} onConnect={onConnect} nameKey="name" />
      ))}

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
          {s.evmChainId != null && s.evmChainId !== EVM_CHAIN_ID && (
            <p className="hint-line warn">{t('wallet.evmWrongNetwork', [String(s.evmChainId)])}</p>
          )}
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
