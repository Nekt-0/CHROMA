import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { clean, finite } from './config.mjs';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const JUPITER_URL = 'https://api.jup.ag/swap/v2';
export const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
export const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
export const JUPITER_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_PROGRAM = 'ComputeBudget111111111111111111111111111111';
const U64_MAX = (1n << 64n) - 1n;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

export async function solanaSdk() {
  try { return await import('@solana/web3.js'); }
  catch { throw new Error('Trading requires @solana/web3.js. Run pnpm install --frozen-lockfile --ignore-scripts.'); }
}

export function rawAmount(value, name = 'amount', allowZero = false) {
  const input = String(value ?? '');
  if (!/^(0|[1-9]\d*)$/.test(input) || input.length > 20) throw new Error(`${name} must be an integer in atomic token units.`);
  const amount = BigInt(input);
  if (amount > U64_MAX || (allowZero ? amount < 0n : amount <= 0n)) throw new Error(`${name} is outside the allowed u64 range.`);
  return amount;
}

function bounded(value, fallback, min, max, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}.`);
  return number;
}

export function tradePolicy(options = {}) {
  const slippageBps = bounded(options.slippageBps, 50, 1, 500, 'slippage-bps');
  const maxFeeBps = bounded(options.maxFeeBps, 100, 0, 1000, 'max-fee-bps');
  if (!Number.isInteger(slippageBps) || !Number.isInteger(maxFeeBps)) throw new Error('Fee and slippage basis points must be integers.');
  return {
    slippageBps, maxFeeBps,
    maxPriceImpactPct: bounded(options.maxPriceImpactPct, 5, 0, 100, 'max-price-impact-pct'),
    maxFeesLamports: rawAmount(options.maxFeesLamports ?? '5000000', 'max-fees-lamports').toString(),
    priorityFeeLamports: rawAmount(options.priorityFeeLamports ?? '10000', 'priority-fee-lamports', true).toString(),
    maxAgeMs: 30_000,
  };
}

export async function address(value, label = 'address') {
  const { PublicKey } = await solanaSdk();
  try { return new PublicKey(value).toBase58(); }
  catch { throw new Error(`Invalid ${label}.`); }
}

export async function loadWallet(file) {
  if (!file) throw new Error('Execution needs --wallet PATH to a local Solana CLI keypair file.');
  const { Keypair } = await solanaSdk();
  let bytes;
  try {
    if (statSync(file).size > 8192) throw new Error();
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(data) || data.length !== 64 || data.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error();
    bytes = Uint8Array.from(data);
    // The SDK retains the provided array. Give it its own copy before wiping
    // this temporary buffer, otherwise a loaded wallet would sign with zeros.
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch { throw new Error('Cannot load wallet: expected a valid 64-byte Solana CLI keypair JSON file.'); }
  finally { bytes?.fill(0); }
}

export async function rpc(method, params = [], { rpcUrl = MAINNET_RPC, fetcher = fetch } = {}) {
  const url = new URL(rpcUrl);
  if (url.protocol !== 'https:') throw new Error('The trading RPC endpoint must use HTTPS.');
  let response;
  try {
    response = await fetcher(url.href, {
      method: 'POST', signal: AbortSignal.timeout(15_000), redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
  } catch { throw new Error(`Solana RPC ${method} request failed.`); }
  if (!response.ok) throw new Error(`Solana RPC ${method} HTTP ${response.status}.`);
  const body = await response.json();
  if (body.error || !Object.hasOwn(body, 'result')) throw new Error(`Solana RPC ${method} rejected the request.`);
  return body.result;
}

async function jupiter(path, { apiKey, fetcher = fetch, body } = {}) {
  const headers = { accept: 'application/json' };
  if (apiKey) headers['x-api-key'] = apiKey;
  if (body) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetcher(`${JUPITER_URL}${path}`, {
      method: body ? 'POST' : 'GET', headers, signal: AbortSignal.timeout(20_000), redirect: 'error',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch { throw new Error(`Jupiter ${body ? 'execution' : 'order'} request failed.`); }
  if (!response.ok) throw new Error(`Jupiter HTTP ${response.status}.${[401, 403].includes(response.status) ? ' Set JUPITER_API_KEY with a valid Jupiter API key.' : ''}`);
  return response.json();
}

export async function getOrder({ inputMint = SOL_MINT, outputMint, amount, taker, policy = tradePolicy() }, dependencies = {}) {
  inputMint = await address(inputMint, 'input mint');
  outputMint = await address(outputMint, 'output mint');
  if (inputMint === outputMint) throw new Error('Input and output mints must differ.');
  if (taker) taker = await address(taker, 'taker');
  const requestedAmount = rawAmount(amount).toString();
  const params = new URLSearchParams({ inputMint, outputMint, amount: requestedAmount, swapMode: 'ExactIn',
    slippageBps: String(policy.slippageBps), excludeRouters: 'jupiterz,dflow,okx',
    maxSupportedTransactionVersion: '0', priorityFeeLamports: policy.priorityFeeLamports,
    broadcastFeeType: 'maxCap' });
  if (taker) params.set('taker', taker);
  const order = await jupiter(`/order?${params}`, dependencies);
  if (order.error || order.errorCode) throw new Error(`Jupiter could not build an order (code ${clean(order.errorCode ?? 'unknown', 20)}).`);
  if (order.inputMint !== inputMint || order.outputMint !== outputMint || order.inAmount !== requestedAmount || order.swapMode !== 'ExactIn') {
    throw new Error('Jupiter returned an order that does not match the requested swap.');
  }
  rawAmount(order.outAmount, 'quoted output');
  rawAmount(order.otherAmountThreshold, 'minimum output');
  if (!Number.isInteger(order.slippageBps) || order.slippageBps > policy.slippageBps || order.slippageBps < 0) throw new Error('Order exceeds the slippage limit.');
  if (order.router !== 'metis') throw new Error('This release supports Metis routes only.');
  if (taker && order.taker !== taker) throw new Error('Order taker does not match the requested wallet.');
  return { order, receivedAt: (dependencies.now ?? Date.now)(), policy, taker: taker ?? null };
}

export function orderSummary(prepared) {
  const { order, policy } = prepared;
  const impact = finite(order.priceImpact) ?? (finite(order.priceImpactPct) === null ? null : Number(order.priceImpactPct) * 100);
  const feeValues = [order.signatureFeeLamports, order.prioritizationFeeLamports, order.rentFeeLamports];
  const feesKnown = feeValues.every(x => Number.isSafeInteger(x) && x >= 0);
  return {
    network: 'solana-mainnet', mode: prepared.taker ? 'TRADE_PREVIEW' : 'QUOTE', taker: prepared.taker,
    inputMint: order.inputMint, outputMint: order.outputMint, inputAmountRaw: order.inAmount,
    expectedOutputRaw: order.outAmount, minimumOutputRaw: order.otherAmountThreshold,
    slippageBps: order.slippageBps, priceImpactPct: impact, feeBps: finite(order.feeBps), feeMint: order.feeMint ?? null,
    signatureFeeLamports: order.signatureFeeLamports ?? null,
    priorityFeeLamports: order.prioritizationFeeLamports ?? null,
    rentLamports: order.rentFeeLamports ?? null,
    estimatedSolFeesLamports: feesKnown ? feeValues.reduce((sum, x) => sum + BigInt(x), 0n).toString() : null,
    maxSolFeesLamports: policy.maxFeesLamports, router: order.router,
    requestId: order.requestId ?? null, receivedAt: new Date(prepared.receivedAt).toISOString(),
    amountUnits: 'Atomic token units; minimum output is before any separately reported token fee.',
  };
}

export function assertFresh(prepared, now = Date.now()) {
  const age = now - prepared.receivedAt;
  if (age < 0 || age > prepared.policy.maxAgeMs) throw new Error('Order expired locally. Request a new preview.');
  if (prepared.order.expireAt && (!Number.isFinite(Date.parse(prepared.order.expireAt)) || now >= Date.parse(prepared.order.expireAt))) throw new Error('Provider order has expired.');
}

export function validateOrderForTrade(prepared) {
  const { order, policy, taker } = prepared;
  const summary = orderSummary(prepared);
  if (!taker || !order.transaction || typeof order.requestId !== 'string' || !order.requestId) throw new Error('Order has no executable transaction or request ID.');
  if (order.transactionVersion !== 0 || order.gasless || order.signatureFeePayer !== taker) throw new Error('Only self-funded v0 Metis transactions are supported.');
  if (summary.priceImpactPct === null || Math.abs(summary.priceImpactPct) > policy.maxPriceImpactPct) throw new Error('Price impact is unknown or exceeds the configured limit.');
  if (summary.feeBps === null || summary.feeBps < 0 || summary.feeBps > policy.maxFeeBps) throw new Error('Token fee is unknown or exceeds max-fee-bps.');
  if (summary.estimatedSolFeesLamports === null || BigInt(summary.estimatedSolFeesLamports) > BigInt(policy.maxFeesLamports)) throw new Error('SOL fee estimate is unknown or exceeds max-fees-lamports.');
  const output = rawAmount(order.outAmount);
  const minimum = rawAmount(order.otherAmountThreshold);
  if (minimum > output || minimum < output * BigInt(10_000 - policy.slippageBps) / 10_000n) throw new Error('Minimum output is weaker than the requested slippage protection.');
  rawAmount(order.lastValidBlockHeight, 'last valid block height');
  return summary;
}

export async function associatedTokenAddress(owner, mint, tokenProgram = TOKEN_PROGRAM) {
  const { PublicKey } = await solanaSdk();
  return PublicKey.findProgramAddressSync([new PublicKey(owner).toBuffer(), new PublicKey(tokenProgram).toBuffer(), new PublicKey(mint).toBuffer()], new PublicKey(ATA_PROGRAM))[0].toBase58();
}

async function accountInfo(key, dependencies) {
  const result = await rpc('getAccountInfo', [key, { encoding: 'base64', commitment: 'confirmed' }], dependencies);
  return result?.value;
}

// Validate the authority, token accounts and fixed-size amount/slippage suffix in
// Jupiter's published route/sharedAccountsRoute IDL. Unknown variants fail closed.
export function validateRouteInstruction(data, accounts, expected) {
  data = Buffer.from(data);
  const discriminator = name => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
  const shared = data.subarray(0, 8).equals(discriminator('shared_accounts_route'));
  if (!shared && !data.subarray(0, 8).equals(discriminator('route'))) throw new Error('Unsupported Jupiter instruction variant.');
  if (data.length < (shared ? 32 : 31)) throw new Error('Truncated Jupiter route instruction.');
  const get = index => accounts[index];
  if (get(shared ? 2 : 1) !== expected.taker || get(shared ? 3 : 2) !== expected.source || get(shared ? 6 : 3) !== expected.destination) {
    throw new Error('Jupiter authority or token destination does not match the swap.');
  }
  if (get(shared ? 8 : 5) !== expected.outputMint || (shared && get(7) !== expected.inputMint)) throw new Error('Jupiter route mint mismatch.');
  if (!shared && get(4) !== JUPITER_PROGRAM && get(4) !== expected.destination) throw new Error('Unexpected alternate route destination.');
  const suffix = data.subarray(-19);
  if (suffix.readBigUInt64LE(0) !== BigInt(expected.inAmount) || suffix.readBigUInt64LE(8) !== BigInt(expected.outAmount)
      || suffix.readUInt16LE(16) > expected.slippageBps || suffix.readUInt8(18) > expected.maxFeeBps) {
    throw new Error('Encoded route amount, slippage or fee differs from the reviewed order.');
  }
}

export async function inspectTransaction(prepared, dependencies = {}) {
  const { VersionedTransaction, PublicKey, AddressLookupTableAccount } = await solanaSdk();
  const { order, taker, policy } = prepared;
  let tx;
  try {
    const bytes = Buffer.from(order.transaction, 'base64');
    if (bytes.length > 1232) throw new Error();
    tx = VersionedTransaction.deserialize(bytes);
    if (!Buffer.from(tx.serialize()).equals(bytes)) throw new Error();
  }
  catch { throw new Error('Malformed swap transaction.'); }
  if (tx.version !== 0 || tx.message.header.numRequiredSignatures !== 1 || tx.message.staticAccountKeys[0].toBase58() !== taker) throw new Error('Unexpected transaction version, payer or additional signer.');
  const tables = [];
  for (const lookup of tx.message.addressTableLookups) {
    const info = await accountInfo(lookup.accountKey.toBase58(), dependencies);
    if (!info || info.owner !== 'AddressLookupTab1e1111111111111111111111111') throw new Error('Invalid address lookup table.');
    tables.push(new AddressLookupTableAccount({ key: lookup.accountKey, state: AddressLookupTableAccount.deserialize(Buffer.from(info.data[0], 'base64')) }));
  }
  const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: tables });
  const inputInfo = await accountInfo(order.inputMint, dependencies);
  const outputInfo = await accountInfo(order.outputMint, dependencies);
  if (![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(inputInfo?.owner) || ![TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(outputInfo?.owner)) throw new Error('Mint is not owned by a supported SPL Token program.');
  const source = await associatedTokenAddress(taker, order.inputMint, inputInfo.owner);
  const destination = await associatedTokenAddress(taker, order.outputMint, outputInfo.owner);
  const wrappedSol = await associatedTokenAddress(taker, SOL_MINT);
  const programs = new Set();
  let routes = 0, wrappedAmount = 0n, units = 200_000, microLamports = 0n;
  for (const instruction of tx.message.compiledInstructions) {
    const program = keys.get(instruction.programIdIndex)?.toBase58();
    const accounts = [...instruction.accountKeyIndexes].map(index => keys.get(index)?.toBase58());
    const data = Buffer.from(instruction.data);
    programs.add(program);
    if (program === JUPITER_PROGRAM) {
      validateRouteInstruction(data, accounts, { taker, source, destination, inputMint: order.inputMint,
        outputMint: order.outputMint, inAmount: order.inAmount, outAmount: order.outAmount,
        slippageBps: order.slippageBps, maxFeeBps: policy.maxFeeBps });
      routes++;
    } else if (program === SYSTEM_PROGRAM) {
      if (data.length !== 12 || data.readUInt32LE(0) !== 2 || accounts.length !== 2 || accounts[0] !== taker || accounts[1] !== wrappedSol || order.inputMint !== SOL_MINT) throw new Error('Unexpected native SOL transfer.');
      wrappedAmount += data.readBigUInt64LE(4);
    } else if (program === ATA_PROGRAM) {
      if (data.length > 1 || (data.length === 1 && ![0, 1].includes(data[0])) || accounts[0] !== taker || accounts[2] !== taker
          || ![order.inputMint, order.outputMint].includes(accounts[3]) || ![source, destination].includes(accounts[1])) throw new Error('Unexpected associated token account instruction.');
    } else if ([TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(program)) {
      const sync = data.length === 1 && data[0] === 17 && accounts.length === 1 && accounts[0] === wrappedSol;
      const close = data.length === 1 && data[0] === 9 && accounts.length === 3 && accounts[0] === wrappedSol && accounts[1] === taker && accounts[2] === taker;
      if (!sync && !close) throw new Error('Unexpected direct token instruction or token approval.');
    } else if (program === COMPUTE_PROGRAM) {
      if (data.length === 5 && data[0] === 2) units = data.readUInt32LE(1);
      else if (data.length === 9 && data[0] === 3) microLamports = data.readBigUInt64LE(1);
      else if (!(data.length === 5 && [1, 4].includes(data[0]))) throw new Error('Unsupported compute budget instruction.');
    } else throw new Error(`Unsupported top-level transaction program: ${clean(program, 64)}`);
  }
  if (routes !== 1 || wrappedAmount > BigInt(order.inAmount)) throw new Error('Transaction must contain one reviewed swap and no excessive SOL wrapping.');
  const priority = (BigInt(units) * microLamports + 999_999n) / 1_000_000n;
  if (units > 1_400_000 || priority > BigInt(policy.priorityFeeLamports)) throw new Error('Encoded compute fee exceeds the priority fee limit.');
  return { tx, inspection: { payer: taker, source, destination, programs: [...programs], messageHash: sha(tx.message.serialize()), priorityFeeLamports: priority.toString() } };
}

export async function checkBlockHeight(prepared, dependencies) {
  const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }], dependencies);
  if (!Number.isSafeInteger(height) || BigInt(height) > BigInt(prepared.order.lastValidBlockHeight)) throw new Error('Order blockhash has expired or RPC height is invalid.');
}

export function signature58(bytes) {
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let output = '';
  while (value) { output = alphabet[Number(value % 58n)] + output; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; output = '1' + output; }
  return output;
}

export async function signatureStatus(signature, dependencies = {}) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature)) throw new Error('Invalid transaction signature.');
  const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }], dependencies);
  if (!Array.isArray(result?.value) || result.value.length !== 1) throw new Error('Unexpected transaction status response.');
  const value = result.value[0];
  const status = value?.err ? 'FAILED' : value?.err === null && ['confirmed', 'finalized'].includes(value.confirmationStatus) ? 'CONFIRMED' : 'UNKNOWN';
  return { signature, status, confirmationStatus: value?.confirmationStatus ?? null, slot: value?.slot ?? null,
    explorer: `https://solscan.io/tx/${signature}` };
}

