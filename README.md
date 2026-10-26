XDM Bridge Web Interface for AI3
--------------------------------

XDM - Cross Domain

The official XDM transfer method described in Autonomys docs (https://docs.autonomys.xyz/xdm/substrate-portal — the old `/farming/guides/xdm/` URL is gone), is not quite user friendly, user need to use polkadot.js.org development interface, and fill address and transfer amount in a very long format manually.

To simplify the transfer operation, I created this web interface.

User may easily transfer from Consensus to Auto-EVM domain, and vice versa.

The transfer progress/history panel is working for Consensus to Auto-EVM transfer. For Auto-EVM to Consensus, the transfer is sent via the transporter precompile; the app then tracks the ~24h challenge period in the history panel with a manual "mark as received" confirmation.

### Ecosystem update (2026-10-26)

Times have changed since this bridge was first built — the XDM protocol is unchanged, but the surrounding ecosystem is not:

- The official docs were restructured (XDM now lives under `docs.autonomys.xyz/xdm/`) and for most users now recommend the community **Subspace Tools XDM sender** (`subspace.tools/xdm/send`): both transfer directions, an address-based transfer-status page, an XDM channel inspector, and a WAI3 wrap/unwrap tool.
- An official **Hyperlane-based bridge** (`bridge.mainnet.autonomys.xyz`) now connects Auto EVM to external chains — Ethereum, BNB Chain and Solana are all live. XDM remains the native consensus↔domain path.
- Protocol parameters are unchanged: min transfer 1 AI3, C2E ~100 consensus blocks (docs say ~10 min; field-measured ~25 min), E2C ~14,400 domain blocks (~1 day challenge period); the XDM fee is now documented as 5x standard weight.
- `@autonomys/auto-xdm` 1.6.5+ ships the transporter precompile helpers this app hand-rolled for E2C (its "mainnet coming soon" comment is stale — the precompile has long been deployed on mainnet).

This app still earns its keep with paced-RPC rate-limit protection (the public RPCs IP-ban aggressive clients), the 30-minute arrival window, multi-account support, Subscan-backed history and i18n — but for a one-off transfer, subspace.tools is the lower-effort path; consider contributing improvements there instead of parallel feature work. All items above were verified against the official docs, the auto-sdk changelog and npm on 2026-10-26.

### Reliability notes (2026-10-26 rework)

- All on-chain requests go through one shared throttle (paced providers) — the public Autonomys RPCs rate-limit by request frequency and IP-ban offenders for 30+ minutes.
- No custom type injections: mainnet metadata natively registers all transporter types, and extrinsics are constructed directly (`api.tx.transporter.transfer`).
- E2C transfers use the transporter precompile (`transfer_to_consensus_v1`) instead of a Substrate API instance of the EVM domain.
- C2E arrival watching polls the destination balance for up to 30 minutes (field-measured arrival: ~25 min), with a block-scan fallback if websocket status events are lost.
- Multi-account support: switch the active Consensus account from the wallet panel.

### UI rework (2026-10-26, v0.3)

- Rewritten from Vue 3 + Element Plus to **React 18 + hand-rolled CSS**, matching the PermaDrive design system (see `doc/07-ui-style-guide.md` in the `tgarm/permadrive` repo). UI CSS dropped from ~340 KB to ~9 KB.
- Dual theme: dark (default) and light, following the system preference with a manual toggle; choice persists and is applied before first paint.
- Step-based layout (① connect wallets → ② transfer → ③ progress & history); the transfer button always explains why it is disabled; in-flight transfers are now visible in the history panel with a live countdown (previously only Subscan-finalized entries were shown).
- In-flight transfer logic is ported 1:1 from the field-tested Vue implementation into framework-agnostic modules (`src/state/`, `src/lib/`); `src/lib/amount.js` keeps its vitest coverage.
- i18n (en/zh/es/de) kept, now served by a minimal built-in loader; dark/light toggle and language switch live in the header.

Co-operation is welcome.
