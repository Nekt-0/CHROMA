import test from 'node:test';
import assert from 'node:assert/strict';
import { discover, request, scanTokens } from '../src/provider.mjs';

const token = 'So11111111111111111111111111111111111111112';
const response = data => async () => ({ ok: true, json: async () => data });

test('discovery filters chains, invalid addresses and duplicates', async () => {
  const found = await discover(5, response([
    { chainId: 'ethereum', tokenAddress: token },
    { chainId: 'solana', tokenAddress: 'bad' },
    { chainId: 'solana', tokenAddress: token },
    { chainId: 'solana', tokenAddress: token },
  ]));
  assert.deepEqual(found, [token]);
});

test('429 and malformed provider data produce failures, not a success snapshot', async () => {
  await assert.rejects(request('/test', async () => ({ ok: false, status: 429 })), /rate limited/);
  const sweep = await scanTokens([token], { fetcher: response({ pairs: [] }) });
  assert.equal(sweep.targets.length, 0);
  assert.equal(sweep.errors.length, 1);
  assert.match(sweep.errors[0].message, /expected an array/);
});

test('live normalization keeps unavailable measurements null', async () => {
  const sweep = await scanTokens([token], { fetcher: response([
    { chainId: 'solana', pairAddress: 'pair', baseToken: { address: token }, priceUsd: '1' },
  ]), now: () => '2026-10-26T12:00:00Z' });
  assert.equal(sweep.errors.length, 0);
  assert.equal(sweep.targets[0].status, 'INCOMPLETE');
  assert.equal(sweep.targets[0].liquidityUsd, null);
  assert.equal(sweep.targets[0].volumeH1Usd, null);
});
