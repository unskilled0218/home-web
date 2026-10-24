import test from 'node:test';
import { temporaryPrefix } from '../scripts/temporary.js';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { cp, mkdtemp, readdir, stat, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import net from 'node:net';
import https from 'node:https';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { deferred } from './fixtures/lifecycle.js';
import { assertTerminalOutcome } from './fixtures/terminal-outcome.js';

const project = path.resolve(import.meta.dirname, '..'); const execute = promisify(execFile);
async function until(check, message, timeout = 5000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await new Promise((resolve) => setTimeout(resolve, 25)); } throw new Error(message); }
async function reservePort() { const server = net.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = server.address().port; await new Promise((resolve) => server.close(resolve)); return port; }
async function fixture(t) {
  const root = await mkdtemp(temporaryPrefix('shutdown-process-'));
  t.after(async () => {
    const records = await terminalRecords(root);
    for (const record of records) {
      await until(async () => { try { await stat(`/proc/${record.pid}`); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }, `Owned PID ${record.pid} still exists; retained ${root}.`, 15000);
    }
    await rm(root, { recursive: true, force: true });
  });
  for (const directory of ['src', 'public', 'scripts']) await cp(path.join(project, directory), path.join(root, directory), { recursive: true });
  await symlink(path.join(project, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  await cp(path.join(project, 'package.json'), path.join(root, 'package.json')); const port = await reservePort();
  const environment = { ...process.env }; for (const name of ['HOST', 'PORT', 'DATABASE_PATH', 'NFS_SOURCE', 'NFS_MOUNT_MODE', 'NFS_MOUNT_PATH', 'NFS_MOUNT_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE', 'HOME_ASSISTANT_CA_FILE', 'LINKWARDEN_CA_FILE', 'CALDAV_CA_FILE', 'TERMINAL_EVIDENCE_DIR']) delete environment[name];
  environment.LINKWARDEN_CONFIG_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');
  const marker = path.join(root, 'process-marker.mjs'); await writeFile(marker, `console.log('fixture-pid:' + process.pid); const timer = setTimeout(() => { if (!process.emit('SIGTERM')) process.exit(0); }, 12000); process.on('exit', () => clearTimeout(timer));`);
  environment.NODE_OPTIONS = `${environment.NODE_OPTIONS ?? ''} --import=${marker}`.trim();
  const env = (extra = '') => `HOST=127.0.0.1\nPORT=${port}\nDATABASE_PATH=${root}/dashboard.db\nNFS_MOUNT_MODE=off\n${extra}`;
  await writeFile(path.join(root, '.env'), env());
  return { root, port, environment, env };
}
async function launch(t, fixture, dev = false) {
  const entry = dev ? 'scripts/dev.js' : 'src/server.js';
  const child = spawn(process.execPath, [...(dev ? [] : ['--env-file-if-exists=.env']), path.join(fixture.root, entry)], { cwd: fixture.root, env: fixture.environment, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const exited = deferred(); let output = ''; let error = ''; const messages = [];
  const outputClosed = Promise.all([once(child.stdout, 'end'), once(child.stderr, 'end')]);
  child.on('error', (failure) => { error += failure.message; }); child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { error += chunk; }); child.on('message', (message) => messages.push(message)); child.once('exit', (code, signal) => { void outputClosed.then(() => exited.resolve({ code, signal })); });
  const result = { child, exited: exited.promise, messages, get output() { return output; }, get error() { return error; } };
  t.after(async () => { if (child.exitCode === null && child.signalCode === null && child.connected) child.send({ type: 'dashboard:shutdown' }, () => {}); await exited.promise; });
  return result;
}
async function assertStopped(fixture, run) {
  const result = await run.exited; assert.equal(result.code, 0, run.error); assert.equal(result.signal, null); assert.doesNotMatch(run.error, /Assertion failed|Segmentation fault|core dumped|EACCES/);
  await assertPortFree(fixture.port); await assertPidsGone(run.output); assert.equal((await readdir(fixture.root)).some((name) => /^core(?:\.|$)/.test(name)), false);
}
async function assertPortFree(port) { const server = net.createServer(); server.listen(port, '127.0.0.1'); await once(server, 'listening'); await new Promise((resolve) => server.close(resolve)); }
async function assertPidsGone(output) {
  const pids = [...output.matchAll(/fixture-pid:(\d+)/g)].map((match) => Number(match[1]));
  for (const pid of pids) await until(async () => { try { await stat(`/proc/${pid}`); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }, `owned process ${pid} still exists`);
}

async function terminalRecords(root) {
  const names = await readdir(root);
  return Promise.all(names.filter(name => /^\d+\.json$/.test(name)).map(async name => JSON.parse(await readFile(path.join(root, name), 'utf8'))));
}

for (const dev of [false, true]) test(`${dev ? 'development' : 'normal'} launch shuts down through IPC with no owned process or occupied port`, async (t) => {
  const f = await fixture(t); const run = await launch(t, f, dev); await until(() => run.output.includes('dashboard listening at'), run.error || 'No ready output'); run.child.send({ type: 'dashboard:shutdown' }, () => {}); run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run);
});

for (const dev of [false, true]) for (const mode of ['off', 'on']) test(`${dev ? 'development' : 'normal'} NFS ${mode} reports ${mode === 'on' ? 'enabled but unavailable' : 'disabled'} and shuts down cleanly`, async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, '.env'), f.env(`NFS_MOUNT_MODE=${mode}\nNFS_SOURCE=${mode === 'off' ? 'nas:/photos' : ''}\nNFS_MOUNT_PATH=${f.root}\n`));
  const run = await launch(t, f, dev); await until(() => run.output.includes('dashboard listening at'), 'NFS configuration prevented readiness');
  for (const endpoint of ['photos/status', 'photos/local', 'slideshow']) {
    const response = await fetch(`http://127.0.0.1:${f.port}/api/dashboard/${endpoint}`);
    assert.equal(response.status, 200, endpoint);
    const snapshot = await response.json();
    assert.equal(snapshot.enabled, mode === 'on', `${endpoint}: enabled state`);
    assert.equal(snapshot.available, false, `${endpoint}: unavailable inventory`);
  }
  const settings = await fetch(`http://127.0.0.1:${f.port}/api/dashboard/settings`); assert.equal(settings.status, 200); await settings.arrayBuffer();
  if (mode === 'on') assert.match(run.error, /NFS backgrounds are unavailable/);
  else assert.doesNotMatch(run.error, /NFS backgrounds are unavailable/);
  run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run);
});

