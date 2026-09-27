import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMountInfo, prepareNfs } from '../src/nfs.js';

const directory = { isDirectory: () => true };

test('parses escaped Linux mount information', () => {
  const mounts = parseMountInfo('36 25 0:32 / /srv/photos\\040share ro,nosuid,nodev,noexec - nfs4 nas:/photos rw,soft,timeo=20,retrans=2\ninvalid');
  assert.deepEqual(mounts, [{ path: '/srv/photos share', type: 'nfs4', source: 'nas:/photos', options: ['ro', 'nosuid', 'nodev', 'noexec', 'rw', 'soft', 'timeo=20', 'retrans=2'] }]);
});

test('keeps disabled and invalid NFS configuration non-fatal', async () => {
  assert.deepEqual(await prepareNfs({ mode: 'disabled' }), { available: false, reason: 'disabled', root: null });
  assert.deepEqual(await prepareNfs({ mode: 'mount', error: 'bad' }), { available: false, reason: 'configuration', root: null });
});

test('uses an explicitly pre-mounted readable directory without invoking mount', async () => {
  let invoked = false;
  const result = await prepareNfs({ mode: 'existing', mountPath: '/photos', options: [] }, { mounts: async () => [{ path: '/photos', type: 'nfs4', source: 'nas:/photos', options: ['ro', 'nosuid', 'nodev', 'noexec', 'soft', 'timeo=20', 'retrans=2'] }], statImpl: async () => directory, run: async () => { invoked = true; } });
  assert.deepEqual(result, { available: true, reason: 'existing', root: '/photos' });
  assert.equal(invoked, false);
});

test('reuses a matching NFS mount and rejects an occupied conflicting mount point', async () => {
  const config = { mode: 'mount', source: 'nas:/photos', mountPath: '/photos', options: [], error: null };
  const options = ['ro', 'nosuid', 'nodev', 'noexec', 'soft', 'timeo=20', 'retrans=2'];
  assert.deepEqual(await prepareNfs(config, { mounts: async () => [{ path: '/photos', type: 'nfs4', source: 'nas:/photos', options }] }), { available: true, reason: 'mounted', root: '/photos' });
  assert.equal((await prepareNfs(config, { mounts: async () => [{ path: '/photos', type: 'ext4', source: '/dev/sda', options }] })).available, false);
  assert.equal((await prepareNfs(config, { mounts: async () => [{ path: '/photos', type: 'nfs4', source: 'nas:/photos', options: ['rw', 'hard'] }] })).available, false);
});

test('mounts with fixed safety options and verifies the result', async () => {
  const config = { mode: 'mount', source: 'nas:/photos', mountPath: '/photos', options: ['vers=4.2'], error: null };
  let mounted = false; let invocation;
  const result = await prepareNfs(config, {
    mounts: async () => mounted ? [{ path: '/photos', type: 'nfs4', source: 'nas:/photos', options: ['ro', 'nosuid', 'nodev', 'noexec', 'soft', 'timeo=20', 'retrans=2'] }] : [],
    mkdirImpl: async (target, options) => { assert.equal(target, '/photos'); assert.deepEqual(options, { recursive: true }); },
    run: async (...args) => { invocation = args; mounted = true; }
  });
  assert.equal(result.available, true);
  assert.deepEqual(invocation, ['mount', ['-t', 'nfs', '-o', 'vers=4.2,ro,nosuid,nodev,noexec,soft,timeo=20,retrans=2', 'nas:/photos', '/photos'], { timeout: 5_000, maxBuffer: 8_192, windowsHide: true }]);
});

test('converts mount command and verification failures into unavailable results', async () => {
  const config = { mode: 'mount', source: 'secret-host:/private', mountPath: '/photos', options: [], error: null };
  const failed = await prepareNfs(config, { mounts: async () => [], mkdirImpl: async () => {}, run: async () => { throw new Error('secret-host:/private denied'); } });
  assert.deepEqual(failed, { available: false, reason: 'failed', root: null });
  const unverified = await prepareNfs(config, { mounts: async () => [], mkdirImpl: async () => {}, run: async () => {} });
  assert.deepEqual(unverified, { available: false, reason: 'failed', root: null });
});
