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
  `);

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
    audit: db.prepare('INSERT INTO wake_attempts (device_id, outcome, detail) VALUES (?, ?, ?)')
  };
  return {
    list: () => queries.list.all().map(mapDevice),
    get: (id) => mapDevice(queries.get.get(id)),
    create: (device) => { const result = queries.insert.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group); return mapDevice(queries.get.get(result.lastInsertRowid)); },
    update: (id, device) => { queries.update.run(device.name, device.macAddress, device.broadcastAddress, device.ipAddress, device.group, id); return mapDevice(queries.get.get(id)); },
    remove: (id) => queries.remove.run(id).changes > 0,
    markWake: (id) => queries.markWake.run(id),
    audit: (id, outcome, detail = null) => queries.audit.run(id, outcome, detail),
    close: () => db.close()
  };
}
