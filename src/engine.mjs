import { RULES, clean, finite, nonnegative } from './config.mjs';

export function normalizePair(pair, token, observedAt = new Date().toISOString()) {
  if (pair?.chainId !== 'solana' || pair?.baseToken?.address !== token || !pair.pairAddress) return null;
  const buys = nonnegative(pair.txns?.h1?.buys);
  const sells = nonnegative(pair.txns?.h1?.sells);
  const created = nonnegative(pair.pairCreatedAt);
  return {
    token, pair: clean(pair.pairAddress, 64), symbol: clean(pair.baseToken.symbol, 14) || 'UNKNOWN',
    name: clean(pair.baseToken.name, 64), dex: clean(pair.dexId, 32),
    priceUsd: nonnegative(pair.priceUsd), liquidityUsd: nonnegative(pair.liquidity?.usd),
    volumeH1Usd: nonnegative(pair.volume?.h1), buysH1: buys, sellsH1: sells,
    changeH1Pct: finite(pair.priceChange?.h1), marketCapUsd: nonnegative(pair.marketCap),
    pairCreatedAt: created, observedAt, source: 'dexscreener',
  };
}

export function choosePair(pairs, token, observedAt) {
  if (!Array.isArray(pairs)) throw new Error('Unexpected pair response: expected an array.');
  // Quote-side matches are intentionally excluded: their priceUsd belongs to another base token.
  const normalized = pairs.map(pair => normalizePair(pair, token, observedAt)).filter(Boolean);
  normalized.sort((a, b) => (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || a.pair.localeCompare(b.pair));
  return normalized[0] ?? null;
}

export function evaluate(snapshot, rules = RULES) {
  const trades = snapshot.buysH1 !== null && snapshot.sellsH1 !== null
    ? snapshot.buysH1 + snapshot.sellsH1 : null;
  const ratio = trades > 0 ? snapshot.buysH1 / trades : null;
  const ageMinutes = snapshot.pairCreatedAt === null ? null
    : (Date.parse(snapshot.observedAt) - snapshot.pairCreatedAt) / 60_000;
  const turnover = snapshot.liquidityUsd > 0 && snapshot.volumeH1Usd !== null
    ? snapshot.volumeH1Usd / snapshot.liquidityUsd : null;
  const check = (id, value, pass, explanation) => ({
    id, state: value === null || !Number.isFinite(value) ? 'UNKNOWN' : pass ? 'PASS' : 'FAIL', explanation,
  });
  const checks = [
    check('PRICE', snapshot.priceUsd, snapshot.priceUsd > 0, 'A positive USD reference price is available.'),
    check('DEPTH', snapshot.liquidityUsd, snapshot.liquidityUsd >= rules.minLiquidityUsd, `Liquidity >= $${rules.minLiquidityUsd}.`),
    check('VOLUME', snapshot.volumeH1Usd, snapshot.volumeH1Usd >= rules.minVolumeH1Usd, `1h volume >= $${rules.minVolumeH1Usd}.`),
    check('ACTIVITY', trades, trades >= rules.minTradesH1, `1h swaps >= ${rules.minTradesH1}; swaps are not unique traders.`),
    check('PRESSURE', ratio, ratio >= rules.minBuyRatio, `Buy-count share >= ${rules.minBuyRatio * 100}%; not money flow.`),
    check('STABILITY', snapshot.changeH1Pct, Math.abs(snapshot.changeH1Pct) <= rules.maxAbsChangeH1Pct, `Absolute 1h price change <= ${rules.maxAbsChangeH1Pct}%.`),
    check('AGE', ageMinutes, ageMinutes >= rules.minAgeMinutes && ageMinutes <= rules.maxAgeHours * 60, `Selected pair age ${rules.minAgeMinutes}m–${rules.maxAgeHours}h; not token age.`),
    check('TURNOVER', turnover, turnover >= rules.minTurnover && turnover <= rules.maxTurnover, `1h volume / liquidity between ${rules.minTurnover} and ${rules.maxTurnover}.`),
  ];
  const score = Math.round(checks.filter(x => x.state === 'PASS').length / checks.length * 100);
  const incomplete = checks.some(x => x.state === 'UNKNOWN');
  const gated = checks.some(x => ['PRICE', 'DEPTH'].includes(x.id) && x.state === 'FAIL');
  const status = incomplete ? 'INCOMPLETE' : gated ? 'FILTERED'
    : score >= rules.trackScore ? 'TRACK' : score >= rules.watchScore ? 'WATCH' : 'FILTERED';
  return { ...snapshot, score, status, checks, tradesH1: trades, buyRatio: ratio, ageMinutes, turnover };
}

export function rank(targets) {
  const order = { TRACK: 0, WATCH: 1, INCOMPLETE: 2, FILTERED: 3, UNAVAILABLE: 4 };
  return [...targets].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
    || (b.score ?? -1) - (a.score ?? -1)
    || (b.liquidityUsd ?? -1) - (a.liquidityUsd ?? -1) || a.token.localeCompare(b.token));
}

export function compare(previous, current) {
  if (!previous) return { kind: 'DISCOVERED', previousStatus: null, status: current.status, priceChangePct: null, pairChanged: false };
  const pairChanged = previous.pair !== current.pair;
  return {
    kind: pairChanged ? 'PAIR_CHANGED' : previous.status === current.status ? 'OBSERVED' : 'STATUS_CHANGED',
    previousStatus: previous.status, status: current.status, pairChanged,
    priceChangePct: !pairChanged && previous.priceUsd > 0 && current.priceUsd !== null
      ? (current.priceUsd / previous.priceUsd - 1) * 100 : null,
  };
}

// Decimal SOL inputs are converted to integer lamports before arithmetic.
export function lamports(value) {
  const input = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(input) || input.length > 30) {
    throw new Error('SOL amounts must be nonnegative decimals with at most 9 decimal places.');
  }
  const [whole, fraction = ''] = input.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
}

export function sol(value) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${absolute / 1_000_000_000n}.${String(absolute % 1_000_000_000n).padStart(9, '0')}`;
}

export function balanceReport({ start, end, deposits, withdrawals, captures = 0 }) {
  const startLamports = lamports(start);
  const endLamports = lamports(end);
  if (!Number.isSafeInteger(captures) || captures < 0) throw new Error('Captures must be a nonnegative integer.');
  const change = endLamports - startLamports;
  const flowsKnown = deposits !== undefined && withdrawals !== undefined;
  const adjusted = flowsKnown ? change - lamports(deposits) + lamports(withdrawals) : null;
  return {
    startSol: sol(startLamports), endSol: sol(endLamports), changeSol: sol(change),
    balanceIncreasePct: startLamports > 0n ? Number(change * 1_000_000n / startLamports) / 10_000 : null,
    depositsSol: deposits === undefined ? null : sol(lamports(deposits)),
    withdrawalsSol: withdrawals === undefined ? null : sol(lamports(withdrawals)),
    flowAdjustedChangeSol: adjusted === null ? null : sol(adjusted), captures,
    verification: 'USER_REPORTED',
    note: 'Balance changes are not verified realized profit. Cash flows, open positions, execution costs and losses require reconciliation. Costs already included in a balance must not be subtracted twice.',
  };
}
