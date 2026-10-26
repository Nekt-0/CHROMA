import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, SystemProgram, AddressLookupTableAccount, ComputeBudgetProgram } from '@solana/web3.js';
import { getOrder, runTrade, rawAmount, tradePolicy, orderSummary, assertFresh, validateOrderForTrade,
  validateRouteInstruction, associatedTokenAddress, signature58, signatureStatus, loadWallet,
  SOL_MINT, USDC_MINT, JUPITER_PROGRAM, TOKEN_PROGRAM, MAINNET_GENESIS } from '../src/trading.mjs';

// Deterministic test-only keypair. Never fund this address or use this seed outside tests.
const signer = Keypair.fromSeed(new Uint8Array(32).fill(7));
const taker = signer.publicKey.toBase58();
const fixedNow = Date.parse('2026-10-26T12:00:00Z');

async function fixture(options = {}) {
  const source = await associatedTokenAddress(taker, SOL_MINT);
  const destination = await associatedTokenAddress(taker, USDC_MINT);
  const args = Buffer.alloc(19);
  args.writeBigUInt64LE(1_000_000n, 0);
  args.writeBigUInt64LE(150_000n, 8);
  args.writeUInt16LE(50, 16);
  const data = Buffer.concat([createHash('sha256').update('global:route').digest().subarray(0, 8), Buffer.alloc(4), args]);
  const accounts = [TOKEN_PROGRAM, taker, source, destination, JUPITER_PROGRAM, USDC_MINT, JUPITER_PROGRAM];
  const instruction = new TransactionInstruction({ programId: new PublicKey(JUPITER_PROGRAM), data,
    keys: accounts.map((pubkey, i) => ({ pubkey: new PublicKey(pubkey), isSigner: i === 1, isWritable: [2, 3].includes(i) })) });
  const instructions = [instruction, ...(options.extraInstructions ?? [])];
  const table = new AddressLookupTableAccount({ key: Keypair.fromSeed(new Uint8Array(32).fill(8)).publicKey,
    state: { deactivationSlot: (1n << 64n) - 1n, lastExtendedSlot: 99, lastExtendedSlotStartIndex: 0,
      authority: undefined, addresses: [new PublicKey(source), new PublicKey(destination)] } });
  const message = new TransactionMessage({ payerKey: signer.publicKey, recentBlockhash: PublicKey.default.toBase58(), instructions }).compileToV0Message(options.useLookup ? [table] : []);
  const tx = new VersionedTransaction(message);
  const order = { inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: '1000000', outAmount: '150000',
    otherAmountThreshold: '149250', swapMode: 'ExactIn', slippageBps: 50, router: 'metis',
    transactionVersion: 0, taker, gasless: false, signatureFeePayer: taker,
    signatureFeeLamports: 5000, prioritizationFeeLamports: 10000, rentFeeLamports: 2039280,
    feeBps: 10, feeMint: USDC_MINT, priceImpact: -0.1, lastValidBlockHeight: '200',
    requestId: 'test-order-id', transaction: Buffer.from(tx.serialize()).toString('base64'), ...options.order };
  const requests = [], records = [];
  let submittedSignature;
  const fetcher = async (url, init = {}) => {
    requests.push({ url, init });
    const success = body => ({ ok: true, json: async () => body });
    if (url.includes('/order?')) return success(order);
    if (url.endsWith('/execute')) {
      assert.equal(records[0]?.type, 'TRADE_SUBMISSION_ATTEMPTED', 'signature must be persisted before POST');
      if (options.dropExecute) throw new Error('Network response lost');
      const body = JSON.parse(init.body);
      const signed = VersionedTransaction.deserialize(Buffer.from(body.signedTransaction, 'base64'));
      submittedSignature = signature58(signed.signatures[0]);
      const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signer.publicKey.toBuffer()]), format: 'der', type: 'spki' });
      assert.equal(verify(null, signed.message.serialize(), publicKey, signed.signatures[0]), true);
      assert.deepEqual(Buffer.from(signed.message.serialize()), Buffer.from(tx.message.serialize()));
      return success({ status: 'Success', code: 0, signature: submittedSignature, totalInputAmount: '1000000', totalOutputAmount: '149900' });
    }
    const body = JSON.parse(init.body);
    if (body.method === 'getGenesisHash') return success({ result: options.genesis ?? MAINNET_GENESIS });
    if (body.method === 'getAccountInfo') {
      if (body.params[0] === table.key.toBase58()) {
        const meta = Buffer.alloc(56);
        meta.writeUInt32LE(1, 0);
        meta.writeBigUInt64LE((1n << 64n) - 1n, 4);
        meta.writeBigUInt64LE(99n, 12);
        const bytes = Buffer.concat([meta, ...table.state.addresses.map(key => key.toBuffer())]);
        return success({ result: { value: { owner: options.wrongLookupOwner ? TOKEN_PROGRAM : 'AddressLookupTab1e1111111111111111111111111', data: [bytes.toString('base64'), 'base64'] } } });
      }
      return success({ result: { value: { owner: TOKEN_PROGRAM, data: ['', 'base64'] } } });
    }
    if (body.method === 'getBlockHeight') return success({ result: options.height ?? 100 });
    if (body.method === 'simulateTransaction') return success({ result: { context: { slot: 123 }, value: { err: options.simulationError ?? null, unitsConsumed: 100_000 } } });
    if (body.method === 'getSignatureStatuses') return success({ result: { value: options.pending ? [null] : [{ err: options.chainError ?? null, confirmationStatus: 'confirmed', slot: 124 }] } });
    throw new Error(`Unexpected mock RPC method ${body.method}`);
  };
  const dependencies = { fetcher, now: () => fixedNow, record: event => records.push(event) };
  const request = { inputMint: SOL_MINT, outputMint: USDC_MINT, amount: '1000000', taker, policy: tradePolicy() };
  return { request, dependencies, order, requests, records, data, accounts, source, destination };
}

