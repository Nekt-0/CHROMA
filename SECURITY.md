# Security

CHROMA reads public market data and writes local research files. It does not require private keys, seed phrases or wallet signatures and has no transaction submission path.

Provider token names and symbols are untrusted; terminal control characters are stripped and display strings are bounded. Provider URLs are fixed in source. Requests time out after ten seconds. Live scans retain errors instead of fabricating missing values.

Journal verification detects broken record numbering, linked hashes and truncated records. It is not an external attestation, and a full file rewrite can recompute the entire chain. Keep independent backups. Do not remove a writer lock while another CHROMA process is active.

Local exports can contain public addresses, your notes and manually reported balances. Review them before sharing. `.chroma/` and `exports/` are excluded from Git by default.

Report suspected issues privately using the repository owner's available GitHub contact channel. Do not include credentials, seed phrases or private financial records in public issues. This project has no configured private disclosure inbox or promised response SLA.
