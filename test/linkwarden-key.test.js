import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { encryptionKey } from '../src/linkwarden-crypto.js';
import { resolveLinkwardenEncryptionKey } from '../src/linkwarden-key.js';

function temporaryDirectory(context) {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-key-'));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('creates and reuses a restricted Linkwarden encryption key file', (context) => {
  const filePath = path.join(temporaryDirectory(context), 'linkwarden.key');
  const created = resolveLinkwardenEncryptionKey({ filePath });
  assert.equal(encryptionKey(created).length, 32);
  assert.equal(statSync(filePath).mode & 0o077, 0);
  assert.equal(resolveLinkwardenEncryptionKey({ filePath }), created);
});

test('prefers an explicit Linkwarden encryption key without creating a file', (context) => {
  const filePath = path.join(temporaryDirectory(context), 'linkwarden.key');
  const explicitSecret = Buffer.alloc(32, 7).toString('base64');
  assert.equal(resolveLinkwardenEncryptionKey({ explicitSecret, filePath }), explicitSecret);
  assert.equal(existsSync(filePath), false);
  assert.throws(() => resolveLinkwardenEncryptionKey({ explicitSecret: 'invalid', filePath }), /base64-encoded 32-byte/);
  assert.equal(existsSync(filePath), false);
});

test('keeps Linkwarden optional when no encryption key source is configured', () => {
  assert.equal(resolveLinkwardenEncryptionKey(), '');
});

test('configuration inspection projects a key path without creating or reading a key', (context) => {
  const filePath = path.join(temporaryDirectory(context), 'linkwarden.key');
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const configured = execFileSync(process.execPath, ['--input-type=module', '--eval', "import { config } from './src/config.js'; process.stdout.write(config.linkwardenEncryptionKey);"], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, LINKWARDEN_CONFIG_ENCRYPTION_KEY: '', LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE: filePath }
  });
  assert.equal(configured, '');
  assert.equal(existsSync(filePath), false);
  writeFileSync(filePath, 'invalid');
  execFileSync(process.execPath, ['--input-type=module', '--eval', "import './src/config.js';"], { cwd: projectRoot, env: { ...process.env, LINKWARDEN_CONFIG_ENCRYPTION_KEY: '', LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE: filePath } });
  assert.equal(readFileSync(filePath, 'utf8'), 'invalid');
});

test('rejects persisted Linkwarden encryption keys without replacing them', (context) => {
  const directory = temporaryDirectory(context);
  const filePath = path.join(directory, 'linkwarden.key');
  writeFileSync(filePath, 'invalid-key');
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath }), /must contain a base64-encoded 32-byte key/);
  assert.equal(existsSync(filePath), true);

  writeFileSync(filePath, '');
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath }), /must contain a base64-encoded 32-byte key/);
});

test('reports unreadable and uncreatable Linkwarden key paths', (context) => {
  const directory = temporaryDirectory(context);
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath: directory }), /Unable to read Linkwarden encryption key file/);
  const nested = path.join(directory, 'missing', 'linkwarden.key');
  assert.equal(encryptionKey(resolveLinkwardenEncryptionKey({ filePath: nested })).length, 32);
  assert.equal(statSync(path.dirname(nested)).mode & 0o077, 0);
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath: path.join(directory, 'short.key'), random: () => Buffer.alloc(31) }), /base64-encoded 32-byte key/);
  assert.equal(existsSync(path.join(directory, 'short.key')), false);
});

test('uses the persisted winner when atomic key creation loses a race', (context) => {
  const winner = Buffer.alloc(32, 9).toString('base64');
  let reads = 0;
  const readFile = () => {
    reads += 1;
    if (reads === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return `${winner}\n`;
  };
  const directory = temporaryDirectory(context);
  const link = () => { throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); };
  assert.equal(resolveLinkwardenEncryptionKey({ filePath: path.join(directory, 'linkwarden.key'), readFile, link }), winner);
  assert.equal(reads, 2);
  assert.deepEqual(readdirSync(directory), []);
});

test('lost-key refusal and partial write/publication failure never rotate keys or leave owned temp files', (context) => {
  const directory = temporaryDirectory(context); const filePath = path.join(directory, 'key');
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath, hasEncryptedCredentials: true }), /Restore the original/);
  assert.deepEqual(readdirSync(directory), []);
  for (const seam of ['writeFile', 'link']) {
    assert.throws(() => resolveLinkwardenEncryptionKey({ filePath, [seam]: () => { throw Object.assign(new Error('secret detail'), { code: 'EACCES' }); } }), /Unable to initialize/);
    assert.deepEqual(readdirSync(directory), [], `${seam}: owned temporary file removed, no published key`);
  }
  let writes = 0;
  const explicitSecret = Buffer.alloc(32, 2).toString('base64');
  assert.equal(resolveLinkwardenEncryptionKey({ filePath, explicitSecret, writeFile() { writes++; }, mkdir() { writes++; }, readFile() { writes++; } }), explicitSecret);
  assert.equal(writes, 0);
});

test('concurrent real initializers publish one complete key and remove their own temporary files', async (context) => {
  const directory = temporaryDirectory(context); const filePath = path.join(directory, 'nested', 'key');
  const moduleUrl = new URL('../src/linkwarden-key.js', import.meta.url).href;
  const results = await Promise.all(Array.from({ length: 6 }, async () => {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', `import { resolveLinkwardenEncryptionKey } from ${JSON.stringify(moduleUrl)}; process.stdout.write(resolveLinkwardenEncryptionKey({filePath:${JSON.stringify(filePath)}}));`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; let error = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    const [code] = await once(child, 'exit'); assert.equal(code, 0, error); return output;
  }));
  assert.equal(new Set(results).size, 1); assert.equal(readFileSync(filePath, 'utf8'), results[0]);
  assert.equal(encryptionKey(results[0]).length, 32); assert.deepEqual(readdirSync(path.dirname(filePath)), ['key']);
});