test('atomic inputs and configured spending limits reject ambiguity', () => {
  assert.equal(rawAmount('18446744073709551615'), (1n << 64n) - 1n);
  for (const value of ['1.5', '1e9', '-1', '0', '18446744073709551616']) assert.throws(() => rawAmount(value));
  assert.throws(() => tradePolicy({ slippageBps: 10000 }));
  assert.throws(() => tradePolicy({ slippageBps: 1.5 }));
  assert.throws(() => tradePolicy({ maxFeesLamports: '1.2' }));
});

test('order requests bind mints, amount, slippage, fee priority and supported version', async () => {
  const f = await fixture();
  const prepared = await getOrder(f.request, f.dependencies);
  const params = new URL(f.requests[0].url).searchParams;
  assert.equal(params.get('excludeRouters'), 'jupiterz,dflow,okx');
  assert.equal(params.get('maxSupportedTransactionVersion'), '0');
  assert.equal(params.get('slippageBps'), '50');
  assert.equal(params.get('priorityFeeLamports'), '10000');
  assert.equal(orderSummary(prepared).estimatedSolFeesLamports, '2054280');
  for (const order of [{ inAmount: '2' }, { outputMint: SOL_MINT }, { taker: SOL_MINT }, { slippageBps: 500 }, { router: 'jupiterz' }]) {
    const bad = await fixture({ order });
    await assert.rejects(getOrder(bad.request, bad.dependencies));
  }
});

test('unknown fees, excessive price impact, weak minimums and expired quotes cannot trade', async () => {
  for (const order of [{ feeBps: undefined }, { feeBps: 101 }, { priceImpact: 9 }, { rentFeeLamports: 9_000_000 },
    { signatureFeeLamports: null }, { transactionVersion: 1 }, { gasless: true }, { otherAmountThreshold: '1' }]) {
    const f = await fixture({ order });
    const prepared = await getOrder(f.request, f.dependencies);
    assert.throws(() => validateOrderForTrade(prepared));
  }
  const f = await fixture();
  const prepared = await getOrder(f.request, f.dependencies);
  assert.throws(() => assertFresh(prepared, fixedNow + 30_001), /expired/);
});

test('route inspection binds encoded amounts, authority and destination to the reviewed order', async () => {
  const f = await fixture();
  const expected = { ...f.order, taker, source: f.source, destination: f.destination, maxFeeBps: 100 };
  validateRouteInstruction(f.data, f.accounts, expected);
  const differentAmount = Buffer.from(f.data);
  differentAmount.writeBigUInt64LE(2n, differentAmount.length - 19);
  assert.throws(() => validateRouteInstruction(differentAmount, f.accounts, expected), /Encoded/);
  const redirected = [...f.accounts];
  redirected[3] = SOL_MINT;
  assert.throws(() => validateRouteInstruction(f.data, redirected, expected), /destination/);
  assert.throws(() => validateRouteInstruction(Buffer.alloc(31), f.accounts, expected), /variant/);
});

test('default preview simulates without reading secret bytes, signing or posting execute', async () => {
  const f = await fixture();
  let secretsRead = 0;
  const wallet = { publicKey: signer.publicKey, get secretKey() { secretsRead++; return signer.secretKey; } };
  const result = await runTrade(f.request, { ...f.dependencies, wallet });
  assert.equal(result.submitted, false);
  assert.equal(result.simulation.ok, true);
  assert.equal(secretsRead, 0);
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 0);
  assert.equal(f.records.length, 0);
});

test('execution needs explicit confirmation and a persistent recorder', async () => {
  const f = await fixture();
  const cancelled = await runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true });
  assert.equal(cancelled.cancelled, true);
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 0);
  await assert.rejects(runTrade(f.request, { fetcher: f.dependencies.fetcher, wallet: signer, execute: true }), /persistent/);
  const notBoolean = await runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => 'true' });
  assert.equal(notBoolean.cancelled, true);
});

