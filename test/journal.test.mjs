import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvents, readJournal, recordSweep, currentTargets } from '../src/journal.mjs';
import { demoSweep } from '../src/demo.mjs';
import { exportData, saveExport } from '../src/export.mjs';

function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'chroma-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('snapshots retain rules and before/after transitions in a verifiable chain', t => {
  const dir = temporary(t);
  recordSweep(dir, demoSweep());
  recordSweep(dir, demoSweep(1));
  const events = readJournal(dir);
  assert.equal(events.length, 10);
  assert.equal(events[0].data.transition.kind, 'DISCOVERED');
  assert.equal(events[5].data.transition.kind, 'OBSERVED');
  assert.equal(events[0].data.rules.minLiquidityUsd, 10_000);
  assert.equal(currentTargets(events).length, 5);
  assert.equal(exportData(events).integrity.head, events[9].hash);
});

test('provider failure removes the target from the current research queue', t => {
  const dir = temporary(t);
  const sweep = demoSweep();
  recordSweep(dir, sweep);
  recordSweep(dir, { targets: [], errors: [{ token: sweep.targets[0].token, observedAt: sweep.observedAt, message: 'HTTP 503' }] });
  const target = currentTargets(readJournal(dir)).find(x => x.token === sweep.targets[0].token);
  assert.equal(target.stale, true);
  assert.equal(target.status, 'UNAVAILABLE');
});

test('edited and truncated journals are rejected before another append', t => {
  const dir = temporary(t);
  recordSweep(dir, demoSweep());
  const file = join(dir, 'events.jsonl');
  const raw = readFileSync(file, 'utf8');
  writeFileSync(file, raw.replace('PRISM', 'ALTERED'));
  assert.throws(() => readJournal(dir), /integrity/);
  assert.throws(() => appendEvents(dir, () => []), /integrity/);
  assert.equal(existsSync(join(dir, 'write.lock')), false);
  writeFileSync(file, raw.slice(0, -3));
  assert.throws(() => readJournal(dir), /truncated/);
});

test('simultaneous writers fail clearly and exports cannot overwrite receipts', t => {
  const dir = temporary(t);
  writeFileSync(join(dir, 'write.lock'), '');
  assert.throws(() => appendEvents(dir, () => []), /Another CHROMA writer/);
  const output = join(dir, 'receipt.json');
  saveExport(output, exportData([]));
  assert.throws(() => saveExport(output, { changed: true }), /EEXIST/);
});
