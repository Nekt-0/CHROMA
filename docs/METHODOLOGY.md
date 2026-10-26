# Measurements, ranking and limitations

## Data provenance

Live reads use the public [DEX Screener API](https://docs.dexscreener.com/api/reference):

- `/token-profiles/latest/v1` for bounded profile discovery.
- `/token-pairs/v1/solana/{mint}` for market pairs.

The observation timestamp is when CHROMA received the response. It is not a block time or an attestation that all provider fields were refreshed simultaneously. The selected raw measurements, pair identity, source name and timestamp are saved in every snapshot. Full raw HTTP bodies are not retained.

Profiles can reflect promotion and provider coverage. Discovery is not exhaustive or a claim to identify a mint's launch time. The scanner validates address syntax, then selects Solana pairs where the requested mint is the **base** token. It selects the highest reported USD liquidity; ties break by pair address. Quote-only matches are excluded because their price belongs to another base asset. When the selected pool changes, comparison records omit a reference-price delta.

## Evaluation

The eight checks and their numeric thresholds are in `src/config.mjs`. Each pass is worth 12.5 points. The displayed score is `round(100 × passes / 8)` with no learned model or hidden weighting.

Order of status rules:

1. Any missing check input → `INCOMPLETE`.
2. A failed `PRICE` or `DEPTH` check → `FILTERED`.
3. Score ≥75 → `TRACK`.
4. Score ≥50 → `WATCH`.
5. Otherwise → `FILTERED`.

Queue ordering is status, descending score, descending liquidity, then token address. `TRACK` is a research priority, not an instruction to enter. No backtest or calibrated predictive accuracy is claimed.

Buy share measures swap counts, not dollar flow or unique people. Turnover divides historical one-hour volume by the current liquidity estimate. Pair age is distinct from token age. USD reference prices and liquidity can be inaccurate. No check proves sellability, acceptable execution, absence of malicious authorities, authentic holders, absence of wash trading or profitable future performance.

## Recording changes

Snapshots include the exact rule object and the eight result states. Comparisons preserve the previous status, new status and, within the same pair, reference-price movement. Discovery, observations, status changes and pool changes are distinct event kinds inside snapshot records. Provider failures are separate events. A failed previously seen token reconstructs as `UNAVAILABLE`; the prior snapshot remains in the history with its original time.

The exclusive writer lock protects the read-modify-append cycle. Completed writes are flushed to disk. If a crash leaves a lock file, stop all writers before removing that stale lock. If a write is truncated, restore a known-good backup; CHROMA does not silently repair or discard evidence. The full journal is currently loaded in memory, so long-running research sessions should use separate directories and backups.

The hash chain is a local integrity tool, not a blockchain or tamper-proof database. Anyone who can rewrite the entire file can recompute its hashes. External attestation and provider reconciliation are future work.

## Session arithmetic

Balances and external flows are parsed as nonnegative decimal SOL with at most nine fractional digits and converted to BigInt lamports.

`displayed change = end balance − start balance`

`balance increase % = displayed change / start balance × 100`

`flow-adjusted change = displayed change − deposits + withdrawals`

Flow-adjusted change is unknown unless both external flows are supplied. A zero starting balance has no defined percentage increase. Percentages are truncated to four decimal places internally and rounded to one place by the terminal.

The supplied post's `277.78 → 310.00 SOL` yields `+32.22 SOL`, approximately `+11.6%`. This is a statement about reported balances. There are no original wallet addresses, individual trade receipts, open-position marks, deposits or withdrawals available in this repository to establish realized profit. Fees and execution costs already included in balances must not be deducted again.

The capture count is a manually reported field. `capture` adds a research note; it does not fill an order or validate that reported count. The synthetic demo targets are independent of the supplied session figures. Demo mode performs no provider reads and writes no journal records.
