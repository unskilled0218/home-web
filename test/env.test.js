import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/config.js';
import { loadEnvFile, parseEnv } from '../src/env.js';

test('parses documented env syntax and preserves explicit environment values', async () => {
  assert.deepEqual(parseEnv('# comment\nPLAIN=value\nDOUBLE="two words"\nSINGLE=\'three words\'\nEMPTY=\n'), { PLAIN: 'value', DOUBLE: 'two words', SINGLE: 'three words', EMPTY: '' });
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-env-'));
  const file = path.join(directory, '.env');
  writeFileSync(file, 'HOST=192.168.1.10\nPORT=4000\nLINKWARDEN_CONFIG_ENCRYPTION_KEY=ignored\n');
  const environment = { PORT: '5000', LINKWARDEN_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64') };
  try {
    assert.equal(await loadEnvFile(file, environment), true);
    assert.equal(environment.PORT, '5000');
    assert.equal(environment.HOST, '192.168.1.10');
    const config = loadConfig(environment);
    assert.equal(config.host, '192.168.1.10');
    assert.equal(config.port, 5000);
    assert.equal(await loadEnvFile(path.join(directory, 'missing'), environment), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('loads an env file before production startup', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-start-'));
  const portServer = net.createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const file = path.join(directory, '.env');
  writeFileSync(file, `HOST=127.0.0.1\nPORT=${port}\nDATABASE_PATH=${path.join(directory, 'dashboard.db')}\nLINKWARDEN_CONFIG_ENCRYPTION_KEY=${Buffer.alloc(32, 4).toString('base64')}\n`);
  const child = spawn(process.execPath, ['src/start.js'], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, DASHBOARD_ENV_FILE: file, HOST: undefined, PORT: undefined, DATABASE_PATH: undefined, LINKWARDEN_CONFIG_ENCRYPTION_KEY: undefined }, stdio: ['ignore', 'pipe', 'pipe'] });
  context.after(async () => {
    if (child.exitCode == null) { child.kill('SIGTERM'); await once(child, 'exit'); }
    rmSync(directory, { recursive: true, force: true });
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${stderr}`)), 5_000);
    child.stdout.on('data', (chunk) => { if (chunk.toString().includes(`127.0.0.1:${port}`)) { clearTimeout(timer); resolve(); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Startup exited with ${code}: ${stderr}`)); });
  });
});
