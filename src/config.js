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

function nfsConfig(environment) {
  const source = String(environment.NFS_SOURCE ?? '').trim();
  const mountPath = String(environment.NFS_MOUNT_PATH ?? '').trim();
  const mode = String(environment.NFS_MOUNT_MODE ?? (source ? 'mount' : 'disabled')).trim().toLowerCase();
  const rawOptions = String(environment.NFS_MOUNT_OPTIONS ?? '').trim();
  const invalidText = (value, limit) => value.length > limit || /[\0-\x1f\x7f]/.test(value);
  let error = null;
  if (!['disabled', 'mount', 'existing'].includes(mode)) error = 'NFS_MOUNT_MODE must be disabled, mount, or existing.';
  else if (mode !== 'disabled' && !mountPath) error = 'NFS_MOUNT_PATH is required when NFS backgrounds are enabled.';
  else if (mode === 'mount' && !source) error = 'NFS_SOURCE is required when NFS_MOUNT_MODE is mount.';
  else if (invalidText(source, 1024) || (source && (!source.includes(':') || /\s/.test(source)))) error = 'NFS_SOURCE is invalid.';
  else if (invalidText(mountPath, 1024)) error = 'NFS_MOUNT_PATH is invalid.';
  else if (invalidText(rawOptions, 512)) error = 'NFS_MOUNT_OPTIONS is invalid.';
  const options = rawOptions ? rawOptions.split(',').map((value) => value.trim()).filter(Boolean) : [];
  if (!error && options.some((value) => !/^[A-Za-z0-9._=:-]+$/.test(value) || ['rw', 'suid', 'dev', 'exec', 'hard', 'bg'].includes(value) || value.startsWith('retry='))) error = 'NFS_MOUNT_OPTIONS contains an unsafe option.';
  return Object.freeze({ mode, source, mountPath: mountPath ? path.resolve(mountPath) : null, options: Object.freeze(options), error });
}

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
    linkwardenCaFile: environment.LINKWARDEN_CA_FILE ? path.resolve(environment.LINKWARDEN_CA_FILE) : null,
    nodeExtraCaFile: environment.NODE_EXTRA_CA_CERTS ? path.resolve(environment.NODE_EXTRA_CA_CERTS) : null,
    homeAssistantCacheSeconds: integer(environment.HOME_ASSISTANT_CACHE_SECONDS, 30, 'HOME_ASSISTANT_CACHE_SECONDS'),
    calDavCacheSeconds: integer(environment.CALDAV_CACHE_SECONDS, 300, 'CALDAV_CACHE_SECONDS'),
    calDavCaFile: environment.CALDAV_CA_FILE ? path.resolve(environment.CALDAV_CA_FILE) : null,
    nfs: nfsConfig(environment)
  });
}

export const config = loadConfig();
