import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, linkSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import path from 'node:path';
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

export function resolveLinkwardenEncryptionKey({ explicitSecret = '', filePath = '', hasEncryptedCredentials = false, random = randomBytes, readFile = readFileSync, writeFile = writeFileSync, mkdir = mkdirSync, link = linkSync, unlink = unlinkSync, open = openSync, close = closeSync, sync = fsyncSync } = {}) {
  if (explicitSecret) {
    encryptionKey(explicitSecret);
    return explicitSecret;
  }
  if (!filePath) return '';

  try {
    return readSecret(filePath, readFile);
  } catch (error) {
    if (error.cause?.code !== 'ENOENT') throw error;
  }

  if (hasEncryptedCredentials) throw new Error('Integration encryption key is missing. Restore the original key file or configure the original LINKWARDEN_CONFIG_ENCRYPTION_KEY; saved credentials must not be replaced.');

  const generated = random(32).toString('base64');
  encryptionKey(generated);
  const temporary = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
  let owned = false; let descriptor;
  try {
    mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    descriptor = open(temporary, 'wx', 0o600);
    owned = true;
    writeFile(descriptor, generated, { encoding: 'utf8' }); sync(descriptor);
    close(descriptor); descriptor = undefined;
    try { link(temporary, filePath); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return readSecret(filePath, readFile);
  } catch (error) {
    throw new Error(`Unable to initialize integration encryption key file (${error.code || 'invalid key'}). Check key storage permissions and restore existing key material if needed.`, { cause: error });
  } finally {
    if (descriptor !== undefined) close(descriptor);
    if (owned) {
      try { unlink(temporary); }
      catch (error) { throw new Error('Unable to clean up the owned temporary integration key file.', { cause: error }); }
    }
  }
}
