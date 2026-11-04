# XDM Bridge

> XDM Bridge — a web interface for Autonomys cross-domain (XDM) AI3 transfers between the consensus chain and Auto EVM. Pure frontend, no accounts, no backend: transfers are plain on-chain operations signed by your own wallets.

The official XDM flow described in the [Autonomys docs](https://docs.autonomys.xyz/xdm/substrate-portal) requires the polkadot.js.org developer interface, where the recipient address and amount must be filled into a long manual call format. This app does the same transfer in a few clicks, for both directions.

**Try it: [xdm-bridge.ai3.land](https://xdm-bridge.ai3.land/)**

## Features

- **Both directions** — Consensus → Auto EVM and Auto EVM → Consensus.
- **Progress & history** — C2E arrivals are watched for up to 30 minutes (field-measured: ~25 min) with a block-scan fallback and an on-chain finality check; in-flight transfers stay visible in the history panel across reloads, with a live countdown. E2C transfers are sent via the transporter precompile and the panel tracks the ~24h challenge period with a manual "mark as received" confirmation.
- **Rate-limit friendly** — every on-chain request goes through one shared throttle: the public Autonomys RPCs rate-limit by request frequency and IP-ban offenders for 30+ minutes.
- **Multi-account** — switch the active Consensus account from the wallet panel; E2C works from any EVM wallet.
- **Transfer history** — on-chain history lookup with Subscan links (a Subscan API key is optional).
- **Fresh balances** — both wallet panels show AI3 balances that refresh automatically.
- **i18n** — English, 中文, Español, Deutsch.
- **Dark / light theme** — follows the system preference with a manual toggle; the choice persists and is applied before first paint.

## Usage

- Open [xdm-bridge.ai3.land](https://xdm-bridge.ai3.land/) — or host the build output yourself; the app is fully static with no environment variables or API keys.
- Connect a Substrate extension wallet (Talisman / SubWallet) on the consensus side and an EVM wallet on the Auto EVM side (chainId 870).
- Minimum transfer: 1 AI3. C2E arrivals take ~25 minutes; E2C includes a ~1 day challenge period, after which you confirm receipt in the history panel.
- Transfers carry a small on-chain XDM protocol fee (~0.01%) — charged by the XDM protocol, not by this site. The site never holds funds.

## Development

Requires Node.js 22+.

```bash
npm install
npm run dev      # Vite dev server
npm run build    # static output → dist/
npm test         # vitest
```

Implementation notes:

- All on-chain requests go through the shared throttle in `src/lib/pacedProvider.js` — public Autonomys RPCs rate-limit by request frequency and IP-ban aggressive clients for 30+ minutes.
- No custom type injections: mainnet metadata natively registers all transporter types, and extrinsics are constructed directly (`api.tx.transporter.transfer`).
- E2C transfers use the transporter precompile (`transfer_to_consensus_v1`) instead of a Substrate API instance of the EVM domain.
- Transfer logic lives in framework-agnostic modules (`src/state/`, `src/lib/`); `src/lib/amount.js` and friends keep vitest coverage.
- Plain JS (ESM), React 18, hand-rolled token-based CSS with a dual theme.

## History

Dated ecosystem notes, reliability decisions and the version history: [HISTORY.md](HISTORY.md).

## Sister projects

- **[PermaDrive](https://permadrive.ai3.land/)** — permanent on-chain file storage for Autonomys · [source](https://github.com/tgarm/permadrive)
- **[ai3.land](https://ai3.land/)** — landing page for the tool family

Co-operation is welcome.

## License

[MIT](LICENSE)
