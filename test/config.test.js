import test from 'node:test';
import assert from 'node:assert/strict';
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

test('loads the Home Assistant cache duration', async () => {
  const { loadConfig } = await import('../src/config.js');
  const config = loadConfig({ HOST: '127.0.0.1', HOME_ASSISTANT_CACHE_SECONDS: '45' });
  assert.equal(config.homeAssistantCacheSeconds, 45);
});
