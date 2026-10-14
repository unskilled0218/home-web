import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { APPLICATION_SHUTDOWN_TIMEOUT_MS, SUPERVISOR_SHUTDOWN_MARGIN_MS } from '../src/lifecycle-constants.js';

export const DEVELOPMENT_POLL_MS = 500;
export const DEVELOPMENT_SETTLE_MS = 100;
const budgetFile = 'src/lifecycle-constants.js';

// Resolve a fresh child-only environment: Node reads extra CA trust before --env-file takes effect on some releases.
export function developmentEnvironment(root, original) {
  let values = {};
  try { values = parseEnv(readFileSync(path.join(root, '.env'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { ...values, ...original };
}

export async function scanDevelopmentFiles(root) {
  const values = new Map();
  async function inspect(relative, optional = false) {
    try {
      const metadata = await stat(path.join(root, relative), { bigint: true });
      values.set(relative, `${metadata.mtimeNs}:${metadata.ctimeNs}:${metadata.size}`);
    } catch (error) { if (!optional || error.code !== 'ENOENT') throw error; }
  }
  async function directory(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries) {
      const file = path.join(relative, entry.name);
      if (entry.isDirectory()) await directory(file);
      else if (entry.isFile() && entry.name.endsWith('.js')) await inspect(file, true);
    }
  }
  await directory('src'); await directory('public'); await inspect('.env', true); await inspect('package.json');
  return new Map([...values].sort(([left], [right]) => left.localeCompare(right)));
}

export function createDevSupervisor({ root, environment = process.env, childEnvironment = developmentEnvironment, spawnImpl = spawn, scan = scanDevelopmentFiles, schedule = setTimeout, cancel = clearTimeout, report = console.error, onChange = () => {}, applicationTimeoutMs = APPLICATION_SHUTDOWN_TIMEOUT_MS, shutdownMarginMs = SUPERVISOR_SHUTDOWN_MARGIN_MS } = {}) {
  if (!(shutdownMarginMs > 0) || !(applicationTimeoutMs > 0)) throw new Error('Development shutdown budgets must be positive.');
  const waitMs = applicationTimeoutMs + shutdownMarginMs;
  let files; let revision = 0; let owner; let scanning; let pollTimer; let restartTimer; let stopping = false; let finished = false; let lastFailure = 0; let fatal = false; let phase = 'starting';
  let resolveDone; const done = new Promise((resolve) => { resolveDone = resolve; });
  const log = (message) => { try { report(message); } catch { /* Diagnostics do not own process lifetime. */ } };
  const state = () => ({ phase, pid: owner?.child?.pid ?? null, revision, lastFailure, stopping, waitMs });
  const emit = () => { if (!finished) onChange(state()); };
  function finish(cleanupSafe = true) {
    if (finished) return;
    finished = true; phase = 'stopped'; cancel(pollTimer); cancel(restartTimer);
    resolveDone({ code: fatal ? 1 : lastFailure, cleanupSafe });
  }
  function arm() {
    cancel(pollTimer); pollTimer = undefined;
    if (!stopping && !finished) pollTimer = schedule(() => { pollTimer = undefined; void poll(); }, DEVELOPMENT_POLL_MS);
  }
  function fatalStop(message) { fatal = true; log(message); return stop(); }
  function requestStop(current, intent) {
    if (current.intent) return;
    current.intent = intent; phase = stopping ? 'stopping' : 'restarting'; emit();
    current.deadline = schedule(() => {
      fatal = true; log('Development server did not exit within its shutdown budget. Cleanup is unconfirmed; allow owned-child termination or stop it from an authorized terminal.');
      if (current.child.connected) { try { current.child.disconnect(); } catch { /* Channel may already be closed. */ } }
      finish(false);
    }, waitMs);
    if (current.controlReady) sendShutdown(current);
  }
  function sendShutdown(current) {
    if (current.sent || current.closed) return;
    current.sent = true;
    if (!current.child.connected) { fatal = true; log('Development control channel is unavailable; cleanup must be confirmed before restarting.'); return; }
    try {
      current.child.send({ type: 'dashboard:shutdown' }, (error) => {
        if (!error || owner !== current || current.closed) return;
        fatal = true; log('Development shutdown IPC failed; no replacement will start.');
        void stop();
        if (current.child.connected) { try { current.child.disconnect(); } catch { /* Existing close owns completion. */ } }
      });
    } catch {
      fatal = true; log('Development shutdown IPC failed; no replacement will start.'); void stop();
      if (current.child.connected) { try { current.child.disconnect(); } catch { /* Existing close owns completion. */ } }
    }
  }
  function closed(current, code, signal) {
    current.closed = true; cancel(current.deadline);
    if (owner !== current || finished) return;
    owner = undefined;
    const earlyStop = stopping && !current.controlReady && ['SIGINT', 'SIGTERM'].includes(signal);
    if (earlyStop) code = 0;
    const unsafe = current.pendingPreparations > 0 || current.result?.cleanupSafe === false || current.spawnFailed || Boolean(signal) && !earlyStop;
    const badStop = current.intent && code !== 0 && current.result?.failure !== 'application' && current.ready;
    if (unsafe || badStop) { fatal = true; log('Development child cleanup failed or remains unconfirmed; no replacement is safe.'); }
    if (code !== 0) lastFailure = Number.isInteger(code) && code > 0 ? code : 1;
    if (stopping || fatal) { finish(!unsafe && !badStop); return; }
    if (current.intent === 'restart' && code === 0) { launch(); return; }
    phase = 'waiting-for-change'; log(code ? 'Application failed. Waiting for a new source/configuration edit before retrying.' : 'Application stopped. Waiting for a new source/configuration edit.'); emit();
    if (revision > current.revision) launch();
  }
  function launch() {
    if (stopping || finished || owner) return;
    cancel(restartTimer); restartTimer = undefined;
    const current = { revision, ready: false, controlReady: false, sent: false, intent: null, pendingPreparations: 0, result: null, closed: false, spawnFailed: false }; owner = current; phase = 'starting';
    let resolvedEnvironment;
    try { resolvedEnvironment = childEnvironment(root, environment); }
    catch { owner = undefined; lastFailure = 1; phase = 'waiting-for-change'; log('Development env file could not be loaded. Waiting for a new source/configuration edit.'); emit(); return; }
    try {
      current.child = spawnImpl(process.execPath, ['--env-file-if-exists=.env', path.join(root, 'src/server.js')], { cwd: root, env: resolvedEnvironment, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    } catch { owner = undefined; void fatalStop('Development server could not be spawned.'); return; }
    current.child.on('error', () => { current.spawnFailed = true; void fatalStop('Development child process operation failed; cleanup is not assumed complete.'); });
    current.child.on('message', (message) => {
      if (owner !== current || finished) return;
      if (message?.type === 'dashboard:control-ready') { current.controlReady = true; if (current.intent) sendShutdown(current); }
      else if (message?.type === 'dashboard:ready' && !current.intent && !stopping) { current.ready = true; lastFailure = 0; phase = 'running'; emit(); }
      else if (message?.type === 'dashboard:preparation' && Number.isSafeInteger(message.pending) && message.pending >= 0) current.pendingPreparations = message.pending;
      else if (message?.type === 'dashboard:stopped' && typeof message.cleanupSafe === 'boolean') current.result = message;
    });
    current.child.once('close', (code, signal) => closed(current, code, signal)); emit();
  }
  function restart() {
    restartTimer = undefined;
    if (stopping || finished) return;
    if (owner) requestStop(owner, 'restart'); else launch();
  }
  async function poll() {
    if (stopping || finished || scanning) return;
    scanning = (async () => {
      try {
        const next = await scan(root);
        if (stopping || finished) return;
        if (files.get(budgetFile) !== next.get(budgetFile)) { void fatalStop('Lifecycle budgets changed. Relaunch the development supervisor to load matching parent/child budgets.'); return; }
        if (JSON.stringify([...files]) !== JSON.stringify([...next])) {
          files = next; revision++; cancel(restartTimer); restartTimer = schedule(restart, DEVELOPMENT_SETTLE_MS); emit();
        }
      } catch { void fatalStop('Development file polling failed. Check source-directory permissions.'); }
      finally { scanning = undefined; arm(); }
    })();
    await scanning;
  }
  function stop() {
    if (finished) return done;
    stopping = true; phase = 'stopping'; cancel(pollTimer); cancel(restartTimer); emit();
    if (owner) requestStop(owner, 'stop'); else finish();
    return done;
  }
  return {
    getState: state, done, stop, poll,
    async start() {
      try { files = await scan(root); if (!stopping && !finished) { launch(); arm(); } }
      catch { void fatalStop('Development file baseline failed. Check the project-root source paths and permissions.'); }
      return state();
    }
  };
}
