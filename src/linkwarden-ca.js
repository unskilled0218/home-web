import { readFile } from 'node:fs/promises';
import { rootCertificates } from 'node:tls';

export async function loadLinkwardenCa(filePath) {
  if (!filePath) return undefined;
  let pem;
  try { pem = await readFile(filePath, 'utf8'); }
  catch (error) { throw new Error(`Unable to read LINKWARDEN_CA_FILE: ${error.message}`); }
  if (!pem.trim()) throw new Error('LINKWARDEN_CA_FILE must not be empty.');
  return [...rootCertificates, pem];
}
