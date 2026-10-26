import readline from 'node:readline';
import { frame, colorize } from './render.mjs';
import { demoSweep, reportedSession } from './demo.mjs';
import { discover, scanTokens } from './provider.mjs';
import { readJournal, recordSweep } from './journal.mjs';
import { exportData, saveExport } from './export.mjs';

export async function terminal({ demo, tokens = [], discovery = false, limit = 5, interval = 30, directory = '.chroma' }) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Interactive mode needs a TTY. Use demo --once or scan for scripts.');
  let sweep = demo ? demoSweep() : { mode: 'LIVE', targets: [], errors: [], observedAt: new Date().toISOString() };
  let step = 0, selected = 0, view = 'queue', message = demo ? 'Synthetic research walkthrough / balances from supplied post / no trades executed' : 'Fetching public market data…';
  let events = demo ? [] : readJournal(directory);
  let busy = false, stopped = false, lastRefresh = 0;
  const draw = () => {
    if (stopped) return;
    const session = demo ? reportedSession : events.findLast(x => x.type === 'BALANCE_REPORT')?.data.report;
    const text = frame(sweep, { width: process.stdout.columns ?? 110, height: process.stdout.rows ?? 38, selected, view, events, message, session });
    process.stdout.write('\x1b[H\x1b[2J' + (process.env.NO_COLOR !== undefined ? text : colorize(text)));
  };
  const refresh = async () => {
    if (busy || stopped) return;
    if (!demo && Date.now() - lastRefresh < interval * 1000) { message = `Next provider sweep is available after ${interval}s.`; draw(); return; }
    busy = true;
    lastRefresh = Date.now();
    message = demo ? 'Advancing synthetic snapshots…' : 'Reading public provider…';
    draw();
    try {
      if (demo) sweep = demoSweep(++step);
      else {
        const discovered = discovery ? await discover(limit) : [];
        if (stopped) return;
        const addresses = [...new Set([...tokens, ...discovered])].slice(0, 20);
        sweep = await scanTokens(addresses);
        if (stopped) return;
        recordSweep(directory, sweep);
        events = readJournal(directory);
      }
      selected = Math.max(0, Math.min(selected, Math.max(0, sweep.targets.length - 1)));
      message = demo ? `Synthetic step ${step} / nothing persisted / no network requests` : `Sweep saved / ${sweep.targets.length} targets / ${sweep.errors.length} errors`;
    } catch (error) {
      message = `Refresh failed: ${error.message}. Previous rows are historical.`;
      sweep = { ...sweep, targets: sweep.targets.map(x => ({ ...x, stale: true, status: 'UNAVAILABLE' })) };
    } finally { busy = false; draw(); }
  };
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let timer;
  return new Promise(resolve => {
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdin.off('keypress', keypress);
      process.stdout.off('resize', draw);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.unref?.();
      process.stdout.write('\x1b[?25h\x1b[?1049l');
      resolve();
    };
    const keypress = (character, key = {}) => {
      if (character === 'q' || (key.ctrl && key.name === 'c')) return stop();
      if (key.name === 'up' || character === 'k') selected = Math.max(0, selected - 1);
      if (key.name === 'down' || character === 'j') selected = Math.max(0, Math.min(sweep.targets.length - 1, selected + 1));
      if (['1', '2', '3'].includes(character)) view = { 1: 'queue', 2: 'history', 3: 'session' }[character];
      if (character === 'r') void refresh();
      if (character === 'e') {
        try {
          const data = demo ? { schemaVersion: 1, mode: 'DEMO', notice: 'Synthetic targets; supplied post figures are unverified.', ...sweep, session: reportedSession } : exportData(readJournal(directory));
          message = `Saved ${saveExport(`exports/chroma-${Date.now()}.json`, data)}`;
        } catch (error) { message = `Export failed: ${error.message}`; }
      }
      draw();
    };
    process.stdin.on('keypress', keypress);
    process.stdout.on('resize', draw);
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    draw();
    if (!demo) void refresh();
    timer = setInterval(() => void refresh(), (demo ? 3 : interval) * 1000);
  });
}
