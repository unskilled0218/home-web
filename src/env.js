import { readFile } from 'node:fs/promises';

export function parseEnv(text) {
  const values = {};
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error(`Invalid environment entry on line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`Invalid environment key on line ${index + 1}.`);
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[key] = value;
  }
  return values;
}

export async function loadEnvFile(filePath, environment = process.env) {
  let text;
  try { text = await readFile(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  for (const [key, value] of Object.entries(parseEnv(text))) if (!Object.hasOwn(environment, key)) environment[key] = value;
  return true;
}