test('failed simulation, wrong network and expired blockhash stop before signing', async () => {
  for (const options of [{ simulationError: { InstructionError: [0, 'InvalidArgument'] } }, { genesis: 'devnet' }, { height: 201 }]) {
    const f = await fixture(options);
    await assert.rejects(runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true }));
    assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 0);
    assert.equal(f.records.length, 0);
  }
});

test('unexpected native transfers and unsupported top-level instructions are rejected', async () => {
  const transfer = SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(USDC_MINT), lamports: 1 });
  const f = await fixture({ extraInstructions: [transfer] });
  await assert.rejects(runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true }), /Unexpected native SOL transfer/);
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 0);
});

test('a quote that expires during user review is not submitted', async () => {
  const f = await fixture();
  let clock = fixedNow;
  await assert.rejects(runTrade(f.request, { ...f.dependencies, now: () => clock, wallet: signer, execute: true,
    confirm: async () => { clock += 31_000; return true; } }), /expired/);
  assert.equal(f.records.length, 0);
});

test('successful mocked execution preserves the message and records signature before broadcast', async () => {
  const f = await fixture();
  const result = await runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true });
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.submitted, true);
  assert.equal(f.records[0].type, 'TRADE_SUBMISSION_ATTEMPTED');
  assert.equal(f.records[0].data.signature, result.signature);
  assert.equal(f.records[1].type, 'TRADE_RESULT');
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 1);
  assert.equal(JSON.stringify(f.records).includes('signedTransaction'), false);
  assert.equal(JSON.stringify(f.records).includes('secretKey'), false);
});

test('a lost execute response remains UNKNOWN with a recovery signature and no retries', async () => {
  const f = await fixture({ dropExecute: true });
  const result = await runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true });
  assert.equal(result.status, 'UNKNOWN');
  assert.ok(result.signature);
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 1);
  assert.equal(f.records[1].data.status, 'UNKNOWN');
});

test('a provider Success does not become confirmation without on-chain status', async () => {
  const f = await fixture({ pending: true });
  const result = await runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true });
  assert.equal(result.providerStatus, 'Success');
  assert.equal(result.status, 'UNKNOWN');
});

test('journal failure blocks submission and chain errors remain failed', async () => {
  const f = await fixture();
  await assert.rejects(runTrade(f.request, { ...f.dependencies, wallet: signer, execute: true, confirm: async () => true,
    record: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.equal(f.requests.filter(x => x.url.endsWith('/execute')).length, 0);
  const failed = await fixture({ chainError: { InstructionError: [0, 1] } });
  const result = await signatureStatus(signature58(new Uint8Array(64).fill(1)), failed.dependencies);
  assert.equal(result.status, 'FAILED');
});

test('keypair loading accepts standard local files without exposing invalid contents', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'chroma-wallet-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'keypair.json');
  writeFileSync(file, JSON.stringify(Array.from(signer.secretKey)));
  const loaded = await loadWallet(file);
  assert.equal(loaded.publicKey.toBase58(), taker);
  const f = await fixture();
  const signed = await runTrade(f.request, { ...f.dependencies, wallet: loaded, execute: true, confirm: async () => true });
  assert.equal(signed.status, 'CONFIRMED');
  writeFileSync(file, 'PRIVATE_TEST_SENTINEL');
  await assert.rejects(loadWallet(file), error => !error.message.includes('PRIVATE_TEST_SENTINEL'));
});

test('shared-accounts routes enforce the source and destination mint bindings', async () => {
  const f = await fixture();
  const data = Buffer.concat([createHash('sha256').update('global:shared_accounts_route').digest().subarray(0, 8), Buffer.alloc(5), f.data.subarray(-19)]);
  const accounts = [TOKEN_PROGRAM, JUPITER_PROGRAM, taker, f.source, JUPITER_PROGRAM, JUPITER_PROGRAM, f.destination, SOL_MINT, USDC_MINT];
  const expected = { ...f.order, taker, source: f.source, destination: f.destination, maxFeeBps: 100 };
  validateRouteInstruction(data, accounts, expected);
  accounts[7] = USDC_MINT;
  assert.throws(() => validateRouteInstruction(data, accounts, expected), /mint mismatch/);
});

test('v0 lookup tables resolve to the intended token accounts and require the correct owner', async () => {
  const f = await fixture({ useLookup: true });
  const result = await runTrade(f.request, { ...f.dependencies, wallet: signer });
  assert.equal(result.inspection.source, f.source);
  assert.equal(result.inspection.destination, f.destination);
  const bad = await fixture({ useLookup: true, wrongLookupOwner: true });
  await assert.rejects(runTrade(bad.request, { ...bad.dependencies, wallet: signer }), /lookup table/);
});

test('an understated quote cannot bypass the encoded priority fee ceiling', async () => {
  const f = await fixture({ extraInstructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000_000 })] });
  await assert.rejects(runTrade(f.request, { ...f.dependencies, wallet: signer }), /priority fee limit/);
});
