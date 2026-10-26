XDM Bridge Web Interface for AI3
--------------------------------

XDM - Cross Domain

The official XDM transfer method described in Autonomys at (https://docs.autonomys.xyz/farming/guides/xdm/), is not quite user friendly, user need to use polkadot.js.org development interface, and fill address and transfer amount in a very long format manually.

To simplify the transfer operation, I created this web interface.

User may easily transfer from Consensus to Auto-EVM domain, and vice versa.

The transfer progress/history panel is working for Consensus to Auto-EVM transfer. For Auto-EVM to Consensus, the transfer is sent via the transporter precompile; the app then tracks the ~24h challenge period in the history panel with a manual "mark as received" confirmation.

### Reliability notes (2026-10-26 rework)

- All on-chain requests go through one shared throttle (paced providers) — the public Autonomys RPCs rate-limit by request frequency and IP-ban offenders for 30+ minutes.
- No custom type injections: mainnet metadata natively registers all transporter types, and extrinsics are constructed directly (`api.tx.transporter.transfer`).
- E2C transfers use the transporter precompile (`transfer_to_consensus_v1`) instead of a Substrate API instance of the EVM domain.
- C2E arrival watching polls the destination balance for up to 30 minutes (field-measured arrival: ~25 min), with a block-scan fallback if websocket status events are lost.
- Multi-account support: switch the active Consensus account from the wallet panel.

Co-operation is welcome.
