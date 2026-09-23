import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
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
  assert.equal(resolveLinkwardenEncryptionKey({ explicitSecret: 'invalid', filePath }), 'invalid');
  assert.equal(existsSync(filePath), false);
});

test('keeps Linkwarden optional when no encryption key source is configured', () => {
  assert.equal(resolveLinkwardenEncryptionKey(), '');
});

test('loads the persistent key through application configuration', (context) => {
  const filePath = path.join(temporaryDirectory(context), 'linkwarden.key');
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const configured = execFileSync(process.execPath, ['--input-type=module', '--eval', "import { config } from './src/config.js'; process.stdout.write(config.linkwardenEncryptionKey);"], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, LINKWARDEN_CONFIG_ENCRYPTION_KEY: '', LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE: filePath }
  });
  assert.equal(configured, readFileSync(filePath, 'utf8'));
  assert.equal(encryptionKey(configured).length, 32);
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
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath: path.join(directory, 'missing', 'linkwarden.key') }), /Unable to create Linkwarden encryption key file/);
  assert.throws(() => resolveLinkwardenEncryptionKey({ filePath: path.join(directory, 'short.key'), random: () => Buffer.alloc(31) }), /base64-encoded 32-byte key/);
  assert.equal(existsSync(path.join(directory, 'short.key')), false);
});

test('uses the persisted winner when atomic key creation loses a race', () => {
  const winner = Buffer.alloc(32, 9).toString('base64');
  let reads = 0;
  const readFile = () => {
    reads += 1;
    if (reads === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return `${winner}\n`;
  };
  const writeFile = () => { throw Object.assign(new Error('already exists'), { code: 'EEXIST' }); };
  assert.equal(resolveLinkwardenEncryptionKey({ filePath: '/data/linkwarden.key', readFile, writeFile }), winner);
  assert.equal(reads, 2);
});
