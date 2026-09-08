import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function createStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mac_address TEXT NOT NULL UNIQUE,
      broadcast_address TEXT NOT NULL,
      ip_address TEXT,
      group_name TEXT NOT NULL DEFAULT '',
      last_wake_requested_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS wake_attempts (
      id INTEGER PRIMARY KEY,
      device_id INTEGER NOT NULL,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      outcome TEXT NOT NULL,
      detail TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS linkwarden_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL,
      collection_id INTEGER NOT NULL CHECK (collection_id > 0),
      key_ciphertext TEXT NOT NULL,
      key_iv TEXT NOT NULL,
      key_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const columns = new Set(db.prepare('PRAGMA table_info(linkwarden_config)').all().map((column) => column.name));
  if (!columns.has('username')) db.exec('ALTER TABLE linkwarden_config ADD COLUMN username TEXT');
  if (!columns.has('collection_name')) db.exec('ALTER TABLE linkwarden_config ADD COLUMN collection_name TEXT');

  const mapDevice = (row) => row && ({
    id: row.id,
    name: row.name,
    macAddress: row.mac_address,
    broadcastAddress: row.broadcast_address,
    ipAddress: row.ip_address,
    group: row.group_name,
    lastWakeRequestedAt: row.last_wake_requested_at
  });
  const queries = {
    list: db.prepare('SELECT * FROM devices ORDER BY group_name COLLATE NOCASE, name COLLATE NOCASE'),
    get: db.prepare('SELECT * FROM devices WHERE id = ?'),
    insert: db.prepare('INSERT INTO devices (name, mac_address, broadcast_address, ip_address, group_name) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare("UPDATE devices SET name = ?, mac_address = ?, broadcast_address = ?, ip_address = ?, group_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
    remove: db.prepare('DELETE FROM devices WHERE id = ?'),
    markWake: db.prepare('UPDATE devices SET last_wake_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    audit: db.prepare('INSERT INTO wake_attempts (device_id, outcome, detail) VALUES (?, ?, ?)'),
    getLinkwarden: db.prepare('SELECT * FROM linkwarden_config WHERE id = 1'),
    saveLinkwarden: db.prepare("INSERT INTO linkwarden_config (id, base_url, username, collection_name, collection_id, key_ciphertext, key_iv, key_tag) VALUES (1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, username = excluded.username, collection_name = excluded.collection_name, collection_id = excluded.collection_id, key_ciphertext = excluded.key_ciphertext, key_iv = excluded.key_iv, key_tag = excluded.key_tag, updated_at = CURRENT_TIMESTAMP"),
    removeLinkwarden: db.prepare('DELETE FROM linkwarden_config WHERE id = 1')
  };
  const mapLinkwarden = (row) => row && ({ baseUrl: row.base_url, username: row.username, collectionName: row.collection_name, collectionId: row.collection_id, encryptedAccessToken: { ciphertext: row.key_ciphertext, iv: row.key_iv, tag: row.key_tag }, updatedAt: row.updated_at });
  return {
    list: () => queries.list.all().map(mapDevice),
    get: (id) => mapDevice(queries.get.get(id)),
    create: (device) => { const result = queries.insert.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group); return mapDevice(queries.get.get(result.lastInsertRowid)); },
    update: (id, device) => { queries.update.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group, id); return mapDevice(queries.get.get(id)); },
    remove: (id) => queries.remove.run(id).changes > 0,
    markWake: (id) => queries.markWake.run(id),
    audit: (id, outcome, detail = null) => queries.audit.run(id, outcome, detail),
    getLinkwarden: () => mapLinkwarden(queries.getLinkwarden.get()),
    saveLinkwarden: ({ baseUrl, username, collectionName, collectionId, encryptedAccessToken }) => queries.saveLinkwarden.run(baseUrl, username, collectionName, collectionId, encryptedAccessToken.ciphertext, encryptedAccessToken.iv, encryptedAccessToken.tag),
    removeLinkwarden: () => queries.removeLinkwarden.run().changes > 0,
    close: () => db.close()
  };
}
