import { API_BASE, ADDRESS, clean } from './config.mjs';
import { choosePair, evaluate, rank } from './engine.mjs';

export async function request(path, fetcher = fetch) {
  const response = await fetcher(`${API_BASE}${path}`, {
    signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`DEX Screener HTTP ${response.status}${response.status === 429 ? ' (rate limited; retry later)' : ''}`);
  return response.json();
}

export async function discover(limit = 5, fetcher = fetch) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Discovery limit must be 1–20.');
  const data = await request('/token-profiles/latest/v1', fetcher);
  if (!Array.isArray(data)) throw new Error('Unexpected profile response: expected an array.');
  return [...new Set(data.filter(x => x.chainId === 'solana' && ADDRESS.test(x.tokenAddress))
    .map(x => x.tokenAddress))].slice(0, limit);
}

export async function scanTokens(tokens, { fetcher = fetch, now = () => new Date().toISOString() } = {}) {
  const targets = [];
  const errors = [];
  // Sequential requests keep each sweep's provider budget explicit and bounded.
  for (const token of tokens) {
    if (!ADDRESS.test(token)) throw new Error(`Invalid Solana address: ${clean(token)}`);
    try {
      const pairs = await request(`/token-pairs/v1/solana/${encodeURIComponent(token)}`, fetcher);
      const observedAt = now();
      const pair = choosePair(pairs, token, observedAt);
      if (!pair) throw new Error('No supported Solana base-token pair found.');
      targets.push(evaluate(pair));
    } catch (error) {
      errors.push({ token, observedAt: now(), message: clean(error.message, 200) });
    }
  }
  return { targets: rank(targets), errors, source: 'dexscreener', mode: 'LIVE', observedAt: now() };
}