for (const dev of [false, true]) test(`${dev ? 'development' : 'normal'} production owner rotates before the first HTTP read and drains its timers`, async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.root, 'first.png'), 'first'); await writeFile(path.join(f.root, 'second.png'), 'second');
  await writeFile(path.join(f.root, 'src/nfs.js'), `export async function prepareNfs() { return { available: true, root: ${JSON.stringify(f.root)}, reason: 'existing' }; }`);
  await writeFile(path.join(f.root, '.env'), f.env(`NFS_MOUNT_MODE=on\nNFS_MOUNT_PATH=${f.root}\n`));
  const file = path.join(f.root, 'src/server.js'); const source = await readFile(file, 'utf8');
  await writeFile(file, source.replace('createPhotoSlideshow({ photoLibrary,', "createPhotoSlideshow({ schedule: (fn, ms) => setTimeout(() => { fn(); if (ms === 5000) console.log('fixture-rotation'); }, ms === 5000 ? 20 : ms), photoLibrary,").replace('void slideshow.start();', "slideshow.configure({ order: 'name', interval: 5 }); void slideshow.start();"));
  const run = await launch(t, f, dev); await until(() => (run.output.match(/fixture-rotation/g) ?? []).length >= 2, 'No background rotations before first browser request');
  const snapshot = await (await fetch(`http://127.0.0.1:${f.port}/api/dashboard/slideshow`)).json(); assert.equal(snapshot.count, 2); assert.ok(snapshot.revision >= 3);
  run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run);
});

for (const dev of [false, true]) test(`${dev ? 'development' : 'normal'} owner IPC disconnect also closes its server and descendants`, async (t) => {
  const f = await fixture(t); const run = await launch(t, f, dev); await until(() => run.output.includes('dashboard listening at'), 'No ready output'); run.child.disconnect(); await assertStopped(f, run);
});

