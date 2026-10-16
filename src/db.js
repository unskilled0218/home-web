import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { defaultHomeSettings, normalizeHomeSettings } from './home-settings.js';
import { createWeatherStore } from './weather-store.js';
import { createDashboardPreferenceStore } from './dashboard-preferences.js';
import { createSettingsTransfer } from './dashboard-settings-transfer.js';

export function createStore(databasePath) {
  mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS home_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      configuration TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
      username TEXT,
      key_ciphertext TEXT NOT NULL,
      key_iv TEXT NOT NULL,
      key_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS home_assistant_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL,
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS caldav_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_ciphertext TEXT NOT NULL,
      password_iv TEXT NOT NULL,
      password_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  let columns = new Set(db.prepare('PRAGMA table_info(linkwarden_config)').all().map((column) => column.name));
  if (!columns.has('username')) { db.exec('ALTER TABLE linkwarden_config ADD COLUMN username TEXT'); columns.add('username'); }
  if (columns.has('collection_id')) db.exec(`
    BEGIN;
    CREATE TABLE linkwarden_config_new (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      base_url TEXT NOT NULL,
      username TEXT,
      key_ciphertext TEXT NOT NULL,
      key_iv TEXT NOT NULL,
      key_tag TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO linkwarden_config_new (id, base_url, username, key_ciphertext, key_iv, key_tag, created_at, updated_at)
      SELECT id, base_url, username, key_ciphertext, key_iv, key_tag, COALESCE(created_at, CURRENT_TIMESTAMP), COALESCE(updated_at, CURRENT_TIMESTAMP) FROM linkwarden_config;
    DROP TABLE linkwarden_config;
    ALTER TABLE linkwarden_config_new RENAME TO linkwarden_config;
    COMMIT;
  `);
  const calDavColumns = new Set(db.prepare('PRAGMA table_info(caldav_config)').all().map((column) => column.name));
  if (calDavColumns.has('collection_url') && !calDavColumns.has('base_url')) {
    const legacy = db.prepare('SELECT * FROM caldav_config WHERE id = 1').get();
    let baseUrl;
    if (legacy) {
      try {
        const url = new URL(legacy.collection_url);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
        baseUrl = `${url.origin}/`;
      } catch { throw new Error('Saved CalDAV configuration contains an invalid URL.'); }
    }
    try {
      db.exec(`
        BEGIN;
        ALTER TABLE caldav_config RENAME TO caldav_config_legacy;
        CREATE TABLE caldav_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          base_url TEXT NOT NULL,
          username TEXT NOT NULL,
          password_ciphertext TEXT NOT NULL,
          password_iv TEXT NOT NULL,
          password_tag TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      if (legacy) db.prepare('INSERT INTO caldav_config (id, base_url, username, password_ciphertext, password_iv, password_tag, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(legacy.id, baseUrl, legacy.username, legacy.password_ciphertext, legacy.password_iv, legacy.password_tag, legacy.created_at, legacy.updated_at);
      db.exec('DROP TABLE caldav_config_legacy; COMMIT;');
    } catch (error) {
      try { db.exec('ROLLBACK;'); } catch { /* Preserve the migration error. */ }
      throw error;
    }
  }

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
    getHomeSettings: db.prepare('SELECT configuration, revision FROM home_settings WHERE id = 1'),
    initializeHomeSettings: db.prepare('INSERT OR IGNORE INTO home_settings (id, configuration, revision) VALUES (1, ?, 0)'),
    saveHomeSettings: db.prepare('UPDATE home_settings SET configuration = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND revision = ?'),
    list: db.prepare('SELECT * FROM devices ORDER BY group_name COLLATE NOCASE, name COLLATE NOCASE'),
    get: db.prepare('SELECT * FROM devices WHERE id = ?'),
    insert: db.prepare('INSERT INTO devices (name, mac_address, broadcast_address, ip_address, group_name) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare("UPDATE devices SET name = ?, mac_address = ?, broadcast_address = ?, ip_address = ?, group_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?"),
    remove: db.prepare('DELETE FROM devices WHERE id = ?'),
    markWake: db.prepare('UPDATE devices SET last_wake_requested_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'),
    audit: db.prepare('INSERT INTO wake_attempts (device_id, outcome, detail) VALUES (?, ?, ?)'),
    getLinkwarden: db.prepare('SELECT * FROM linkwarden_config WHERE id = 1'),
    saveLinkwarden: db.prepare("INSERT INTO linkwarden_config (id, base_url, username, key_ciphertext, key_iv, key_tag) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, username = excluded.username, key_ciphertext = excluded.key_ciphertext, key_iv = excluded.key_iv, key_tag = excluded.key_tag, updated_at = CURRENT_TIMESTAMP"),
    removeLinkwarden: db.prepare('DELETE FROM linkwarden_config WHERE id = 1'),
    getHomeAssistant: db.prepare('SELECT * FROM home_assistant_config WHERE id = 1'),
    saveHomeAssistant: db.prepare("INSERT INTO home_assistant_config (id, base_url, token_ciphertext, token_iv, token_tag) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, token_ciphertext = excluded.token_ciphertext, token_iv = excluded.token_iv, token_tag = excluded.token_tag, updated_at = CURRENT_TIMESTAMP"),
    removeHomeAssistant: db.prepare('DELETE FROM home_assistant_config WHERE id = 1'),
    getCalDav: db.prepare('SELECT * FROM caldav_config WHERE id = 1'),
    saveCalDav: db.prepare("INSERT INTO caldav_config (id, base_url, username, password_ciphertext, password_iv, password_tag) VALUES (1, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET base_url = excluded.base_url, username = excluded.username, password_ciphertext = excluded.password_ciphertext, password_iv = excluded.password_iv, password_tag = excluded.password_tag, updated_at = CURRENT_TIMESTAMP"),
    removeCalDav: db.prepare('DELETE FROM caldav_config WHERE id = 1')
  };
  const mapLinkwarden = (row) => row && ({ baseUrl: row.base_url, username: row.username, encryptedAccessToken: { ciphertext: row.key_ciphertext, iv: row.key_iv, tag: row.key_tag }, updatedAt: row.updated_at });
  const mapHomeAssistant = (row) => row && ({ baseUrl: row.base_url, encryptedAccessToken: { ciphertext: row.token_ciphertext, iv: row.token_iv, tag: row.token_tag }, updatedAt: row.updated_at });
  const mapCalDav = (row) => row && ({ serverUrl: row.base_url, username: row.username, encryptedPassword: { ciphertext: row.password_ciphertext, iv: row.password_iv, tag: row.password_tag }, updatedAt: row.updated_at });
  const weather = createWeatherStore(db); const preferences = createDashboardPreferenceStore(db);
  return {
    ...weather,
    ...preferences,
    ...createSettingsTransfer(db, preferences, weather),
    getHomeSettings() {
      queries.initializeHomeSettings.run(JSON.stringify(defaultHomeSettings()));
      const row = queries.getHomeSettings.get();
      return normalizeHomeSettings({ ...JSON.parse(row.configuration), revision: row.revision });
    },
    saveHomeSettings(value) {
      const settings = normalizeHomeSettings(value);
      if (!queries.saveHomeSettings.run(JSON.stringify(settings), settings.revision).changes) return null;
      return { ...settings, revision: settings.revision + 1 };
    },
    list: () => queries.list.all().map(mapDevice),
    get: (id) => mapDevice(queries.get.get(id)),
    create: (device) => { const result = queries.insert.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group); return mapDevice(queries.get.get(result.lastInsertRowid)); },
    update: (id, device) => { queries.update.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group, id); return mapDevice(queries.get.get(id)); },
    remove: (id) => queries.remove.run(id).changes > 0,
    markWake: (id) => queries.markWake.run(id),
    audit: (id, outcome, detail = null) => queries.audit.run(id, outcome, detail),
    getLinkwarden: () => mapLinkwarden(queries.getLinkwarden.get()),
    saveLinkwarden: ({ baseUrl, username, encryptedAccessToken }) => queries.saveLinkwarden.run(baseUrl, username, encryptedAccessToken.ciphertext, encryptedAccessToken.iv, encryptedAccessToken.tag),
    removeLinkwarden: () => queries.removeLinkwarden.run().changes > 0,
    getHomeAssistant: () => mapHomeAssistant(queries.getHomeAssistant.get()),
    saveHomeAssistant: ({ baseUrl, encryptedAccessToken }) => queries.saveHomeAssistant.run(baseUrl, encryptedAccessToken.ciphertext, encryptedAccessToken.iv, encryptedAccessToken.tag),
    removeHomeAssistant: () => queries.removeHomeAssistant.run().changes > 0,
    getCalDav: () => mapCalDav(queries.getCalDav.get()),
    saveCalDav: ({ serverUrl, username, encryptedPassword }) => queries.saveCalDav.run(serverUrl, username, encryptedPassword.ciphertext, encryptedPassword.iv, encryptedPassword.tag),
    removeCalDav: () => queries.removeCalDav.run().changes > 0,
    close: () => db.close()
  };
}
