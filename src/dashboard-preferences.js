import { decodeStoredDashboardPreferences, normalizeDashboardPreferences, validateDashboardPreferences } from '../public/dashboard-helpers.js';

export function createDashboardPreferenceStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS dashboard_preferences (id INTEGER PRIMARY KEY CHECK (id = 1), configuration TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const read = db.prepare('SELECT configuration, revision FROM dashboard_preferences WHERE id = 1');
  const insert = db.prepare('INSERT OR IGNORE INTO dashboard_preferences (id, configuration, revision) VALUES (1, ?, 1)');
  const update = db.prepare('UPDATE dashboard_preferences SET configuration = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND revision = ?');
  function transaction(operation) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function getDashboardPreferences() {
    const row = read.get();
    if (!row) return { initialized: false, revision: 0, preferences: normalizeDashboardPreferences() };
    if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('Invalid stored dashboard revision.');
    return { initialized: true, revision: row.revision, preferences: decodeStoredDashboardPreferences(JSON.parse(row.configuration)) };
  }
  return {
    getDashboardPreferences,
    initializeDashboardPreferences(value) {
      const preferences = validateDashboardPreferences(value);
      return transaction(() => { const created = Boolean(insert.run(JSON.stringify(preferences)).changes); return { ...getDashboardPreferences(), created }; });
    },
    saveDashboardPreferences(value, revision) {
      const preferences = validateDashboardPreferences(value);
      return transaction(() => {
        const current = getDashboardPreferences();
        if (current.revision !== revision) return null;
        if (!current.initialized) insert.run(JSON.stringify(preferences));
        else if (JSON.stringify(current.preferences) !== JSON.stringify(preferences)) update.run(JSON.stringify(preferences), revision);
        return getDashboardPreferences();
      });
    }
  };
}
