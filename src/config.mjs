export const VERSION = '0.1.0';
export const RULES = Object.freeze({
  minLiquidityUsd: 10_000,
  minVolumeH1Usd: 5_000,
  minTradesH1: 40,
  minBuyRatio: 0.52,
  maxAbsChangeH1Pct: 40,
  minAgeMinutes: 10,
  maxAgeHours: 72,
  minTurnover: 0.1,
  maxTurnover: 10,
  trackScore: 75,
  watchScore: 50,
});

export const API_BASE = 'https://api.dexscreener.com';
export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// Provider strings are untrusted. Strip terminal controls and keep output bounded.
export function clean(value, max = 100) {
  return String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, '').slice(0, max);
}

export function finite(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function nonnegative(value) {
  const number = finite(value);
  return number !== null && number >= 0 ? number : null;
}

export function tokenList(value) {
  const tokens = [...new Set(String(value).split(',').map(x => x.trim()).filter(Boolean))];
  if (!tokens.length || tokens.length > 20) throw new Error('Supply between 1 and 20 token addresses.');
  for (const token of tokens) {
    if (!ADDRESS.test(token)) throw new Error(`Invalid Solana address: ${clean(token)}`);
  }
  return tokens;
}
