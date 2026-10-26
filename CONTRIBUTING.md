# Contributing

Start with a reproducible observation: the command, Node version, timestamp, expected behavior and actual output. Remove private notes and personal balance reports before attaching data.

Keep provider adapters separate from the deterministic engine. Preserve the distinction between missing values and zero, quote-side and base-side pricing, provider time and observation time, and balance changes and trading profit.

Run `node scripts/check.mjs` and `node --test`. Tests must not depend on live endpoints. When a change affects the terminal renderer, regenerate README assets with `node scripts/brand.mjs` and inspect them. A manual `doctor --probe` or `scan` is useful for provider changes; report its time and limitations.

Trade changes must preserve transaction intent validation, unsigned simulation, per-order confirmation, signature recording before submission and UNKNOWN outcome recovery. Tests must use deterministic test-only keypairs and mocked execution endpoints. Never fund the test fixtures or include private keys in receipts.

Do not add unlabelled synthetic results, fabricated performance or wallet secrets. Project credits, including Claude, are listed in the README; GitHub's automatic contributor graph is derived separately from commit authorship.
