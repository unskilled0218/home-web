import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/db.js';
import { decryptApiKey, encryptApiKey } from '../src/linkwarden-crypto.js';

test('stores Home Assistant tokens encrypted and independently from Linkwarden', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-home-assistant-db-'));
  const databasePath = path.join(directory, 'dashboard.db');
  const secret = Buffer.alloc(32, 6).toString('base64');
  const store = createStore(databasePath);
  try {
    store.saveHomeAssistant({ baseUrl: 'https://home.example.test', encryptedAccessToken: encryptApiKey('home-token', secret) });
    store.saveLinkwarden({ baseUrl: 'https://links.example.test', username: 'user', encryptedAccessToken: encryptApiKey('link-token', secret) });
    assert.equal(decryptApiKey(store.getHomeAssistant().encryptedAccessToken, secret), 'home-token');
    store.saveHomeAssistant({ baseUrl: 'https://new-home.example.test', encryptedAccessToken: encryptApiKey('new-token', secret) });
    assert.equal(store.getHomeAssistant().baseUrl, 'https://new-home.example.test');
    const inspector = new DatabaseSync(databasePath);
    const columns = inspector.prepare('PRAGMA table_info(home_assistant_config)').all().map((column) => column.name);
    const row = inspector.prepare('SELECT * FROM home_assistant_config').get();
    inspector.close();
    assert.equal(columns.includes('access_token'), false);
    assert.equal(JSON.stringify(row).includes('new-token'), false);
    assert.equal(store.removeHomeAssistant(), true);
    assert.equal(store.getHomeAssistant(), undefined);
    assert.equal(store.getLinkwarden().username, 'user');
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
