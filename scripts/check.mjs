import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = ['src', 'scripts', 'test'].flatMap(dir => readdirSync(dir).filter(x => x.endsWith('.mjs')).map(x => join(dir, x)));
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`Syntax OK / ${files.length} modules`);
