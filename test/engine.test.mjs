import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceReport, choosePair, compare, evaluate, lamports, sol } from '../src/engine.mjs';
import { tokenList, clean } from '../src/config.mjs';
import { demoSweep } from '../src/demo.mjs';

const token = 'So11111111111111111111111111111111111111112';
const sample = () => ({ ...demoSweep().targets[0] });

test('reported SOL delta is exact and rounds to the supplied 11.6%', () => {
  const report = balanceReport({ start: '277.78', end: '310', captures: 5 });
  assert.equal(report.changeSol, '32.220000000');
  assert.equal(report.balanceIncreasePct.toFixed(1), '11.6');
  assert.equal(report.flowAdjustedChangeSol, null);
  assert.equal(report.verification, 'USER_REPORTED');
});

test('external flows are distinguished from balance change, with no invented fees', () => {
  const report = balanceReport({ start: '10', end: '16', deposits: '8', withdrawals: '1' });
  assert.equal(report.changeSol, '6.000000000');
  assert.equal(report.flowAdjustedChangeSol, '-1.000000000');
  assert.equal(balanceReport({ start: '0', end: '1' }).balanceIncreasePct, null);
  assert.equal(sol(lamports('0.000000001')), '0.000000001');
  assert.throws(() => lamports('0.0000000001'));
  assert.throws(() => lamports('1e3'));
  assert.throws(() => lamports('-1'));
});

test('only base-token pairs on Solana are eligible; highest depth wins deterministically', () => {
  const pairs = [
    { chainId: 'ethereum', pairAddress: 'wrong-chain', baseToken: { address: token }, liquidity: { usd: 1e9 } },
    { chainId: 'solana', pairAddress: 'quote-side', baseToken: { address: 'other' }, quoteToken: { address: token }, liquidity: { usd: 1e9 }, priceUsd: '900' },
    { chainId: 'solana', pairAddress: 'thin', baseToken: { address: token }, liquidity: { usd: 100 }, priceUsd: '1' },
    { chainId: 'solana', pairAddress: 'deep', baseToken: { address: token, symbol: '\x1b[2JFAKE' }, liquidity: { usd: 500 }, priceUsd: '2' },
  ];
  const selected = choosePair(pairs, token, '2026-10-26T12:00:00Z');
  assert.equal(selected.pair, 'deep');
  assert.equal(selected.priceUsd, 2);
  assert.ok(!selected.symbol.includes('\x1b'));
  assert.equal(choosePair([], token), null);
});

test('missing data stays UNKNOWN; a failed depth gate cannot become TRACK', () => {
  const full = evaluate(sample());
  assert.equal(full.status, 'TRACK');
  const unknown = evaluate({ ...sample(), liquidityUsd: null });
  assert.equal(unknown.status, 'INCOMPLETE');
  assert.equal(unknown.checks.find(x => x.id === 'DEPTH').state, 'UNKNOWN');
  assert.equal(evaluate({ ...sample(), liquidityUsd: 9000 }).status, 'FILTERED');
  assert.equal(evaluate({ ...sample(), priceUsd: 0 }).status, 'FILTERED');
  assert.equal(evaluate({ ...sample(), buysH1: 0, sellsH1: 0 }).status, 'INCOMPLETE');
});

test('a pair change suppresses a misleading cross-pool price delta', () => {
  const previous = sample();
  const changed = { ...previous, pair: 'another-pair', priceUsd: previous.priceUsd * 2 };
  assert.equal(compare(previous, changed).kind, 'PAIR_CHANGED');
  assert.equal(compare(previous, changed).priceChangePct, null);
  assert.equal(compare(previous, { ...previous, priceUsd: previous.priceUsd * 2 }).priceChangePct, 100);
});

test('terminal inputs are sanitized and synthetic identities cannot be scanned live', () => {
  assert.equal(clean('A\nB\x1bC'), 'ABC');
  assert.throws(() => tokenList('demo-target-1'));
  assert.throws(() => tokenList('https://example.com'));
  assert.deepEqual(tokenList(`${token},${token}`), [token]);
});
