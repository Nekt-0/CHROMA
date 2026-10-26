import { evaluate, rank, balanceReport } from './engine.mjs';

export const DEMO_TIME = '2026-10-26T12:00:00.000Z';
export const reportedSession = balanceReport({ start: '277.78', end: '310', captures: 5 });

export function demoSweep(step = 0) {
  const observedAt = new Date(Date.parse(DEMO_TIME) + step * 30_000).toISOString();
  const specs = [
    ['PRISM', 84_200, 46_800, 148, 92, 8.4, 0.00482],
    ['SPECTRA', 61_900, 23_400, 96, 61, 5.1, 0.00231],
    ['GLINT', 24_800, 12_600, 51, 42, 14.8, 0.00073],
    ['EMBER', 18_200, 3_400, 11, 20, -18.7, 0.00104],
    ['NOISE', 2_600, 19_200, 37, 69, -64.2, 0.00009],
  ];
  const targets = specs.map(([symbol, liquidity, volume, buys, sells, change, price], index) => evaluate({
    token: `demo-target-${index + 1}`, pair: `demo-pair-${index + 1}`, symbol,
    name: `Synthetic ${symbol}`, dex: 'fixture', priceUsd: price * (1 + step * (index % 2 ? -0.002 : 0.003)),
    liquidityUsd: liquidity, volumeH1Usd: volume, buysH1: buys, sellsH1: sells,
    changeH1Pct: change, marketCapUsd: null,
    pairCreatedAt: Date.parse(DEMO_TIME) - (index + 1) * 3_600_000,
    observedAt, source: 'synthetic-fixture',
  }));
  return { targets: rank(targets), errors: [], mode: 'DEMO', source: 'synthetic-fixture', observedAt };
}
