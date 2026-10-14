import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMountInfo, prepareNfs } from '../src/nfs.js';
import { FakeChild, deferred, tick } from './fixtures/lifecycle.js';

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

test('existing-mode checks reject default hard mounts before file access and accept bounded read-only NFSv3 binds', async () => {
  const cases = [
    { name: 'default host mount', vfs: 'rw,relatime', superblock: 'rw,vers=3,hard,proto=tcp,timeo=600,retrans=2', available: false },
    { name: 'read-only bind still has hard retry policy', vfs: 'ro,nosuid,nodev,noexec,relatime', superblock: 'rw,vers=3,hard,proto=tcp,timeo=600,retrans=2', available: false },
    { name: 'safe read-only bind on bounded NFSv3', vfs: 'ro,nosuid,nodev,noexec,relatime', superblock: 'rw,vers=3,soft,proto=tcp,timeo=20,retrans=2', available: true }
  ];
  for (const fixture of cases) {
    const mounts = parseMountInfo(`36 25 0:32 / /photos ${fixture.vfs} - nfs nas:/wallpaper ${fixture.superblock}`);
    let accessed = 0;
    const result = await prepareNfs({ mode: 'existing', mountPath: '/photos', options: [] }, {
      mounts: async () => mounts,
      statImpl: async () => { accessed++; return directory; },
      run: async () => assert.fail(`${fixture.name}: existing mode must never invoke mount`)
    });
    assert.deepEqual(result, fixture.available ? { available: true, reason: 'existing', root: '/photos' } : { available: false, reason: 'failed', root: null }, fixture.name);
    assert.equal(accessed, fixture.available ? 1 : 0, `${fixture.name}: unsafe topology must be rejected before directory access`);
  }
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

test('preparation ownership is registered before awaiting a command and rejection does not imply child exit', async () => {
  const child = new FakeChild(); const command = deferred(); const operation = Object.assign(command.promise, { child }); let owned; let exited = false; child.on('exit', () => { exited = true; });
  const result = prepareNfs({ mode: 'mount', source: 'nas:/photos', mountPath: '/photos', options: [] }, { mounts: async () => [], mkdirImpl: async () => {}, run: () => operation, onChild: (value) => { owned = value; } });
  await tick(); assert.equal(owned, child); command.reject(Object.assign(new Error('timeout kill denied'), { code: 'EACCES' })); assert.equal((await result).reason, 'failed'); assert.equal(exited, false); child.close(); assert.equal(exited, true);
});
