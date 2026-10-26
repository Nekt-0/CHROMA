# Architecture

CHROMA is an ESM Node.js application with no server or build step. Scanning has no package-install requirement. The optional trading commands lazily load the pinned `@solana/web3.js` SDK.

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
| `trading.mjs` | Jupiter ExactIn orders, transaction validation, simulation, local signing, explicit execution and reconciliation |

Persistent state lives under `.chroma/` by default and is excluded from Git. DEX Screener reads and full-screen scanning do not access a wallet. TRADE uses a separate command path: Jupiter order → intent inspection → mainnet simulation → user confirmation → local SDK signature → durable signature record → Jupiter execution → RPC status. There is no automatic connection from the ranked queue to an execution call.

Wallets are loaded only from an explicitly supplied local CLI keypair path (or `CHROMA_WALLET` for execution). Private bytes are not exported or sent to providers. Jupiter receives the signed transaction; the RPC receives public queries and unsigned simulations. No telemetry sender or inbound server is present.

Records contain `seq`, `previousHash`, `type`, `at`, `data` and `hash`. SHA-256 covers the serialized record payload before the `hash` field is appended. Reconstruct the latest state by replaying successful snapshots and provider-error records. Notes and balances are independent event types.

The v0.2 storage model is designed for local use, not an unbounded multi-user service. It validates and loads the entire journal at each write. Trade submission and status receipts share the same hash-linked journal. There is no database compaction, immutable external anchor, multi-user authentication or autonomous trading loop. [Execution boundaries](TRADING.md).
