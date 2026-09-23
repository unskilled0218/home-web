import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { rootCertificates } from 'node:tls';
import { validateCaFile } from '../src/ca-file.js';

test('validates certificate-only CA bundles', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-extra-ca-'));
  const empty = path.join(directory, 'empty.pem');
  const malformed = path.join(directory, 'malformed.pem');
  const privateKey = path.join(directory, 'private-key.pem');
  const valid = path.join(directory, 'valid.pem');
  writeFileSync(empty, '  \n');
  writeFileSync(malformed, '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----\n');
  writeFileSync(privateKey, `${rootCertificates[0]}\n-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----\n`);
  writeFileSync(valid, `${rootCertificates[0]}\n${rootCertificates[1]}\n`);
  try {
    await assert.doesNotReject(validateCaFile());
    await assert.doesNotReject(validateCaFile(valid));
    await assert.rejects(validateCaFile(path.join(directory, 'missing.pem')), /Unable to read NODE_EXTRA_CA_CERTS/);
    await assert.rejects(validateCaFile(directory), /Unable to read NODE_EXTRA_CA_CERTS/);
    await assert.rejects(validateCaFile(empty), /must not be empty/);
    await assert.rejects(validateCaFile(malformed), /invalid PEM certificate/);
    await assert.rejects(validateCaFile(privateKey), /certificates only/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
