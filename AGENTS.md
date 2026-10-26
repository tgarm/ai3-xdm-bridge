# AGENTS.md

Guidance for AI agents (and new contributors) working in this repository.

## What this is

ai3-xdm-bridge — a minimal web UI for Autonomys XDM (cross-domain) token
transfers between the consensus chain and the Auto-EVM domain.
Public open-source repo: `github.com/tgarm/ai3-xdm-bridge`.

## Ground rules

- **This repo is public — everything in it must be self-contained.** No
  references to private infrastructure or internal working notes: no LAN
  hostnames (e.g. `dl-minipc`), no `my-drive` or other repos' doc trees
  (`doc/0x…`), no internal project phase jargon (P0–P4). Cite provenance in
  a self-contained form instead: public URLs, on-chain tx hashes, dates.
  Before committing, self-check with:
  `grep -rniE 'doc/0|dl-minipc|my-drive' --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git --exclude=AGENTS.md .`
- **English only** — docs, code comments, CLI output. (The UI itself ships
  en/zh/es/de translations by design.)
- Match the existing style: plain JS (ESM), React 18, hand-rolled CSS with
  design tokens (no UI framework), vitest for pure logic.
- All on-chain requests go through the shared throttle
  (`src/lib/pacedProvider.js`) — the public Autonomys RPCs rate-limit and
  IP-ban aggressive clients; never dial providers directly.
- Small commits explaining "why"; push to GitHub `tgarm/ai3-xdm-bridge`.
