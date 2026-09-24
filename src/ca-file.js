import { X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';

const CERTIFICATE_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |DSA |ENCRYPTED |OPENSSH )?PRIVATE KEY-----/;

export async function validateCaFile(filePath, variableName = 'NODE_EXTRA_CA_CERTS') {
  if (!filePath) return;
  let pem;
  try { pem = await readFile(filePath, 'utf8'); }
  catch (error) { throw new Error(`Unable to read ${variableName}: ${error.message}`); }
  if (!pem.trim()) throw new Error(`${variableName} must not be empty.`);
  if (PRIVATE_KEY_PATTERN.test(pem)) throw new Error(`${variableName} must contain certificates only, not private keys.`);
  const certificates = pem.match(CERTIFICATE_PATTERN) ?? [];
  if (!certificates.length) throw new Error(`${variableName} must contain at least one PEM certificate.`);
  try { for (const certificate of certificates) new X509Certificate(certificate); }
  catch { throw new Error(`${variableName} contains an invalid PEM certificate.`); }
}

export async function loadScopedCa(filePath, variableName) {
  if (!filePath) return undefined;
  await validateCaFile(filePath, variableName);
  return [...rootCertificates, await readFile(filePath, 'utf8')];
}
