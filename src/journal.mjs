import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { compare } from './engine.mjs';
import { RULES } from './config.mjs';

const digest = event => createHash('sha256').update(JSON.stringify(event)).digest('hex');

export function readJournal(directory) {
  const file = join(resolve(directory), 'events.jsonl');
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  if (!raw) return [];
  if (!raw.endsWith('\n')) throw new Error('Journal has a truncated final record. Restore from a backup before writing.');
  let previousHash = 'GENESIS';
  return raw.slice(0, -1).split('\n').map((line, index) => {
    let event;
    try { event = JSON.parse(line); } catch { throw new Error(`Invalid journal JSON at record ${index + 1}.`); }
    const { hash, ...payload } = event;
    if (event.seq !== index + 1 || event.previousHash !== previousHash || hash !== digest(payload)) {
      throw new Error(`Journal integrity check failed at record ${index + 1}.`);
    }
    previousHash = hash;
    return event;
  });
}

export function currentTargets(events) {
  const targets = new Map();
  for (const event of events) {
    if (event.type === 'SNAPSHOT') targets.set(event.data.target.token, { ...event.data.target, stale: false });
    if (event.type === 'PROVIDER_ERROR' && targets.has(event.data.token)) {
      targets.set(event.data.token, { ...targets.get(event.data.token), stale: true, status: 'UNAVAILABLE', error: event.data.message });
    }
  }
  return [...targets.values()];
}

// All read-modify-append work is protected by an exclusive local lock.
export function appendEvents(directory, builder) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const lock = join(root, 'write.lock');
  let lockFd;
  try { lockFd = openSync(lock, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Another CHROMA writer holds ${lock}. If a process crashed, stop all CHROMA processes and remove the stale lock.`);
    throw error;
  }
  try {
    const events = readJournal(root);
    const drafts = builder(events);
    let previousHash = events.at(-1)?.hash ?? 'GENESIS';
    const output = drafts.map((draft, index) => {
      const event = { seq: events.length + index + 1, previousHash, ...draft };
      const complete = { ...event, hash: digest(event) };
      previousHash = complete.hash;
      return complete;
    });
    if (output.length) {
      const fd = openSync(join(root, 'events.jsonl'), 'a');
      try {
        appendFileSync(fd, output.map(x => JSON.stringify(x)).join('\n') + '\n');
        fsyncSync(fd);
      } finally { closeSync(fd); }
    }
    return output;
  } finally {
    closeSync(lockFd);
    unlinkSync(lock);
  }
}

export function recordSweep(directory, sweep) {
  return appendEvents(directory, events => {
    const previous = new Map(currentTargets(events).map(x => [x.token, x]));
    return [
      ...sweep.targets.map(target => ({
        type: 'SNAPSHOT', at: target.observedAt,
        data: { target, transition: compare(previous.get(target.token), target), rules: RULES },
      })),
      ...sweep.errors.map(error => ({ type: 'PROVIDER_ERROR', at: error.observedAt, data: error })),
    ];
  });
}
