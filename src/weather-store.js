import { randomUUID } from 'node:crypto';
import { validateWeatherLocation, weatherTimezone } from '../public/weather-data.js';
import { sqliteTransaction } from './sqlite-transaction.js';

// Weather transactions share the application's SQLite connection and lifecycle.
export function createWeatherStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS weather_location (id INTEGER PRIMARY KEY CHECK (id = 1), location TEXT, revision INTEGER NOT NULL);
    INSERT OR IGNORE INTO weather_location (id, location, revision) VALUES (1, NULL, 0);
    CREATE TABLE IF NOT EXISTS weather_cache (
      part TEXT NOT NULL, timezone TEXT NOT NULL, revision INTEGER NOT NULL, registration TEXT NOT NULL,
      payload TEXT, updated INTEGER, attempted INTEGER, failed INTEGER NOT NULL DEFAULT 0, touched INTEGER NOT NULL,
      PRIMARY KEY (part, timezone)
    );
  `);
  const locationQuery = db.prepare('SELECT location, revision FROM weather_location WHERE id = 1');
  const cacheQuery = db.prepare('SELECT * FROM weather_cache WHERE part = ? AND timezone = ?');
  const variantsQuery = db.prepare("SELECT * FROM weather_cache WHERE part = 'forecast' ORDER BY timezone");
  const insertQuery = db.prepare('INSERT INTO weather_cache (part, timezone, revision, registration, touched) VALUES (?, ?, ?, ?, ?)');
  const guard = 'part = ? AND timezone = ? AND revision = ? AND registration = ? AND revision = (SELECT revision FROM weather_location WHERE id = 1)';
  const attemptQuery = db.prepare(`UPDATE weather_cache SET attempted = ? WHERE ${guard}`);
  const successQuery = db.prepare(`UPDATE weather_cache SET payload = ?, updated = ?, failed = 0 WHERE ${guard}`);
  const failureQuery = db.prepare(`UPDATE weather_cache SET failed = 1 WHERE ${guard}`);
  const resetQuery = db.prepare(`UPDATE weather_cache SET attempted = NULL WHERE ${guard}`);
  const key = (row) => [row.part, row.timezone, row.revision, row.registration];
  function transaction(operation) {
    return sqliteTransaction(db, operation);
  }
  function getWeatherLocation() {
    const row = locationQuery.get();
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) throw new Error('Invalid saved weather location');
    return { location: row.location === null ? null : validateWeatherLocation(JSON.parse(row.location)), revision: row.revision };
  }
  function registerWeatherPart(part, zone, touched, touch = true) {
    const timezone = part === 'air' ? '' : weatherTimezone(zone);
    return transaction(() => {
      const saved = getWeatherLocation();
      if (!saved.location) return null;
      let row = cacheQuery.get(part, timezone);
      if (row && row.revision !== saved.revision) throw new Error('Invalid weather cache revision');
      if (!row) {
        if (part === 'forecast' && variantsQuery.all().length >= 8) db.prepare("DELETE FROM weather_cache WHERE part = 'forecast' AND timezone = (SELECT timezone FROM weather_cache WHERE part = 'forecast' AND timezone != 'UTC' ORDER BY touched, timezone LIMIT 1)").run();
        insertQuery.run(part, timezone, saved.revision, randomUUID(), touched);
      } else if (touch) db.prepare('UPDATE weather_cache SET touched = ? WHERE part = ? AND timezone = ?').run(touched, part, timezone);
      row = cacheQuery.get(part, timezone);
      return row;
    });
  }
  return {
    getWeatherLocation,
    saveWeatherLocation(location, revision) {
      const next = location === null ? null : validateWeatherLocation(location);
      return transaction(() => {
        const saved = getWeatherLocation();
        if (saved.revision !== revision) return null;
        if (JSON.stringify(saved.location) === JSON.stringify(next)) return { ...saved, changed: false, coordinatesChanged: false };
        const coordinatesChanged = !saved.location || !next || saved.location.latitude !== next.latitude || saved.location.longitude !== next.longitude;
        db.prepare('UPDATE weather_location SET location = ?, revision = revision + 1 WHERE id = 1').run(next === null ? null : JSON.stringify(next));
        if (coordinatesChanged) db.prepare('DELETE FROM weather_cache').run();
        else db.prepare('UPDATE weather_cache SET revision = ?').run(revision + 1);
        return { location: next, revision: revision + 1, changed: true, coordinatesChanged };
      });
    },
    registerWeatherPart,
    getWeatherPart: (part, timezone = '') => cacheQuery.get(part, timezone) ?? null,
    listWeatherVariants: () => variantsQuery.all(),
    beginWeatherAttempt: (row, timestamp) => Boolean(attemptQuery.run(timestamp, ...key(row)).changes),
    finishWeatherAttempt(row, payload, timestamp) {
      return Boolean(payload === null ? failureQuery.run(...key(row)).changes : successQuery.run(JSON.stringify(payload), timestamp, ...key(row)).changes);
    },
    resetWeatherAttempt: (row) => resetQuery.run(...key(row)),
    weatherPartCurrent(row) {
      const current = cacheQuery.get(row.part, row.timezone);
      return Boolean(current && current.revision === row.revision && current.registration === row.registration && getWeatherLocation().revision === row.revision);
    }
  };
}
