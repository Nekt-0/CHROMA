#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VERSION, clean, tokenList } from './config.mjs';
import { demoSweep, reportedSession } from './demo.mjs';
import { balanceReport, lamports } from './engine.mjs';
import { discover, scanTokens, request } from './provider.mjs';
import { appendEvents, readJournal, recordSweep, currentTargets } from './journal.mjs';
import { exportData, saveExport, markdown } from './export.mjs';
import { frame } from './render.mjs';
import { terminal } from './terminal.mjs';

export const HELP = `CHROMA / RESEARCH TERMINAL v${VERSION}
See the signal. Keep the receipt.

node src/cli.mjs <command> [options]

  demo                 Interactive synthetic walkthrough (no network, no journal)
  demo --once          Print a reproducible five-target sample
  scan --discover      Scan latest Solana profiles, save snapshots and checks
  scan --tokens A,B    Scan specified public Solana token mints
  watch --discover     Full-screen live queue with periodic provider reads
  history              Print recorded events; --token narrows the history
  capture --token A --note TEXT   Record a research observation, not a trade
  session --start X --end Y      Record user-reported SOL balances
  export --out FILE    Save historical JSON receipt; --format md for Markdown
  verify               Check the local journal hash chain
  doctor               Check runtime; --probe also queries the public provider
  quote --output-mint M --amount N   Fetch a Jupiter ExactIn quote (atomic units)
  trade --taker A --output-mint M --amount N   Inspect and simulate an unsigned swap
  trade --wallet PATH --output-mint M --amount N --execute   Review, confirm and submit
  trade-status --signature S        Reconcile a submitted Solana transaction
  help                 Show this guide

Options:
  --json               JSON output for demo, scan, history, session and doctor
  --dir PATH           Local journal directory (default: .chroma)
  --limit N            Discovery limit 1–20 (default: 5)
  --interval N         Watch interval 30–3600 seconds (default: 30)
  --captures N         Manually reported capture count (default: 0)
  --deposits X --withdrawals Y   Optional known external SOL flows
  --version            Print version
  --input-mint M        Input token mint (default: wrapped SOL)
  --amount-sol X        Decimal SOL input, instead of --amount atomic units
  --slippage-bps N      Slippage ceiling 1–500 (default: 50 = 0.5%)
  --max-fees-lamports N Maximum quoted SOL fees including rent (default: 5000000)
  --priority-fee-lamports N   Encoded priority fee ceiling (default: 10000)
  --max-price-impact-pct N    Price impact ceiling (default: 5)
  --max-fee-bps N       Token fee ceiling (default: 100 = 1%)

Modes: DEMO / SCAN / TRADE. Scanning needs no wallet. Trade defaults to unsigned simulation.
Real submission requires --execute, a local wallet and interactive per-order confirmation.
Demo target identities are synthetic. Post balances are unverified reports.`;

function integer(value, fallback, minimum, maximum, name) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  return result;
}

