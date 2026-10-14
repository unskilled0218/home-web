import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync, existsSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createStore } from '../src/db.js';
import { loadConfig } from '../src/config.js';
import { encryptApiKey, decryptApiKey, encryptionKey } from '../src/linkwarden-crypto.js';
import { within } from './fixtures/lifecycle.js';

const entry = path.resolve(import.meta.dirname, '../src/server.js');
const owned = new Map();
async function launch(directory, { env = {}, file = false } = {}) {
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [...(file ? [`--env-file=${directory}/.env`] : []), entry], { cwd: directory, env: { PATH: process.env.PATH, HOST: '127.0.0.1', PORT: String(port), NFS_MOUNT_MODE: 'disabled', ...env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  const ready = new Promise(resolve => child.on('message', message => { if (message.type === 'dashboard:ready') resolve(true); }));
  const stop = async () => { if (child.exitCode !== null) return; if (child.connected) child.send({ type: 'dashboard:shutdown' }); await within(exited, 5000); };
  const runs = owned.get(directory) || []; runs.push({ stop }); owned.set(directory, runs);
  const running = await within(Promise.race([ready, exited.then(() => false)]), 5000);
  return { running, port, get output() { return output; }, get code() { return child.exitCode; }, stop };
}
function temporary(t) { const directory = mkdtempSync('/tmp/opencode/startup-key-'); t.after(async () => { for (const run of owned.get(directory) || []) await run.stop(); owned.delete(directory); rmSync(directory, { recursive: true, force: true }); }); return directory; }

test('pure configuration computes database-relative defaults without touching storage', t => {
  const root = temporary(t); const databasePath = path.join(root, 'absent', 'dashboard.db');
  const config = loadConfig({ DATABASE_PATH: databasePath });
  assert.equal(config.linkwardenEncryptionKeyFile, path.join(root, 'absent', 'linkwarden-config-encryption.key'));
  assert.equal(config.linkwardenEncryptionKey, ''); assert.equal(existsSync(path.dirname(databasePath)), false);
  assert.throws(() => loadConfig({ LINKWARDEN_CONFIG_ENCRYPTION_KEY: 'invalid' }), /base64-encoded/);
});

test('first server start without env file creates a restricted key and preserves credentials across restart', async t => {
  const directory = temporary(t); const keyPath = path.join(directory, 'data/linkwarden-config-encryption.key');
  const first = await launch(directory); t.after(() => first.stop()); assert.equal(first.running, true, first.output);
  const secret = readFileSync(keyPath, 'utf8'); assert.equal(encryptionKey(secret).length, 32); assert.equal(statSync(keyPath).mode & 0o077, 0); assert.equal(statSync(path.dirname(keyPath)).mode & 0o077, 0);
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/api/dashboard/settings`)).status, 200); await first.stop();
  const store = createStore(path.join(directory, 'data/wol.db')); store.saveHomeAssistant({ baseUrl: 'https://fixture.invalid', encryptedAccessToken: encryptApiKey('fixture-token', secret) }); store.close();
  const second = await launch(directory); t.after(() => second.stop()); assert.equal(second.running, true, second.output); assert.equal(readFileSync(keyPath, 'utf8'), secret); await second.stop();
  const reopened = createStore(path.join(directory, 'data/wol.db')); assert.equal(decryptApiKey(reopened.getHomeAssistant().encryptedAccessToken, secret), 'fixture-token'); reopened.close();
  unlinkSync(keyPath);
  const lost = await launch(directory); assert.equal(lost.running, false); assert.equal(lost.code, 1); assert.match(lost.output, /Restore the original key/); assert.equal(existsSync(keyPath), false);
  writeFileSync(keyPath, 'corrupt');
  const corrupt = await launch(directory); assert.equal(corrupt.running, false); assert.equal(corrupt.code, 1); assert.equal(readFileSync(keyPath, 'utf8'), 'corrupt');
});

test('env-file settings and process overrides work without writing secrets into env files', async t => {
  const directory = temporary(t); const file = path.join(directory, '.env'); const contents = 'DATABASE_PATH=./isolated/db.sqlite\nLINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=\nHOME_ASSISTANT_CA_FILE=\n'; writeFileSync(file, contents);
  const first = await launch(directory, { file: true }); t.after(() => first.stop()); assert.equal(first.running, true, first.output); await first.stop();
  assert.equal(existsSync(path.join(directory, 'isolated/linkwarden-config-encryption.key')), true); assert.equal(readFileSync(file, 'utf8'), contents);
  const explicitSecret = Buffer.alloc(32, 6).toString('base64');
  const override = await launch(directory, { file: true, env: { DATABASE_PATH: './override/app.db', LINKWARDEN_CONFIG_ENCRYPTION_KEY: explicitSecret } }); t.after(() => override.stop()); assert.equal(override.running, true, override.output); await override.stop();
  assert.equal(existsSync(path.join(directory, 'override/app.db')), true); assert.equal(existsSync(path.join(directory, 'override/linkwarden-config-encryption.key')), false); assert.equal(readFileSync(file, 'utf8'), contents);
  const failure = await launch(directory, { file: true, env: { HOME_ASSISTANT_CA_FILE: path.join(directory, 'missing.pem') } }); assert.equal(failure.running, false); assert.equal(failure.code, 1); assert.match(failure.output, /HOME_ASSISTANT_CA_FILE/);
  const invalid = await launch(directory, { file: true, env: { LINKWARDEN_CONFIG_ENCRYPTION_KEY: 'not-a-key' } }); assert.equal(invalid.running, false); assert.equal(invalid.code, 1); assert.match(invalid.output, /base64-encoded 32-byte key/); assert.doesNotMatch(invalid.output, /not-a-key/);
});
