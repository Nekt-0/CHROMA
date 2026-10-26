import { clean, VERSION } from './config.mjs';

export const money = value => value === null || value === undefined ? 'n/a'
  : value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(2)}m`
    : value >= 1_000 ? `$${(value / 1_000).toFixed(1)}k`
      : value > 0 && value < 1 ? `$${value.toPrecision(4)}` : `$${value.toFixed(4)}`;
const percent = value => value === null || value === undefined ? 'n/a' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const column = (value, width) => clean(value, width).padEnd(width);

export function frame(sweep, { width = 110, height = 38, selected = 0, view = 'queue', events = [], message = '', session = null } = {}) {
  width = Math.max(42, Math.min(width, 180));
  const lines = [];
  const add = value => lines.push(clean(value, width));
  const rule = () => add('─'.repeat(width));
  add(`  C H R O M A                                           / SCAN + TRADE   v${VERSION}`);
  add('  SEE THE SIGNAL. KEEP THE RECEIPT.');
  rule();
  add(`  ${sweep.mode === 'DEMO' ? 'DEMO / SYNTHETIC TARGETS / NO NETWORK' : 'LIVE READ / DEX SCREENER / NO SIGNING'}`);
  add(`  OBSERVED  ${sweep.observedAt}     TARGETS ${sweep.targets.length}     ERRORS ${sweep.errors.length}`);
  add(`  [1] QUEUE ${view === 'queue' ? '●' : ''}    [2] RECORD ${view === 'history' ? '●' : ''}    [3] SESSION ${view === 'session' ? '●' : ''}`);
  rule();
  if (view === 'queue') {
    add('  SCAN → TRACK → PRIORITIZE → RECORD');
    add('');
    if (width < 82) {
      add('    TARGET         SCORE  STATE');
      sweep.targets.forEach((target, index) => add(` ${index === selected ? '›' : ' '} ${column(target.symbol, 14)} ${column(target.score ?? 'n/a', 6)} ${target.status}`));
    } else {
      add('    TARGET         SCORE   STATE         PRICE        LIQUIDITY    VOL / 1H    Δ / 1H');
      sweep.targets.forEach((target, index) => add(` ${index === selected ? '›' : ' '} ${column(target.symbol, 14)} ${column(`${target.score ?? 'n/a'}/100`, 7)} ${column(target.status, 13)} ${column(money(target.priceUsd), 12)} ${column(money(target.liquidityUsd), 12)} ${column(money(target.volumeH1Usd), 11)} ${percent(target.changeH1Pct)}`));
    }
    if (!sweep.targets.length) add('  No targets returned. See provider errors below or supply --tokens.');
    add('');
    rule();
    const target = sweep.targets[selected];
    if (target) {
      add(`  ${target.symbol} / ${target.token}`);
      add(`  PAIR ${target.pair} / ${target.dex}`);
      add(`  ${target.checks?.map(x => `${x.state === 'PASS' ? '✓' : x.state === 'FAIL' ? '×' : '?'} ${x.id}`).join('  ') ?? target.error}`);
      add('');
      for (const check of target.checks?.filter(x => x.state !== 'PASS') ?? []) add(`  ${check.state} ${check.id}: ${check.explanation}`);
      if (target.checks?.every(x => x.state === 'PASS')) add('  All eight market checks passed. Priority is a research queue, not a return forecast.');
      add(`  SOURCE ${target.source} / Missing contract and holder-risk checks are outside this release.`);
    }
  } else if (view === 'history') {
    add('  FLIGHT RECORDER / latest 12 events');
    add('');
    if (!events.length) add('  No persisted events. Demo never writes a trading history.');
    for (const event of events.slice(-12)) {
      const item = event.data.target;
      add(`  #${String(event.seq).padEnd(4)} ${event.at.slice(11, 19)}  ${column(event.type, 16)} ${item?.symbol ?? event.data.token ?? event.data.signature ?? event.data.report?.verification ?? ''}`);
      if (event.data.transition) add(`                   ${event.data.transition.previousStatus ?? 'NEW'} → ${event.data.transition.status}`);
    }
    add('');
    add('  Each record links to the previous SHA-256 hash. Verify with: chroma verify');
    add('  Local integrity is not proof that a provider or trading result is correct.');
  } else {
    add('  SESSION / USER-REPORTED BALANCES');
    add('');
    if (session) {
      add(`  STARTING BALANCE       ${session.startSol} SOL`);
      add(`  ENDING BALANCE         ${session.endSol} SOL`);
      add(`  DISPLAYED CHANGE       ${session.changeSol} SOL`);
      add(`  BALANCE INCREASE       ${percent(session.balanceIncreasePct)}`);
      add(`  CAPTURES REPORTED      ${session.captures}`);
      add(`  FLOW-ADJUSTED CHANGE   ${session.flowAdjustedChangeSol ?? 'UNKNOWN'}${session.flowAdjustedChangeSol === null ? '' : ' SOL'}`);
      add('');
      add(`  ${session.verification} / On-screen figures are not a verified trading record.`);
      add('  Deposits, withdrawals, open positions, fees and losses need reconciliation.');
      if (sweep.mode === 'DEMO') add('  Figures transcribed from the supplied post; the five target rows are synthetic.');
    } else {
      add('  No balance report recorded. Market scans do not infer a wallet balance.');
      add('  chroma session --start 277.78 --end 310 --captures 5');
    }
  }
  for (const error of sweep.errors.slice(0, 3)) add(`  ERROR ${error.token}: ${error.message}`);
  add('');
  rule();
  add(`  ${message || 'SCAN mode / market data can be delayed / execution is a separate trade command'}`);
  add('  ↑/↓ select   1/2/3 views   r refresh   e export JSON   q quit');
  if (height < lines.length) {
    const footer = lines.slice(-3);
    return [...lines.slice(0, Math.max(1, height - 4)), '  … enlarge the terminal to see more …'.slice(0, width), ...footer].join('\n');
  }
  return lines.join('\n');
}

export function colorize(text) {
  return text.split('\n').map((line, index) => {
    if (index === 0 || index === 1) return `\x1b[1;38;2;207;255;99m${line}\x1b[0m`;
    if (line.startsWith('─')) return `\x1b[38;2;52;68;65m${line}\x1b[0m`;
    return line.replace(/\b(TRACK|PASS)\b/g, '\x1b[38;2;207;255;99m$1\x1b[0m')
      .replace(/\b(WATCH|INCOMPLETE|UNKNOWN|DEMO)\b/g, '\x1b[38;2;255;192;113m$1\x1b[0m')
      .replace(/\b(FILTERED|ERROR|FAIL|UNAVAILABLE)\b/g, '\x1b[38;2;255;111;123m$1\x1b[0m');
  }).join('\n');
}
