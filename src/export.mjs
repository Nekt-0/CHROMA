import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { currentTargets } from './journal.mjs';
import { rank } from './engine.mjs';
import { clean, VERSION } from './config.mjs';

const cell = value => clean(value ?? 'n/a', 160).replace(/[<>]/g, '').replace(/[\\`*_{}\[\]()!#|]/g, '\\$&');

export function exportData(events, createdAt = new Date().toISOString()) {
  return {
    schemaVersion: 1, appVersion: VERSION, createdAt,
    notice: 'Historical research snapshots. User-reported balances are unverified. Scores are not investment recommendations.',
    integrity: { records: events.length, head: events.at(-1)?.hash ?? null, scope: 'Local hash chain; no external attestation.' },
    targets: rank(currentTargets(events)),
    trades: events.filter(event => event.type.startsWith('TRADE_')),
    session: events.findLast(x => x.type === 'BALANCE_REPORT')?.data.report ?? null,
    events,
  };
}

export function markdown(data) {
  const lines = [
    '# CHROMA / session receipt', '', `Exported: ${cell(data.createdAt)}`, '', data.notice, '',
    '| Target | Score | Status | Observed UTC |', '| --- | ---: | --- | --- |',
    ...data.targets.map(x => `| ${cell(x.symbol)} | ${x.score} | ${cell(x.status)} | ${cell(x.observedAt)} |`), '',
    '## Reported balances', '',
  ];
  if (data.session) {
    lines.push(`- Start: ${data.session.startSol} SOL`, `- End: ${data.session.endSol} SOL`,
      `- Displayed change: ${data.session.changeSol} SOL`, `- Balance increase: ${data.session.balanceIncreasePct ?? 'n/a'}%`,
      `- Captures reported: ${data.session.captures}`, `- Flow-adjusted change: ${data.session.flowAdjustedChangeSol ?? 'unknown'} SOL`,
      '', data.session.note);
  } else lines.push('No balance report recorded.');
  const trades = new Map();
  for (const event of data.trades ?? []) {
    if (event.data.signature) trades.set(event.data.signature, { ...trades.get(event.data.signature), ...event.data });
  }
  if (trades.size) {
    lines.push('', '## Trade receipts', '', '| Signature | State |', '| --- | --- |',
      ...[...trades].map(([signature, trade]) => `| ${cell(signature)} | ${cell(trade.status ?? 'UNKNOWN')} |`),
      '', 'UNKNOWN requires signature reconciliation; a submission attempt is not confirmation.');
  }
  lines.push('', '## Integrity', '', `${data.integrity.records} records; head: \`${data.integrity.head ?? 'empty'}\`.`,
    '', data.integrity.scope, '', 'Full snapshots, rules, provider failures and event hashes are included in the JSON export.', '');
  return lines.join('\n');
}

export function saveExport(file, data, format = 'json') {
  const destination = resolve(file);
  mkdirSync(dirname(destination), { recursive: true });
  // Never silently overwrite a user's previous receipt.
  writeFileSync(destination, format === 'md' ? markdown(data) : JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
  return destination;
}
