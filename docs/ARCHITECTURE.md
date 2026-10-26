# Architecture

CHROMA is an ESM Node.js application with no runtime packages, server or build step.

```text
public token profiles / supplied mints
                 |
            provider.mjs
     timed, bounded public HTTP reads
                 |
             engine.mjs
   normalize → select pair → eight checks → rank
                 |
            journal.mjs
   compare → lock → append → flush → hash verification
                 |
       cli.mjs / terminal.mjs
       queue / record / session
                 |
             export.mjs
        JSON / Markdown receipts
```

`demo.mjs` supplies deterministic synthetic snapshots directly to the same evaluation engine and renderer. It does not call the provider or persist journal events. `scripts/brand.mjs` generates the README's static vector assets from the same terminal renderer.

| Module | Responsibility |
| --- | --- |
| `config.mjs` | Thresholds, bounded text sanitation and address syntax |
| `engine.mjs` | Pair normalization, check states, ranking, transitions and lamport arithmetic |
| `provider.mjs` | Public HTTP reads, timeouts and per-target failure receipts |
| `journal.mjs` | Exclusive writer lock, append-only events, fsync and hash validation |
| `render.mjs` | Plain-text queue, history and balance views with optional ANSI color |
| `terminal.mjs` | Keyboard control, refresh scheduling, screen restoration and exports |
| `export.mjs` | Versioned historical JSON and readable Markdown |
| `cli.mjs` | Argument parsing and command dispatch |

Persistent state lives under `.chroma/` by default and is excluded from Git. No wallet secret, signer, transaction builder, execution service, telemetry sender or inbound server is present. Provider requests disclose requested public mint addresses to DEX Screener.

Records contain `seq`, `previousHash`, `type`, `at`, `data` and `hash`. SHA-256 covers the serialized record payload before the `hash` field is appended. Reconstruct the latest state by replaying successful snapshots and provider-error records. Notes and balances are independent event types.

The v0.1 storage model is designed for local research, not an unbounded multi-user service. It validates and loads the entire journal at each write. There is no database compaction, immutable external anchor, authentication layer or trading engine.
