import path from 'node:path';
import { isIP } from 'node:net';
import { resolveLinkwardenEncryptionKey } from './linkwarden-key.js';

const integer = (value, fallback, name) => {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return parsed;
};

export function normalizeDashboardHostname(value, name = 'DASHBOARD_ALLOWED_HOSTS') {
  let hostname = String(value ?? '').trim().toLowerCase();
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
  if (hostname.endsWith('.')) hostname = hostname.slice(0, -1);
  if (!hostname || hostname.includes('/') || hostname.includes('@') || hostname.includes('?') || hostname.includes('#')) throw new Error(`${name} must contain only hostnames or IP addresses without schemes, ports, or paths.`);
  if (isIP(hostname) === 6) return new URL(`http://[${hostname}]`).hostname.slice(1, -1);
  if (isIP(hostname) === 4) return hostname;
  if (hostname.length > 253 || hostname.includes(':') || !hostname.split('.').every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) throw new Error(`${name} must contain only valid hostnames or IP addresses.`);
  return hostname;
}

export function allowedDashboardHosts(bindHost, configuredHosts = '') {
  const bindHostname = normalizeDashboardHostname(bindHost, 'HOST');
  const hosts = new Set();
  if (!['0.0.0.0', '::'].includes(bindHostname)) hosts.add(bindHostname);
  if (['127.0.0.1', 'localhost', '::1'].includes(bindHostname)) for (const hostname of ['127.0.0.1', 'localhost', '::1']) hosts.add(hostname);
  if (configuredHosts) {
    for (const entry of configuredHosts.split(',')) hosts.add(normalizeDashboardHostname(entry));
  }
  if (!hosts.size) throw new Error('DASHBOARD_ALLOWED_HOSTS must list at least one dashboard hostname or IP address when HOST is a wildcard address.');
  return Object.freeze([...hosts]);
}

export function loadConfig(environment = process.env) {
  const host = environment.HOST ?? '127.0.0.1';
  return Object.freeze({
    host,
    port: integer(environment.PORT, 3000, 'PORT'),
    allowedHosts: allowedDashboardHosts(host, environment.DASHBOARD_ALLOWED_HOSTS),
    databasePath: path.resolve(environment.DATABASE_PATH ?? './data/wol.db'),
    wolPort: integer(environment.WOL_PORT, 9, 'WOL_PORT'),
    wakeCooldownSeconds: integer(environment.WAKE_COOLDOWN_SECONDS, 20, 'WAKE_COOLDOWN_SECONDS'),
    linkwardenEncryptionKey: resolveLinkwardenEncryptionKey({
      explicitSecret: environment.LINKWARDEN_CONFIG_ENCRYPTION_KEY,
      filePath: environment.LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE
    }),
    linkwardenCacheSeconds: integer(environment.LINKWARDEN_CACHE_SECONDS, 60, 'LINKWARDEN_CACHE_SECONDS'),
    linkwardenCaFile: environment.LINKWARDEN_CA_FILE ? path.resolve(environment.LINKWARDEN_CA_FILE) : null
  });
}

export const config = loadConfig();