export async function main(args = process.argv.slice(2)) {
  const { values: options, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
    once: { type: 'boolean' }, json: { type: 'boolean' }, discover: { type: 'boolean' }, probe: { type: 'boolean' },
    tokens: { type: 'string' }, token: { type: 'string' }, dir: { type: 'string' },
    limit: { type: 'string' }, interval: { type: 'string' }, out: { type: 'string' }, format: { type: 'string' },
    start: { type: 'string' }, end: { type: 'string' }, deposits: { type: 'string' }, withdrawals: { type: 'string' },
    captures: { type: 'string' }, note: { type: 'string' },
    execute: { type: 'boolean' }, wallet: { type: 'string' }, taker: { type: 'string' },
    'input-mint': { type: 'string' }, 'output-mint': { type: 'string' }, amount: { type: 'string' },
    'amount-sol': { type: 'string' }, 'slippage-bps': { type: 'string' }, 'max-fees-lamports': { type: 'string' },
    'priority-fee-lamports': { type: 'string' }, 'max-price-impact-pct': { type: 'string' },
    'max-fee-bps': { type: 'string' }, signature: { type: 'string' },
  } });
  if (options.version) return console.log(VERSION);
  const command = positionals[0] ?? 'demo';
  if (positionals.length > 1) throw new Error('Unexpected positional argument. See help.');
  if (options.help || command === 'help') return console.log(HELP);
  const directory = resolve(options.dir ?? '.chroma');
  const output = object => console.log(JSON.stringify(object, null, 2));
  if (options.execute && command !== 'trade') throw new Error('--execute is supported only by the trade command.');
  if (['quote', 'trade', 'trade-status'].includes(command)) {
    if (options.execute && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('Real execution requires an interactive terminal and per-order confirmation.');
    const trading = await import('./trading.mjs');
    const dependencies = { apiKey: process.env.JUPITER_API_KEY, rpcUrl: process.env.SOLANA_RPC_URL ?? trading.MAINNET_RPC };
    if (command === 'trade-status') {
      const result = await trading.signatureStatus(options.signature ?? '', dependencies);
      const events = readJournal(directory);
      if (events.some(x => x.type === 'TRADE_SUBMISSION_ATTEMPTED' && x.data.signature === result.signature)) {
        appendEvents(directory, () => [{ type: 'TRADE_STATUS', at: new Date().toISOString(), data: result }]);
      }
      output(result);
      if (result.status !== 'CONFIRMED') process.exitCode = 1;
      return;
    }
    if (options.amount !== undefined && options['amount-sol'] !== undefined) throw new Error('Choose --amount or --amount-sol, not both.');
    const inputMint = options['input-mint'] ?? trading.SOL_MINT;
    if (options['amount-sol'] !== undefined && inputMint !== trading.SOL_MINT) throw new Error('--amount-sol requires SOL as the input mint.');
    const amount = options['amount-sol'] !== undefined ? lamports(options['amount-sol']).toString() : options.amount;
    trading.rawAmount(amount);
    const policy = trading.tradePolicy({ slippageBps: options['slippage-bps'], maxFeeBps: options['max-fee-bps'],
      maxPriceImpactPct: options['max-price-impact-pct'], maxFeesLamports: options['max-fees-lamports'],
      priorityFeeLamports: options['priority-fee-lamports'] });
    const request = { inputMint, outputMint: options['output-mint'], amount, taker: options.taker, policy };
    if (command === 'quote') {
      if (options.wallet) throw new Error('quote uses public data; use --taker for an optional public wallet address.');
      return output(trading.orderSummary(await trading.getOrder(request, dependencies)));
    }
    readJournal(directory);
    const walletPath = options.wallet ?? (options.execute ? process.env.CHROMA_WALLET : undefined);
    const wallet = walletPath ? await trading.loadWallet(walletPath) : undefined;
    if (wallet && options.taker && wallet.publicKey.toBase58() !== options.taker) throw new Error('--taker does not match the local wallet.');
    if (!wallet && !options.taker) throw new Error('trade preview needs --taker PUBLIC_ADDRESS or --wallet PATH.');
    const result = await trading.runTrade(request, { ...dependencies, wallet, execute: Boolean(options.execute),
      record: event => appendEvents(directory, () => [event]),
      onPreview: preview => { if (options.execute) output(preview); },
      confirm: async preview => {
        const { createInterface } = await import('node:readline/promises');
        const prompt = createInterface({ input: process.stdin, output: process.stdout });
        const phrase = `SWAP ${preview.taker.slice(-6)}`;
        try { return (await prompt.question(`Type ${phrase} to sign and submit this exact order: `)).trim() === phrase; }
        finally { prompt.close(); }
      },
    });
    output(result);
    if (result.submitted && result.status !== 'CONFIRMED') process.exitCode = 1;
    return;
  }
  if (command === 'demo') {
    if (!options.once && !options.json && process.stdin.isTTY && process.stdout.isTTY) return terminal({ demo: true });
    const sweep = demoSweep();
    if (options.json) output({ ...sweep, session: reportedSession, notice: 'Targets are synthetic; balances are supplied post figures, not validated performance.' });
    else console.log(frame(sweep, { height: 50, session: reportedSession }));
    return;
  }
  if (command === 'scan' || command === 'watch') {
    const limit = integer(options.limit, 5, 1, 20, 'limit');
    const tokens = options.tokens ? tokenList(options.tokens) : [];
    if (!tokens.length && !options.discover) throw new Error('Choose --tokens A,B or --discover.');
    if (command === 'watch') {
      if (options.json) throw new Error('watch is interactive; use scan --json for scripts.');
      return terminal({ demo: false, tokens, discovery: options.discover, limit,
        interval: integer(options.interval, 30, 30, 3600, 'interval'), directory });
    }
    const found = options.discover ? await discover(limit) : [];
    const addresses = [...new Set([...tokens, ...found])].slice(0, 20);
    if (!addresses.length) throw new Error('No Solana profiles returned. Try --tokens with a specific mint.');
    const sweep = await scanTokens(addresses);
    const events = recordSweep(directory, sweep);
    if (options.json) output({ ...sweep, recordedEvents: events.length });
    else console.log(frame(sweep, { height: 60, message: `Saved ${events.length} records to ${directory}` }));
    if (sweep.errors.length) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    const report = { node: process.versions.node, runtimeOk: Number(process.versions.node.split('.')[0]) >= 22,
      journal: directory, records: readJournal(directory).length, provider: 'not probed',
      modes: ['DEMO', 'SCAN', 'TRADE'], execution: 'explicit trade --execute with per-order confirmation',
      jupiterApiKeyConfigured: Boolean(process.env.JUPITER_API_KEY), walletPathConfigured: Boolean(process.env.CHROMA_WALLET) };
    if (options.probe) {
      const start = Date.now();
      const data = await request('/token-profiles/latest/v1');
      if (!Array.isArray(data)) throw new Error('Provider returned an unexpected profile payload.');
      report.provider = `OK / ${Date.now() - start}ms / ${data.length} profiles`;
    }
    output(report);
    return;
  }
  if (command === 'session') {
    if (options.start === undefined || options.end === undefined) throw new Error('session needs --start and --end in SOL.');
    const report = balanceReport({ start: options.start, end: options.end, deposits: options.deposits,
      withdrawals: options.withdrawals, captures: integer(options.captures, 0, 0, 1_000_000, 'captures') });
    appendEvents(directory, () => [{ type: 'BALANCE_REPORT', at: new Date().toISOString(), data: { report } }]);
    output(report);
    return;
  }
  if (command === 'capture') {
    if (!options.token || !options.note?.trim()) throw new Error('capture needs --token ADDRESS and --note TEXT.');
    const captureTokens = tokenList(options.token);
    if (captureTokens.length !== 1) throw new Error('capture accepts exactly one token.');
    const [token] = captureTokens;
    const recorded = appendEvents(directory, events => {
      if (!currentTargets(events).some(x => x.token === token)) throw new Error('Scan this target before recording an observation.');
      return [{ type: 'CAPTURE_NOTE', at: new Date().toISOString(), data: { token, note: clean(options.note, 1000), execution: 'none' } }];
    });
    output(recorded[0]);
    return;
  }
  if (command === 'history') {
    let events = readJournal(directory);
    if (options.token) events = events.filter(x => (x.data.target?.token ?? x.data.token) === options.token);
    if (options.json) output(events);
    else for (const event of events) console.log(`#${event.seq} ${event.at} ${event.type} ${event.data.target?.symbol ?? event.data.token ?? event.data.signature ?? 'USER_REPORTED'} ${event.data.status ?? event.data.transition?.status ?? ''} ${clean(event.data.note ?? '')}`);
    if (!events.length && !options.json) console.log('No recorded events. Run scan or session first.');
    return;
  }
  if (command === 'verify') {
    const events = readJournal(directory);
    output({ ok: true, records: events.length, head: events.at(-1)?.hash ?? null, scope: 'Local integrity only; not external verification.' });
    return;
  }
  if (command === 'export') {
    const format = options.format ?? 'json';
    if (!['json', 'md'].includes(format)) throw new Error('Export format must be json or md.');
    const data = exportData(readJournal(directory));
    if (options.out) console.log(saveExport(options.out, data, format));
    else if (format === 'md') console.log(markdown(data));
    else output(data);
    return;
  }
  throw new Error(`Unknown command: ${clean(command)}. Run help.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(`CHROMA: ${clean(error.message, 400)}`);
    process.exitCode = 1;
  });
}
