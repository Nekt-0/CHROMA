import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const cli = resolve('src/cli.mjs');
const run = (args, cwd) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });

test('demo works in a fresh directory, labels its data, and creates no files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'chroma-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const result = run(['demo', '--json'], dir);
  assert.equal(result.status, 0, result.stderr);
  const data = JSON.parse(result.stdout);
  assert.equal(data.mode, 'DEMO');
  assert.equal(data.targets.length, 5);
  assert.equal(data.session.changeSol, '32.220000000');
  assert.deepEqual(readdirSync(dir), []);
});

test('session → verify → export is usable across independent CLI invocations', t => {
  const dir = mkdtempSync(join(tmpdir(), 'chroma-flow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const report = run(['session', '--start', '277.78', '--end', '310', '--captures', '5'], dir);
  assert.equal(report.status, 0, report.stderr);
  const verification = run(['verify'], dir);
  assert.equal(JSON.parse(verification.stdout).records, 1);
  const receipt = run(['export', '--format', 'md'], dir);
  assert.match(receipt.stdout, /32\.220000000 SOL/);
  assert.match(receipt.stdout, /unverified/);
});

test('invalid amounts and accidental command arguments fail before writing state', t => {
  const dir = mkdtempSync(join(tmpdir(), 'chroma-invalid-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const args of [['session', '--start', '-1', '--end', '310'], ['scan'], ['scan', '--tokens', 'bad'], ['verify', 'oops']]) {
    assert.equal(run(args, dir).status, 1);
  }
  assert.deepEqual(readdirSync(dir), []);
});
