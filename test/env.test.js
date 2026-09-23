import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { rootCertificates } from 'node:tls';

const root = path.resolve(import.meta.dirname, '..');

function withoutEnvironment(...names) {
  const environment = { ...process.env };
  for (const name of names) delete environment[name];
  return environment;
}

test('uses Node env files with documented syntax and process environment precedence', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-env-'));
  const file = path.join(directory, '.env');
  writeFileSync(file, '# comment\nPLAIN=value\nDOUBLE="two words"\nSINGLE=\'three words\'\nEMPTY=\nPORT=4000\n');
  try {
    const script = 'process.stdout.write(JSON.stringify({ plain: process.env.PLAIN, double: process.env.DOUBLE, single: process.env.SINGLE, empty: process.env.EMPTY, port: process.env.PORT }))';
    const output = execFileSync(process.execPath, [`--env-file-if-exists=${file}`, '--input-type=module', '--eval', script], { env: { ...withoutEnvironment('PLAIN', 'DOUBLE', 'SINGLE', 'EMPTY'), PORT: '5000' }, encoding: 'utf8' });
    assert.deepEqual(JSON.parse(output), { plain: 'value', double: 'two words', single: 'three words', empty: '', port: '5000' });
    assert.doesNotThrow(() => execFileSync(process.execPath, [`--env-file-if-exists=${path.join(directory, 'missing')}`, '--eval', ''], { stdio: 'ignore' }));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('loads configuration and extra CA before production startup', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-start-'));
  const portServer = net.createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const caFile = path.join(directory, 'home-assistant-ca.pem');
  writeFileSync(caFile, rootCertificates[0]);
  const databasePath = path.join(directory, 'dashboard.db');
  const file = path.join(directory, '.env');
  writeFileSync(file, `HOST=127.0.0.1\nPORT=${port}\nDATABASE_PATH=${databasePath}\nLINKWARDEN_CONFIG_ENCRYPTION_KEY=${Buffer.alloc(32, 4).toString('base64')}\nNODE_EXTRA_CA_CERTS=${caFile}\n`);
  const child = spawn(process.execPath, [`--env-file-if-exists=${file}`, 'src/server.js'], { cwd: root, env: withoutEnvironment('HOST', 'PORT', 'DATABASE_PATH', 'LINKWARDEN_CONFIG_ENCRYPTION_KEY', 'NODE_EXTRA_CA_CERTS'), stdio: ['ignore', 'pipe', 'pipe'] });
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
