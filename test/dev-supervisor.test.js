import test from 'node:test';
import { temporaryPrefix } from '../scripts/temporary.js';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { createDevSupervisor, developmentEnvironment, scanDevelopmentFiles } from '../scripts/dev-supervisor.js';
import { APPLICATION_SHUTDOWN_TIMEOUT_MS, SUPERVISOR_SHUTDOWN_MARGIN_MS, SUPERVISOR_SHUTDOWN_TIMEOUT_MS } from '../src/lifecycle-constants.js';
import { FakeChild, deferred, fakeClock, tick } from './fixtures/lifecycle.js';

function fixture(extra = {}) {
  const clock = fakeClock(); const children = []; const messages = []; let files = new Map([['src/lifecycle-constants.js', 'budget'], ['src/server.js', 'one']]);
  const supervisor = createDevSupervisor({ ...clock, root: '/fixture', childEnvironment: (_root, environment) => ({ ...environment }), report: (message) => messages.push(message), scan: async () => new Map(files), spawnImpl: (_executable, args, options) => { assert.deepEqual(args, ['--env-file-if-exists=.env', '/fixture/src/server.js']); assert.equal(options.cwd, '/fixture'); assert.equal(options.stdio.at(-1), 'ipc'); const child = new FakeChild(); children.push(child); return child; }, ...extra });
  return { clock, children, messages, supervisor, change(file = 'src/server.js', value = 'two') { files.set(file, value); } };
}

test('polling enumerates source/config changes but excludes databases, tasks, dependencies and symlinks', async (t) => {
  const root = await mkdtemp(temporaryPrefix('dev-scan-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src', 'public', 'data', 'tasks', 'node_modules']) await mkdir(`${root}/${directory}`);
  await writeFile(`${root}/package.json`, '{}'); await writeFile(`${root}/src/server.js`, 'one'); await writeFile(`${root}/data/wol.db`, 'database'); await writeFile(`${root}/public/style.css`, 'css');
  await symlink(`${root}/data/wol.db`, `${root}/src/linked.js`);
  const first = await scanDevelopmentFiles(root); assert.deepEqual([...first.keys()], ['package.json', 'src/server.js']);
  await writeFile(`${root}/.env`, 'PORT=5000'); await writeFile(`${root}/public/data.js`, 'data'); await writeFile(`${root}/src/server.js`, 'changed');
  const next = await scanDevelopmentFiles(root); assert.notEqual(next.get('src/server.js'), first.get('src/server.js')); assert.ok(next.has('.env')); assert.ok(next.has('public/data.js'));
  await rm(`${root}/public/data.js`); assert.equal((await scanDevelopmentFiles(root)).has('public/data.js'), false);
});

test('child-only native env parsing preserves precedence and never pins file values in the parent', async (t) => {
  const root = await mkdtemp(temporaryPrefix('dev-environment-')); t.after(() => rm(root, { recursive: true, force: true })); const original = { PORT: '5000' };
  await writeFile(`${root}/.env`, 'PORT=4000\nNODE_EXTRA_CA_CERTS="first.pem"\nQUOTED="two words"\n');
  assert.deepEqual(developmentEnvironment(root, original), { PORT: '5000', NODE_EXTRA_CA_CERTS: 'first.pem', QUOTED: 'two words' }); assert.deepEqual(original, { PORT: '5000' });
  await writeFile(`${root}/.env`, 'NODE_EXTRA_CA_CERTS=second.pem\n'); assert.equal(developmentEnvironment(root, original).NODE_EXTRA_CA_CERTS, 'second.pem');
  await rm(`${root}/.env`); assert.deepEqual(developmentEnvironment(root, original), original);
});

test('recoverable failure waits without respawning and a corrected edit resets failure only after readiness', async () => {
  const f = fixture(); await f.supervisor.start(); f.children[0].close(1); assert.equal(f.supervisor.getState().phase, 'waiting-for-change');
  await f.supervisor.poll(); assert.equal(f.children.length, 1); f.change(); await f.supervisor.poll(); f.clock.fire(100); assert.equal(f.children.length, 2); assert.equal(f.supervisor.getState().lastFailure, 1);
  f.children[1].ready(); assert.equal(f.supervisor.getState().lastFailure, 0); const stopped = f.supervisor.stop(); f.children[1].stopped(); f.children[1].close(); assert.equal((await stopped).code, 0); assert.equal(f.clock.timers.size, 0);
});

test('a corrected edit observed before failed startup exit is retried once, not lost or duplicated', async () => {
  const f = fixture(); await f.supervisor.start(); f.change(); await f.supervisor.poll(); f.children[0].close(1); assert.equal(f.children.length, 2); await f.supervisor.poll(); assert.equal(f.children.length, 2);
  f.children[1].ready(); const stopped = f.supervisor.stop(); f.children[1].stopped(); f.children[1].close(); await stopped;
});

test('save bursts and changes during restart never overlap children or schedule a duplicate restart', async () => {
  const f = fixture(); await f.supervisor.start(); f.children[0].ready(); f.change(); await f.supervisor.poll(); f.clock.fire(100); assert.equal(f.children[0].messages.length, 1); assert.equal(f.children.length, 1);
  f.change('src/server.js', 'three'); await f.supervisor.poll(); f.children[0].stopped(); f.children[0].close(); assert.equal(f.children.length, 2); assert.equal([...f.clock.timers.values()].filter((timer) => timer.ms === 100).length, 0);
  const stopped = f.supervisor.stop(); f.children[1].stopped(); f.children[1].close(); await stopped; assert.equal(f.children.length, 2);
});

