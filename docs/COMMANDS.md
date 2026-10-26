# CHROMA commands

All examples run from the repository root using Node.js 22+. No install step is required.

| Command | Purpose | Writes local history? |
| --- | --- | --- |
| `node src/cli.mjs demo` | Interactive synthetic walkthrough; one printout without a TTY | No |
| `node src/cli.mjs demo --once` | Static synthetic queue | No |
| `node src/cli.mjs demo --json` | Synthetic queue plus supplied post metrics | No |
| `node src/cli.mjs scan --discover --limit 5` | One live sweep over latest Solana profiles | Yes |
| `node src/cli.mjs scan --tokens A,B --json` | Live sweep over 1–20 public mints | Yes |
| `node src/cli.mjs watch --tokens A,B` | Periodic live TUI | Yes |
| `node src/cli.mjs watch --discover --interval 60` | Periodic profile discovery and live TUI | Yes |
| `node src/cli.mjs history --json` | Full event history | No |
| `node src/cli.mjs history --token A` | Events belonging to a token | No |
| `node src/cli.mjs capture --token A --note "Depth recovered"` | A research observation for a previously scanned token | Yes |
| `node src/cli.mjs session --start 277.78 --end 310 --captures 5` | User-reported balances and capture count | Yes |
| `node src/cli.mjs session --start 10 --end 16 --deposits 8 --withdrawals 1` | Report balances and known external flows | Yes |
| `node src/cli.mjs verify` | Validate record numbering and linked hashes | No |
| `node src/cli.mjs export --out exports/session.json` | Historical JSON receipt | Export file only |
| `node src/cli.mjs export --format md --out exports/session.md` | Readable historical receipt | Export file only |
| `node src/cli.mjs doctor` | Runtime and journal check | No |
| `node src/cli.mjs doctor --probe` | Also query public profile endpoint | No |
| `node src/cli.mjs quote --output-mint M --amount-sol 0.001` | Public Jupiter quote; default input is SOL | No |
| `node src/cli.mjs trade --taker A --output-mint M --amount N` | Inspect and simulate an unsigned ExactIn swap | No |
| `node src/cli.mjs trade --wallet PATH --output-mint M --amount N --execute` | Review, confirm, sign and submit a real mainnet swap | Yes |
| `node src/cli.mjs trade-status --signature S` | Reconcile a signature with the mainnet RPC | For a recorded attempt |

`A` and `B` are placeholders for Solana mint addresses, not literal command inputs. The address check validates the base58 alphabet and length; it does not prove that an address exists or is a token mint.

`--dir PATH` selects a journal directory for live scans, history, notes, balance reports, verification and exports. Keep one directory per research run. `--out` is an explicit file path; an existing file causes an error. Export without `--out` prints to stdout.

Live watch intervals must be 30–3600 seconds. Each sweep makes at most one discovery request plus twenty sequential pair requests. A manual refresh obeys the same interval in live mode. Avoid launching many instances against the same provider.

`scan` exits with status 1 when any target request fails; successful snapshots and failed target receipts are still recorded. Invalid arguments, provider discovery failures, invalid journals and file errors also produce a nonzero exit. Watch mode keeps the previous rows labelled unavailable when a refresh fails. Read each observation timestamp; an export is historical data, not a current quote.

In a TTY: ↑ / ↓ or j / k selects a row; 1 / 2 / 3 switches views; r refreshes; e exports; q or Ctrl+C exits. Set `NO_COLOR=1` in your shell to disable terminal color.

TRADE requires the pinned SDK (`pnpm install --frozen-lockfile --ignore-scripts`). `M` is an output mint, `N` is an integer in atomic token units, `A` is a public taker and `S` is a transaction signature. Use `--amount-sol` only for SOL input. Execution requires `--execute`, a local wallet and per-order interactive confirmation; no noninteractive approval flag is provided. See [TRADING.md](TRADING.md) for fee limits, supported transaction layouts and UNKNOWN recovery.
