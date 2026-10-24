// Opt-in packaging check: never uses the working install or user configuration/storage.
import { mkdtemp, cp, access, rm } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import { temporaryPrefix } from './temporary.js';

const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(temporaryPrefix('production-runtime-'));
const execute = promisify(execFile);
const trustKeys = ['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS'];
const environment = { ...Object.fromEntries(trustKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), HOME: directory, NPM_CONFIG_USERCONFIG: path.join(directory, 'npmrc'), NPM_CONFIG_CACHE: path.join(directory, 'npm-cache') };
let child; let exited; let installation; let cleanupSafe = true;
function bounded(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Production smoke deadline exceeded; cleanup must be confirmed.')), ms); })]).finally(() => clearTimeout(timer));
}
try {
  for (const item of ['package.json', 'package-lock.json', 'src', 'public']) await cp(path.join(root, item), path.join(directory, item), { recursive: true });
  installation = execute('npm', ['ci', '--omit=dev', '--ignore-scripts', '--fetch-retries=0', '--fetch-timeout=10000'], { cwd: directory, env: environment, timeout: 60000, maxBuffer: 128000 });
  await installation;
  for (const item of ['@playwright/test', 'playwright', 'playwright-core']) {
    try { await access(path.join(directory, 'node_modules', item)); throw new Error(`Unexpected production development package: ${item}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const reservation = net.createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening'); const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const source = `const resolved = import.meta.resolve('undici'); if (!resolved.startsWith(${JSON.stringify('file://' + directory + '/node_modules/')})) throw new Error('Undici escaped production tree'); await import('undici'); console.log('production-dependency-ok'); await import('./src/server.js');`;
  child = spawn(process.execPath, ['--input-type=module', '--eval', source], { cwd: directory, env: { ...environment, HOST: '127.0.0.1', PORT: String(port), NFS_MOUNT_MODE: 'off' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  exited = once(child, 'exit'); let dependency = false; let error = '';
  child.stdout.on('data', chunk => { if (chunk.toString().includes('production-dependency-ok')) dependency = true; }); child.stderr.on('data', chunk => { error += chunk; });
  const ready = new Promise(resolve => child.on('message', message => { if (message.type === 'dashboard:ready') resolve(true); }));
  const started = await bounded(Promise.race([ready, exited.then(() => false)]), 10000);
  if (!started || !dependency) throw new Error(`Production runtime failed before readiness: ${error}`);
  const response = await fetch(`http://127.0.0.1:${port}/api/dashboard/settings`, { signal: AbortSignal.timeout(3000) });
  if (response.status !== 200) throw new Error(`Production HTTP check failed: ${response.status}`);
  await response.arrayBuffer();
  await access(path.join(directory, 'data/linkwarden-config-encryption.key'));
  child.send({ type: 'dashboard:shutdown' }); const [code] = await bounded(exited, 10000);
  if (code !== 0) throw new Error(`Production shutdown failed: ${code}`);
  console.log('Production-only install, local dependency resolution, readiness, HTTP, automatic key, and IPC shutdown passed. No built image was tested.');
} finally {
  if (installation?.child && installation.child.exitCode === null && installation.child.signalCode === null) { cleanupSafe = false; console.error(`Production installer exit unconfirmed; retained owned fixture ${directory}.`); }
  if (child && child.exitCode === null) {
    try { if (child.connected) child.send({ type: 'dashboard:shutdown' }); await bounded(exited, 10000); }
    catch { cleanupSafe = false; console.error(`Production child cleanup unconfirmed; retained owned fixture ${directory}.`); }
  }
  if (cleanupSafe) await rm(directory, { recursive: true, force: true });
}
