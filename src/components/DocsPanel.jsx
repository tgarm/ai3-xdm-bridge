// src/components/DocsPanel.jsx
import { useState } from 'react';
import { CONSENSUS_RPC, MIN_TRANSFER_AMOUNT, AUTONOMYS_PREFIX, EVM_CHAIN_ID } from '@/constants';
import { useI18n } from '@/i18n';

const link = (href, label) => `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
const code = (text) => `<code>${text}</code>`;

export function DocsPanel() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <details className="section" open={open} onToggle={(e) => setOpen(e.target.open)}>
      <summary>
        {t('docs.title')}
        <span className="summary-mark">{open ? '−' : '+'}</span>
      </summary>
      <div className="section-body doc-content">
        <h3>{t('docs.c2eTitle')}</h3>
        <p>{t('docs.c2eBody')}</p>

        <h3>{t('docs.e2cTitle')}</h3>
        <p dangerouslySetInnerHTML={{ __html: t('docs.e2cBody', [link('https://docs.autonomys.xyz/farming/guides/xdm/#auto-evm-domain-to-consensus-with-polkadotjs', t('docs.e2cLinkText'))]) }} />

        <h3>{t('docs.setupTitle')}</h3>
        <ul>
          <li dangerouslySetInnerHTML={{ __html: t('docs.setupConsensus', [code(CONSENSUS_RPC), code(AUTONOMYS_PREFIX)]) }} />
          <li dangerouslySetInnerHTML={{ __html: t('docs.setupEvm', [code(EVM_CHAIN_ID), link('https://chainlist.org/chain/870', 'Chainlist')]) }} />
          <li dangerouslySetInnerHTML={{ __html: t('docs.setupMinTransfer', [code(MIN_TRANSFER_AMOUNT)]) }} />
          <li dangerouslySetInnerHTML={{ __html: t('docs.setupSdkLink', [link('https://docs.autonomys.xyz/farming/guides/xdm/', 'XDM Guide'), link('https://docs.autonomys.xyz/developers/auto-sdk/', 'Auto-SDK')]) }} />
        </ul>

        <h3>{t('docs.aboutTitle')}</h3>
        <p dangerouslySetInnerHTML={{ __html: t('docs.aboutBody', [link('https://github.com/tgarm/ai3-xdm-bridge', 'GitHub')]) }} />
      </div>
    </details>
  );
}
