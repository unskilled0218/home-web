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
  const config = loadConfig({ HOST: '127.0.0.1', HOME_ASSISTANT_CACHE_SECONDS: '45', HOME_ASSISTANT_CA_FILE: './certs/home-assistant-ca.pem' });
  assert.equal(config.homeAssistantCacheSeconds, 45);
  assert.equal(config.homeAssistantCaFile, path.resolve('./certs/home-assistant-ca.pem'));
  assert.equal(config.nodeExtraCaFile, null);
});

test('loads scoped CalDAV runtime configuration', async () => {
  const { loadConfig } = await import('../src/config.js');
  const config = loadConfig({ HOST: '127.0.0.1', CALDAV_CACHE_SECONDS: '450', CALDAV_CA_FILE: './certs/baikal-ca.pem' });
  assert.equal(config.calDavCacheSeconds, 450);
  assert.equal(config.calDavCaFile, path.resolve('./certs/baikal-ca.pem'));
});

test('NFS defaults to off even when a source is configured', async () => {
  const { loadConfig } = await import('../src/config.js');
  assert.deepEqual(loadConfig({ HOST: '127.0.0.1' }).nfs, { mode: 'off', source: '', mountPath: null, options: [], error: null });
  for (const mode of [undefined, 'off', ' OFF ']) {
    const config = loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: mode, NFS_SOURCE: 'nas:/photos', NFS_MOUNT_PATH: '/photos' }).nfs;
    assert.equal(config.mode, 'off'); assert.equal(config.error, null);
  }
});

test('loads normalized on configuration for managed and existing mounts', async () => {
  const { loadConfig } = await import('../src/config.js');
  const mounted = loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: ' ON ', NFS_SOURCE: ' nas.lan:/photos ', NFS_MOUNT_PATH: './data/photos', NFS_MOUNT_OPTIONS: 'vers=4.2,timeo=20' }).nfs;
  assert.deepEqual(mounted, { mode: 'on', source: 'nas.lan:/photos', mountPath: path.resolve('./data/photos'), options: ['vers=4.2', 'timeo=20'], error: null });
  assert.equal(Object.isFrozen(mounted), true); assert.equal(Object.isFrozen(mounted.options), true);
  for (const source of [undefined, '', '  ']) {
    const existing = loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: 'on', NFS_SOURCE: source, NFS_MOUNT_PATH: '/photos' }).nfs;
    assert.equal(existing.mode, 'on'); assert.equal(existing.source, ''); assert.equal(existing.error, null);
  }
});

test('rejects legacy, empty, and unknown NFS modes nonfatally', async () => {
  const { loadConfig } = await import('../src/config.js');
  for (const mode of ['disabled', 'mount', 'existing', 'other', '', '  ']) {
    const config = loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: mode, NFS_MOUNT_PATH: '/photos' }).nfs;
    assert.equal(config.error, 'NFS_MOUNT_MODE must be on or off.', JSON.stringify(mode));
  }
});

test('enabled NFS validates mount paths, sources, and safety options', async () => {
  const { loadConfig } = await import('../src/config.js');
  for (const environment of [
    { NFS_SOURCE: 'invalid', NFS_MOUNT_PATH: '/photos' },
    { NFS_SOURCE: 'nas:/photos', NFS_MOUNT_PATH: '/photos', NFS_MOUNT_OPTIONS: 'rw' },
    { NFS_SOURCE: 'nas:/photos', NFS_MOUNT_PATH: '/photos', NFS_MOUNT_OPTIONS: 'bg' },
    {},
    { NFS_SOURCE: 'nas:/photos' }
  ]) assert.ok(loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: 'on', ...environment }).nfs.error, JSON.stringify(environment));
  assert.equal(loadConfig({ HOST: '127.0.0.1', NFS_MOUNT_MODE: 'off', NFS_SOURCE: 'invalid' }).nfs.error, 'NFS_SOURCE is invalid.');
});
