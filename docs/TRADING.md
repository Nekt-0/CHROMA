# TRADE mode

CHROMA v0.2 implements Jupiter Swap API V2 quotes, transaction inspection, unsigned mainnet simulation, explicit local signing and managed execution. This is a manual CLI workflow; scanner scores never trigger orders.

## Setup

Use Node.js 22+ and pnpm 11.25.0. Install the pinned SDK:

```bash
pnpm install --frozen-lockfile --ignore-scripts
```

The scanner remains usable without installing the SDK. Trading loads `@solana/web3.js` only when needed. Keep a standard 64-byte Solana CLI keypair JSON file outside the repository. Private key bytes are never accepted as command-line flags or included in logs.

Configuration uses `JUPITER_API_KEY`, `SOLANA_RPC_URL` and optionally `CHROMA_WALLET`. Copy `.env.example` to a local `.env`, edit it, and load it using `node --env-file=.env src/cli.mjs ...`. Keyless public quotes may work; if Jupiter returns 401/403, configure a valid API key. Credentials are not included in request URLs or receipts.

## Quote, preview, execute

```bash
# Quote only: no private key, no simulation and no submission
node src/cli.mjs quote --amount-sol 0.001 --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Assemble, inspect and simulate using a public taker address
node src/cli.mjs trade --taker YOUR_PUBLIC_ADDRESS --amount-sol 0.001 --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

# Review interactively, then sign and submit this order
node src/cli.mjs trade --wallet /absolute/path/to/id.json --amount-sol 0.001 --output-mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --execute
```

The default input mint is wrapped SOL; Jupiter manages its native SOL wrapping/unwrapping when the returned transaction is supported. `--amount-sol` converts a decimal SOL amount to lamports using integer arithmetic. For any other token, supply `--input-mint` and `--amount` in its **atomic units**. For example, one USDC with six decimals is `--amount 1000000`. CHROMA does not infer token decimals from a symbol.

`trade` without `--execute` returns an unsigned simulation receipt. Nothing is signed or submitted. Supplying `--wallet` does load the keypair to obtain its public address; use `--taker` to avoid loading any keypair during a preview. A funded taker may be required by Jupiter to assemble a transaction.

`--execute` requires an interactive terminal. After the preview, type the exact `SWAP <wallet suffix>` phrase shown. The reviewed quote must still be under 30 seconds old and within its last valid block height. Expired quotes are rejected, not silently refreshed after approval.

## Limits

| Option | Default | Meaning |
| --- | ---: | --- |
| `--slippage-bps` | 50 | Maximum quote and encoded route slippage; accepted range 1–500 bps |
| `--max-price-impact-pct` | 5 | Maximum absolute quoted price impact |
| `--max-fee-bps` | 100 | Maximum reported token fee and encoded route platform fee |
| `--max-fees-lamports` | 5000000 | Maximum provider-estimated signature, priority and rent total |
| `--priority-fee-lamports` | 10000 | Maximum encoded compute-unit priority fee |

Quotes and preview amounts are atomic token units. The quoted minimum output precedes any separately reported token fee. Estimated rent and service fees are provider estimates, not a guarantee of total economic cost. The CLI displays the fee mint and individual SOL fee estimates before confirmation.

Supported routes are self-funded v0 Metis ExactIn swaps with one wallet signer and one recognized Jupiter `route` or `sharedAccountsRoute` instruction. The inspector checks canonical transaction bytes, lookup-table ownership, expected associated token accounts, route mints, encoded amounts, slippage, native SOL wrapping, token cleanup and compute budgets. It rejects gasless sponsorship, RFQ/multi-signer orders, alternate output recipients, token approvals and unknown instruction variants. This can exclude otherwise valid Jupiter routes.

## Submission and recovery

Before POST `/execute`, CHROMA durably records `TRADE_SUBMISSION_ATTEMPTED` with the locally computed signature and message hash. Signed transaction bytes, API keys and private key material are not journalled. After submission it queries the signature on the RPC; a provider response alone is not proof of settlement.

- `CONFIRMED`: RPC reports confirmed/finalized with no error.
- `FAILED`: RPC reports an on-chain error.
- `UNKNOWN`: response was lost, signature is pending/unavailable, the RPC failed, or the provider returned a different signature.

The code never automatically retries `/execute`. Reconcile the recorded signature before creating another swap:

```bash
node src/cli.mjs history --json
node src/cli.mjs trade-status --signature YOUR_TRANSACTION_SIGNATURE
node src/cli.mjs export --out exports/trading-session.json
```

`trade-status` also appends a status receipt when the signature belongs to a locally recorded attempt. UNKNOWN is not a successful trade or a safe signal to retry. Keep the journal backed up and use a single process for wallet execution; cross-directory or external wallet activity is not coordinated by CHROMA.

## Validation scope

Tests use deterministic, unfunded test-only keys and mocked providers. They verify real Ed25519 signatures over unchanged transaction messages, explicit confirmation, input/destination/fee checks, simulation failure, journal failures and unknown submission recovery. Public quote access and the mainnet genesis hash were checked against real services. No funded mainnet transaction was submitted during development, and the integration has not received an external security audit.

Primary references: [Jupiter Order & Execute](https://dev.jup.ag/docs/swap/order-and-execute), [Jupiter API schema](https://github.com/jup-ag/docs/blob/main/openapi-spec/swap/v2/swap.yaml), [published Jupiter route IDL](https://github.com/jup-ag/instruction-parser/blob/main/src/idl/jupiter.ts), [Solana simulation](https://solana.com/docs/rpc/http/simulatetransaction), [signature statuses](https://solana.com/docs/rpc/http/getsignaturestatuses).
