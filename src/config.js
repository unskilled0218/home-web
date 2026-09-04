import path from 'node:path';

const integer = (value, fallback, name) => {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
};

export const config = Object.freeze({
  host: process.env.HOST ?? '127.0.0.1',
  port: integer(process.env.PORT, 3000, 'PORT'),
  databasePath: path.resolve(process.env.DATABASE_PATH ?? './data/wol.db'),
  wolPort: integer(process.env.WOL_PORT, 9, 'WOL_PORT'),
  wakeCooldownSeconds: integer(process.env.WAKE_COOLDOWN_SECONDS, 20, 'WAKE_COOLDOWN_SECONDS')
});