test('final stop while waiting preserves the last unrecovered application failure', async () => {
  const f = fixture(); await f.supervisor.start(); f.children[0].close(1); assert.equal((await f.supervisor.stop()).code, 1); assert.equal(f.clock.timers.size, 0);
});

test('shutdown during a pending baseline or scan cannot launch a child or restart after stop', async () => {
  const baseline = deferred(); const f = fixture({ scan: () => baseline.promise }); const starting = f.supervisor.start(); await f.supervisor.stop(); baseline.resolve(new Map()); await starting; assert.equal(f.children.length, 0);
  const scan = deferred(); let reads = 0; const g = fixture({ scan: async () => ++reads === 1 ? new Map() : scan.promise }); await g.supervisor.start(); const polling = g.supervisor.poll(); const stopped = g.supervisor.stop(); g.children[0].stopped(); g.children[0].close(); scan.resolve(new Map([['src/new.js', 'new']])); await polling; await stopped; assert.equal(g.children.length, 1); assert.equal(g.clock.timers.size, 0);
});

test('a startup stop queues its IPC command until the child control handler is ready', async () => {
  const f = fixture(); await f.supervisor.start(); const stopped = f.supervisor.stop(); assert.equal(f.children[0].messages.length, 0);
  f.children[0].emit('message', { type: 'dashboard:control-ready' }); assert.deepEqual(f.children[0].messages, [{ type: 'dashboard:shutdown' }]); f.children[0].stopped(); f.children[0].close(); assert.equal((await stopped).code, 0); assert.equal(f.children.length, 1);
});

test('terminal interruption before the child control handshake is an intentional stop, not a native crash', async () => {
  const f = fixture(); await f.supervisor.start(); const stopped = f.supervisor.stop(); f.children[0].close(null, 'SIGINT'); assert.deepEqual(await stopped, { code: 0, cleanupSafe: true }); assert.equal(f.children.length, 1);
});

test('an unreadable env file waits for a corrected edit without spawning or modifying original environment', async () => {
  let broken = true; const f = fixture({ childEnvironment: (_root, environment) => { if (broken) throw new Error('EACCES'); return { ...environment }; } }); await f.supervisor.start(); assert.equal(f.children.length, 0); assert.equal(f.supervisor.getState().lastFailure, 1);
  broken = false; f.change('.env', 'fixed'); await f.supervisor.poll(); f.clock.fire(100); assert.equal(f.children.length, 1); f.children[0].ready(); const stopped = f.supervisor.stop(); f.children[0].stopped(); f.children[0].close(); assert.equal((await stopped).code, 0);
});

test('cleanup failure or live nested preparation ends recovery rather than authorizing a replacement', async () => {
  for (const preparation of [false, true]) {
    const f = fixture(); await f.supervisor.start(); f.children[0].ready();
    if (preparation) f.children[0].emit('message', { type: 'dashboard:preparation', pending: 1 });
    f.change(); await f.supervisor.poll(); f.clock.fire(100); f.children[0].stopped(preparation, preparation ? null : 'cleanup'); f.children[0].close(1); assert.equal((await f.supervisor.done).code, 1); assert.equal(f.children.length, 1);
  }
});

test('IPC send errors and unconfirmed exit deadlines remain nonzero without kill calls or replacement', async () => {
  const f = fixture({ applicationTimeoutMs: 30, shutdownMarginMs: 5 }); await f.supervisor.start(); const child = f.children[0]; child.ready(); child.sendError = new Error('closed channel'); const stopped = f.supervisor.stop();
  assert.equal(child.connected, false); f.clock.fire(35); assert.deepEqual(await stopped, { code: 1, cleanupSafe: false }); assert.deepEqual(child.kills, []); assert.equal(f.children.length, 1); child.close();
});

test('spawn errors are observed, budget changes require relaunch and wait derives from shared constants', async () => {
  assert.equal(SUPERVISOR_SHUTDOWN_TIMEOUT_MS, APPLICATION_SHUTDOWN_TIMEOUT_MS + SUPERVISOR_SHUTDOWN_MARGIN_MS);
  const f = fixture(); await f.supervisor.start(); assert.equal(f.supervisor.getState().waitMs, SUPERVISOR_SHUTDOWN_TIMEOUT_MS); f.children[0].emit('error', Object.assign(new Error('denied'), { code: 'EACCES' })); f.children[0].close(1); assert.equal((await f.supervisor.done).code, 1);
  const g = fixture(); await g.supervisor.start(); g.change('src/lifecycle-constants.js', 'new budget'); await g.supervisor.poll(); g.children[0].stopped(); g.children[0].close(); assert.equal((await g.supervisor.done).code, 1); assert.match(g.messages[0], /Relaunch/); assert.equal(g.children.length, 1);
});

test('poll errors stop observation honestly and a final stop can join an already requested reload', async () => {
  let reads = 0; const f = fixture({ scan: async () => { if (++reads > 1) throw new Error('EACCES'); return new Map(); } }); await f.supervisor.start(); await f.supervisor.poll(); f.children[0].stopped(); f.children[0].close(); assert.equal((await f.supervisor.done).code, 1);
  const g = fixture(); await g.supervisor.start(); g.change(); await g.supervisor.poll(); g.clock.fire(100); const stopped = g.supervisor.stop(); g.children[0].stopped(); g.children[0].close(); await stopped; await tick(); assert.equal(g.children.length, 1); assert.equal(g.clock.timers.size, 0);
});