// Only this function can reach /execute. The caller must explicitly request
// execution and supply a per-order confirmation callback; default is preview.
export async function runTrade(request, { wallet, execute = false, confirm = async () => false,
  onPreview = () => {}, record, ...dependencies } = {}) {
  const now = dependencies.now ?? Date.now;
  const taker = wallet?.publicKey.toBase58() ?? request.taker;
  if (execute && (!wallet || typeof record !== 'function')) throw new Error('Execution requires a wallet and a persistent event recorder.');
  const prepared = await getOrder({ ...request, taker }, dependencies);
  const summary = validateOrderForTrade(prepared);
  if (await rpc('getGenesisHash', [], dependencies) !== MAINNET_GENESIS) throw new Error('Trading requires a Solana mainnet RPC.');
  const { tx, inspection } = await inspectTransaction(prepared, dependencies);
  assertFresh(prepared, now());
  await checkBlockHeight(prepared, dependencies);
  const simulation = await rpc('simulateTransaction', [prepared.order.transaction,
    { encoding: 'base64', commitment: 'confirmed', sigVerify: false, replaceRecentBlockhash: false }], dependencies);
  if (!simulation?.value || simulation.value.err !== null) throw new Error('Swap simulation failed. Nothing was signed or submitted.');
  const preview = { ...summary, inspection, simulation: { ok: true, slot: simulation.context?.slot ?? null, unitsConsumed: simulation.value.unitsConsumed ?? null } };
  await onPreview(preview);
  if (!execute) return { ...preview, submitted: false };
  if ((await confirm(preview)) !== true) return { ...preview, submitted: false, cancelled: true };
  assertFresh(prepared, now());
  await checkBlockHeight(prepared, dependencies);
  tx.sign([wallet]);
  if (sha(tx.message.serialize()) !== inspection.messageHash) throw new Error('Transaction message changed while signing.');
  const signature = signature58(tx.signatures[0]);
  const intent = { ...summary, mode: 'TRADE', signature, messageHash: inspection.messageHash };
  // Persist the signature before broadcasting so a lost HTTP response can be reconciled.
  await record({ type: 'TRADE_SUBMISSION_ATTEMPTED', at: new Date(now()).toISOString(), data: intent });
  let providerResult;
  try {
    providerResult = await jupiter('/execute', { ...dependencies, body: { signedTransaction: Buffer.from(tx.serialize()).toString('base64'), requestId: prepared.order.requestId, lastValidBlockHeight: prepared.order.lastValidBlockHeight } });
  } catch {
    const result = { ...intent, status: 'UNKNOWN', submitted: true, note: 'Submission outcome is unknown. Check this signature before attempting another swap.' };
    await record({ type: 'TRADE_RESULT', at: new Date(now()).toISOString(), data: result });
    return result;
  }
  // The provider response alone never establishes settlement. Do not retry POST.
  let settlement;
  try { settlement = await signatureStatus(signature, dependencies); }
  catch { settlement = { signature, status: 'UNKNOWN' }; }
  const result = { ...intent, ...settlement, submitted: true, providerStatus: clean(providerResult.status, 32), providerCode: finite(providerResult.code),
    ...(providerResult.signature && providerResult.signature !== signature ? { status: 'UNKNOWN', note: 'Provider returned a different signature; reconcile the locally signed transaction.' } : {}),
    totalInputAmountRaw: typeof providerResult.totalInputAmount === 'string' ? clean(providerResult.totalInputAmount, 30) : null,
    totalOutputAmountRaw: typeof providerResult.totalOutputAmount === 'string' ? clean(providerResult.totalOutputAmount, 30) : null };
  await record({ type: 'TRADE_RESULT', at: new Date(now()).toISOString(), data: result });
  return result;
}
