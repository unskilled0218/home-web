import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function encryptionKey(secret) {
  const key = Buffer.from(secret, 'base64');
  if (key.length !== 32 || key.toString('base64') !== secret) throw new Error('LINKWARDEN_CONFIG_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export function encryptApiKey(apiKey, secret, random = randomBytes) {
  const key = encryptionKey(secret);
  const iv = random(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decryptApiKey(encryptedKey, secret) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(encryptedKey.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(encryptedKey.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedKey.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}
