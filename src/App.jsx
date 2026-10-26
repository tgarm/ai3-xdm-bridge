// src/App.jsx
import { useEffect } from 'react';
import { useI18n } from '@/i18n';
import { stopPolling, disconnectApis } from '@/state/transfer';
import { WalletCard } from '@/components/WalletCard';
import { TransferPanel } from '@/components/TransferPanel';
import { HistoryPanel } from '@/components/HistoryPanel';
import { LogsPanel } from '@/components/LogsPanel';
import { DocsPanel } from '@/components/DocsPanel';
import { DialogHost } from '@/components/DialogHost';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LanguageSelect } from '@/components/LanguageSelect';

export default function App() {
  const { t } = useI18n();

  // Same lifecycle the Vue app had: stop watchers / drop APIs on teardown.
  useEffect(() => () => {
    stopPolling();
    disconnectApis();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <div>
            <h1>{t('app.title')}</h1>
            <p className="tagline">{t('app.tagline')}</p>
          </div>
        </div>
        <div className="header-controls">
          <ThemeToggle />
          <LanguageSelect />
        </div>
      </header>

      <main>
        <h2 className="section-title"><span className="step-badge">1</span>{t('section.wallets')}</h2>
        <div className="grid-2">
          <WalletCard variant="consensus" />
          <WalletCard variant="evm" />
        </div>

        <h2 className="section-title"><span className="step-badge">2</span>{t('section.transfer')}</h2>
        <TransferPanel />

        <h2 className="section-title"><span className="step-badge">3</span>{t('section.track')}</h2>
        <HistoryPanel />
        <LogsPanel />
        <DocsPanel />
      </main>

      <footer className="app-footer muted">
        {t('app.footer')}
        {' · '}
        <a href="https://github.com/tgarm/ai3-xdm-bridge" target="_blank" rel="noreferrer noopener">{t('app.source')}</a>
      </footer>
      <DialogHost />
    </div>
  );
}
