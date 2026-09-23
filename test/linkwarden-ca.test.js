import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadLinkwardenCa } from '../src/linkwarden-ca.js';

test('loads a private CA alongside default roots and rejects bad paths', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lan-wake-ca-'));
  const empty = path.join(directory, 'empty.pem');
  const caFile = path.join(directory, 'private-ca.pem');
  writeFileSync(empty, '   \n');
  writeFileSync(caFile, 'private-ca');
  try {
    assert.equal(await loadLinkwardenCa(), undefined);
    const roots = await loadLinkwardenCa(caFile);
    assert.equal(roots.at(-1), 'private-ca');
    assert.ok(roots.length > 1);
    await assert.rejects(loadLinkwardenCa(empty), /must not be empty/);
    await assert.rejects(loadLinkwardenCa(path.join(directory, 'missing.pem')), /Unable to read LINKWARDEN_CA_FILE/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
