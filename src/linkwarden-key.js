import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { encryptionKey } from './linkwarden-crypto.js';

function validateFileSecret(secret, filePath) {
  try {
    encryptionKey(secret);
  } catch {
    throw new Error(`Linkwarden encryption key file ${filePath} must contain a base64-encoded 32-byte key.`);
  }
  return secret;
}

function readSecret(filePath, readFile) {
  let value;
  try {
    value = readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read Linkwarden encryption key file ${filePath}: ${error.message}`, { cause: error });
  }
  return validateFileSecret(value.trim(), filePath);
}

export function resolveLinkwardenEncryptionKey({ explicitSecret = '', filePath = '', random = randomBytes, readFile = readFileSync, writeFile = writeFileSync } = {}) {
  if (explicitSecret) {
    return explicitSecret;
  }
  if (!filePath) return '';

  try {
    return readSecret(filePath, readFile);
  } catch (error) {
    if (error.cause?.code !== 'ENOENT') throw error;
  }

  const generated = random(32).toString('base64');
  encryptionKey(generated);
  try {
    writeFile(filePath, generated, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return generated;
  } catch (error) {
    if (error.code === 'EEXIST') return readSecret(filePath, readFile);
    throw new Error(`Unable to create Linkwarden encryption key file ${filePath}: ${error.message}`, { cause: error });
  }
}
