export function sqliteTransaction(db, operation) {
  if (db.isTransaction) return operation();
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