test('development reload uses a new child, recovers syntax errors, and reloads env/TLS without pinning values', async (t) => {
  const f = await fixture(t); const run = await launch(t, f, true); const readyCount = () => (run.output.match(/dashboard listening at/g) ?? []).length;
  await until(() => readyCount() === 1, 'Initial server did not start');
  const sourceFile = path.join(f.root, 'src/server.js'); const source = await readFile(sourceFile, 'utf8'); await writeFile(sourceFile, 'this is not valid JavaScript!');
  await until(() => run.error.includes('Waiting for a new'), 'Supervisor did not retain edit recovery'); const failures = (run.output.match(/fixture-pid:/g) ?? []).length; await new Promise((resolve) => setTimeout(resolve, 1100)); assert.equal((run.output.match(/fixture-pid:/g) ?? []).length, failures, 'unchanged broken source must not respawn');
  await writeFile(sourceFile, source); await until(() => readyCount() === 2, 'Corrected source did not recover');
  const ca = path.join(f.root, 'private-ca.pem'); await writeFile(ca, rootCertificates[0]); await writeFile(path.join(f.root, '.env'), f.env(`NODE_EXTRA_CA_CERTS=${ca}\n`)); await until(() => readyCount() === 3, 'Env/TLS edit did not reload');
  await writeFile(path.join(f.root, '.env'), f.env().replace(/^PORT=.*$/m, 'PORT=invalid')); await until(() => (run.error.match(/Waiting for a new/g) ?? []).length === 2, 'Invalid env did not wait for correction'); await writeFile(path.join(f.root, '.env'), f.env()); await until(() => readyCount() === 4, 'Corrected env did not recover');
  run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run); assert.ok((run.output.match(/fixture-pid:/g) ?? []).length >= 5);
});

test('development env reload changes actual startup CA trust before the server imports without changing parent overrides', async (t) => {
  const f = await fixture(t); const key = path.join(f.root, 'tls.key'); const certificate = path.join(f.root, 'tls.pem');
  await execute('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE']);
  const provider = https.createServer({ key: await readFile(key), cert: await readFile(certificate) }, (_request, response) => response.end('trusted'));
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening'); t.after(() => new Promise((resolve) => { provider.close(resolve); provider.closeAllConnections(); }));
  const url = `https://127.0.0.1:${provider.address().port}/`;
  await writeFile(path.join(f.root, 'process-marker.mjs'), `console.log('fixture-pid:'+process.pid);setTimeout(()=>{if(!process.emit('SIGTERM'))process.exit(0)},12000);if(process.env.TEST_TLS_URL){const https=await import('node:https');const trusted=await new Promise(resolve=>{const request=https.get(process.env.TEST_TLS_URL,response=>{response.resume();response.on('end',()=>resolve(true))});request.on('error',error=>{console.log('fixture-tls-error:'+error.code);resolve(false)});request.setTimeout(1000,()=>request.destroy())});console.log('fixture-ca:'+process.env.NODE_EXTRA_CA_CERTS);console.log('fixture-trust:'+trusted)}`);
  await writeFile(path.join(f.root, '.env'), f.env(`TEST_TLS_URL=${url}\n`)); const run = await launch(t, f, true); const readyCount = () => (run.output.match(/dashboard listening at/g) ?? []).length;
  await until(() => readyCount() === 1, 'Untrusted child did not start'); assert.match(run.output, /fixture-trust:false/);
  await writeFile(path.join(f.root, '.env'), f.env(`TEST_TLS_URL=${url}\nNODE_EXTRA_CA_CERTS=${certificate}\n`)); await until(() => readyCount() === 2, 'CA change did not restart'); assert.match(run.output, /fixture-trust:true/);
  await writeFile(path.join(f.root, '.env'), f.env(`TEST_TLS_URL=${url}\n`)); await until(() => readyCount() === 3, 'CA removal did not restart'); assert.equal((run.output.match(/fixture-trust:false/g) ?? []).length, 2);
  run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run);
});

test('development honors explicit environment precedence and optional missing env files after reload', async (t) => {
  const f = await fixture(t); Object.assign(f.environment, { HOST: '127.0.0.1', PORT: String(f.port), DATABASE_PATH: `${f.root}/dashboard.db`, NFS_MOUNT_MODE: 'off' });
  await writeFile(path.join(f.root, '.env'), f.env().replace(/^PORT=.*$/m, 'PORT=1')); const run = await launch(t, f, true); const readyCount = () => (run.output.match(/dashboard listening at/g) ?? []).length;
  await until(() => readyCount() === 1, 'Environment override was not honored'); assert.match(run.output, new RegExp(`127\\.0\\.0\\.1:${f.port}`));
  await rm(path.join(f.root, '.env')); await until(() => readyCount() === 2, 'Removing optional env file did not restart'); assert.equal((run.output.match(new RegExp(`127\\.0\\.0\\.1:${f.port}`, 'g')) ?? []).length, 2);
  run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run);
});

