import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
async function check(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await check(filename);
    else if (entry.isFile() && entry.name.endsWith('.js')) execFileSync(process.execPath, ['--check', filename], { stdio: 'inherit' });
  }
}
for (const name of ['src', 'public', 'scripts', 'test']) await check(path.join(root, name));
console.log('JavaScript syntax checked individually in src, public, scripts, and test.');
