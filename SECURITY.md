# Security

CHROMA has DEMO, SCAN and TRADE modes. DEMO and SCAN need no wallet. TRADE can sign and submit mainnet swaps when the user supplies a local Solana CLI keypair, passes `--execute` and confirms the exact order interactively.

Unsigned preview is the default. Execution is limited to self-funded v0 Jupiter Metis transactions with reviewed route layouts, expected wallet/token accounts, bounded encoded amounts and priority fees, supported top-level programs, mainnet verification and successful RPC simulation. Unknown layouts, extra signers, token approvals and unexpected SOL transfers are rejected. This validation is not an independent audit of Jupiter, its CPI routes, token contracts or the RPC provider.

Keep keypairs outside the repository or under an ignored private directory. The code loads only an explicitly selected wallet, never writes private keys into the journal and sends only signed transactions to Jupiter. Use a dedicated trading wallet with funds appropriate to the intended swap. API credentials belong in environment variables or a local ignored `.env` file.

The journal records a signature before submission. HTTP failures and pending on-chain status remain UNKNOWN. A provider's Success response alone is not confirmation. Query `trade-status` before retrying a swap with a new quote. A confirmed transaction can still be economically undesirable; confirmations do not establish profit.

Provider token names and symbols are untrusted; terminal control characters are stripped and display strings are bounded. Provider URLs are fixed in source. Requests time out after ten seconds. Live scans retain errors instead of fabricating missing values.

Journal verification detects broken record numbering, linked hashes and truncated records. It is not an external attestation, and a full file rewrite can recompute the entire chain. Keep independent backups. Do not remove a writer lock while another CHROMA process is active.

Local exports can contain public addresses, your notes, transaction signatures and manually reported balances. Review them before sharing. `.chroma/`, `exports/`, `.keys/` and `wallets/` are excluded from Git by default.

Report suspected issues privately using the repository owner's available GitHub contact channel. Do not include credentials, seed phrases or private financial records in public issues. This project has no configured private disclosure inbox or promised response SLA.