test('stopping during cold startup prevents later listening and listener errors preserve failure status', async (t) => {
  const f = await fixture(t); const file = path.join(f.root, 'src/server.js'); const source = await readFile(file, 'utf8'); await writeFile(file, source.replace('async function boot() {', 'async function boot() { await new Promise(resolve => setTimeout(resolve, 200));'));
  const run = await launch(t, f); await until(() => run.messages.some((message) => message.type === 'dashboard:control-ready'), 'No control handshake'); run.child.send({ type: 'dashboard:shutdown' }, () => {}); await assertStopped(f, run); assert.doesNotMatch(run.output, /dashboard listening at/);
  const busy = net.createServer(); busy.listen(f.port, '127.0.0.1'); await once(busy, 'listening'); t.after(() => new Promise((resolve) => busy.close(resolve)));
  const failed = await launch(t, f); assert.equal((await failed.exited).code, 1); assert.match(failed.error, /EADDRINUSE/);
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`real ${signal} delivery is explicitly capability-checked`, async (t) => {
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `process.on('${signal}',()=>process.exit(0)); process.on('message',()=>process.exit(0)); process.on('disconnect',()=>process.exit(0));setTimeout(()=>process.exit(0),1000);process.send('ready');`], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const exited = new Promise((resolve) => child.once('close', resolve)); let denied; child.on('error', (error) => { denied = error.code; if (child.connected) child.send('stop', () => {}); }); await once(child, 'message'); const delivered = child.kill(signal); await exited;
  if (!delivered) { t.skip(`OS signal delivery is unavailable (${denied}); IPC and terminal delivery are tested separately.`); return; }
  const f = await fixture(t); const run = await launch(t, f); await until(() => run.output.includes('dashboard listening at'), 'No ready output'); assert.equal(run.child.kill(signal), true); await assertStopped(f, run);
});

for (const { mode, failCleanup } of [{ mode: 'development' }, { mode: 'npm' }, { mode: 'npm', failCleanup: true }]) test(failCleanup ? 'npm terminal interruption cannot hide a real application cleanup failure' : `terminal Ctrl+C stops the ${mode} launch without native watch teardown`, { timeout: 75000 }, async (t) => {
  try { await execute('python3', ['-c', 'import pty']); } catch { t.skip('Terminal verification requires an installed Python 3 with pty support.'); return; }
  const f = await fixture(t); const command = mode === 'npm' ? ['npm', 'run', 'dev'] : [process.execPath, 'scripts/dev.js'];
  await cp(path.join(project, 'test/fixtures/terminal-marker.mjs'), path.join(f.root, 'process-marker.mjs'));
  f.environment.TERMINAL_EVIDENCE_DIR = f.root;
  if (failCleanup) {
    const file = path.join(f.root, 'src/server.js');
    const source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('weather.start();', "const closeStore = store.close; store.close = () => { closeStore(); throw new Error('fixture cleanup failure'); }; weather.start();"));
  }
  const { stdout } = await execute('python3', [path.join(project, 'test/fixtures/terminal-shutdown.py'), JSON.stringify({ cwd: f.root, environment: f.environment, command })], { timeout: 55000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout); if (result.unsupported) { t.skip(`PTY unavailable: ${result.unsupported}`); return; }
  const records = await terminalRecords(f.root);
  let outcome;
  if (failCleanup) {
    assert.equal(result.sentCtrlC, true); assert.equal(result.drained, true); assert.equal(result.timedOut, false);
    assert.equal(records.find(record => record.role === 'dev.js')?.exitCode, 1, stdout);
    const server = records.find(record => record.role === 'server.js');
    assert.equal(server?.exitCode, 1, stdout);
    assert.deepEqual(server.stopped, { code: 1, cleanupSafe: false, forced: false, failure: 'cleanup' });
    assert.ok(records.every(record => !record.fallback), stdout);
    assert.throws(() => assertTerminalOutcome(mode, result, records), /AssertionError/);
    outcome = 'rejected-application-failure';
  } else outcome = assertTerminalOutcome(mode, result, records);
  const ownedPids = records.map(record => record.pid);
  if (mode === 'npm') ownedPids.push(records.find(record => record.role === 'dev.js').parent);
  await assertPortFree(f.port); await assertPidsGone(ownedPids.map(pid => `fixture-pid:${pid}`).join('\n'));
  assert.equal((await readdir(f.root)).some((name) => /^core(?:\.|$)/.test(name)), false);
  t.diagnostic(JSON.stringify({ outcome, code: result.code, signal: result.signal, records }));
  if (outcome === 'permission-limited') t.diagnostic('npm kill EACCES is an environment limitation, not silent npm success. Use node scripts/dev.js.');
});
