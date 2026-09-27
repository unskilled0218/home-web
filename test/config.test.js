import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { allowedDashboardHosts, normalizeDashboardHostname } from '../src/config.js';

test('normalizes explicit dashboard hosts and loopback aliases', () => {
  assert.deepEqual(allowedDashboardHosts('127.0.0.1', ' Dashboard.LAN.,::1 '), ['127.0.0.1', 'localhost', '::1', 'dashboard.lan']);
  assert.deepEqual(allowedDashboardHosts('192.168.1.10', 'dashboard.lan'), ['192.168.1.10', 'dashboard.lan']);
  assert.equal(normalizeDashboardHostname('[::1]'), '::1');
  assert.equal(normalizeDashboardHostname('fd00:0:0:0:0:0:0:1'), 'fd00::1');
});

test('rejects wildcard binds without an explicit host and malformed allowed hosts', () => {
  assert.throws(() => allowedDashboardHosts('0.0.0.0'), /must list at least one/);
  assert.deepEqual(allowedDashboardHosts('0.0.0.0', 'dashboard.lan'), ['dashboard.lan']);
  for (const value of ['https://dashboard.lan', 'dashboard.lan:3000', 'dashboard.lan/path', '*.lan', 'dashboard_lan']) assert.throws(() => normalizeDashboardHostname(value), /hostnames or IP addresses/);
});

test('loads Home Assistant runtime configuration', async () => {
  const { loadConfig } = await import('../src/config.js');
  const config = loadConfig({ HOST: '127.0.0.1', HOME_ASSISTANT_CACHE_SECONDS: '45', NODE_EXTRA_CA_CERTS: './certs/home-assistant-ca.pem' });
  assert.equal(config.homeAssistantCacheSeconds, 45);
  assert.equal(config.nodeExtraCaFile, path.resolve('./certs/home-assistant-ca.pem'));
});

test('loads scoped CalDAV runtime configuration', async () => {
  const { loadConfig } = await import('../src/config.js');
  const config = loadConfig({ HOST: '127.0.0.1', CALDAV_CACHE_SECONDS: '450', CALDAV_CA_FILE: './certs/baikal-ca.pem' });
  assert.equal(config.calDavCacheSeconds, 450);
  assert.equal(config.calDavCaFile, path.resolve('./certs/baikal-ca.pem'));
});

test('loads optional NFS mount and pre-mounted photo configuration', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.deepEqual(loadConfig({ HOST: '127.0.0.1' }).nfs, { mode: 'disabled', source: '', mountPath: null, options: [], error: null });
  const mounted = loadConfig({ HOST: '127.0.0.1', NFS_SOURCE: 'nas.lan:/photos', NFS_MOUNT_PATH: './data/photos', NFS_MOUNT_OPTIONS: 'vers=4.2,timeo=20' }).nfs;
  assert.deepEqual(mounted, { mode: 'mount', source: 'nas.lan:/photos', mountPath: path.resolve('./data/photos'), options: ['vers=4.2', 'timeo=20'], error: null });
  const existing = loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: 'existing', NFS_MOUNT_PATH: '/photos' }).nfs;
  assert.equal(existing.mode, 'existing'); assert.equal(existing.error, null);
  for (const environment of [
    { NFS_SOURCE: 'invalid', NFS_MOUNT_PATH: '/photos' },
    { NFS_SOURCE: 'nas:/photos', NFS_MOUNT_PATH: '/photos', NFS_MOUNT_OPTIONS: 'rw' },
    { NFS_SOURCE: 'nas:/photos', NFS_MOUNT_PATH: '/photos', NFS_MOUNT_OPTIONS: 'bg' },
    { NFS_MOUNT_MODE: 'existing' },
    { NFS_MOUNT_MODE: 'other', NFS_MOUNT_PATH: '/photos' }
  ]) assert.ok(loadConfig({ HOST: '127.0.0.1', ...environment }).nfs.error);
});
