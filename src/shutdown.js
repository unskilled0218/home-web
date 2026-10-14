import { APPLICATION_SHUTDOWN_TIMEOUT_MS, CONNECTION_SHUTDOWN_GRACE_MS } from './lifecycle-constants.js';

export function createShutdownCoordinator({ report = console.error, notify = () => {}, schedule = setTimeout, cancel = clearTimeout, timeoutMs = APPLICATION_SHUTDOWN_TIMEOUT_MS, graceMs = CONNECTION_SHUTDOWN_GRACE_MS } = {}) {
  const resources = {}; const preparations = new Map();
  let phase = 'startup'; let failure = null; let finished = false; let deadline; let shutdownPromise; let resolveShutdown;
  let resolveStartup; const startup = new Promise((resolve) => { resolveStartup = resolve; });
  let startupSettled = false; let httpDrain; let weatherDrain;
  const log = (message) => { try { report(message); } catch { /* Reporting cannot prevent cleanup. */ } };
  const send = (message) => { try { notify(message); } catch { /* Owner loss does not undo local cleanup. */ } };
  const preparationStatus = () => send({ type: 'dashboard:preparation', pending: preparations.size });
  function markFailure(kind, message) { if (kind === 'cleanup' || !failure) failure = kind; if (message) log(message); }
  function finish(forced = false) {
    if (finished) return;
    finished = true; phase = 'stopped'; cancel(deadline);
    resolveShutdown({ code: failure || forced ? 1 : 0, failure, forced, cleanupSafe: !forced && failure !== 'cleanup' && preparations.size === 0 });
  }
  function clean(label, work) {
    const failed = () => { markFailure('cleanup', `${label} shutdown failed.`); };
    try { return Promise.resolve(work()).catch(failed); } catch { failed(); return Promise.resolve(); }
  }
  function beginDrains() {
    if (resources.server && !httpDrain) httpDrain = clean('HTTP', () => resources.server.lifecycle.shutdown({ graceMs, schedule, cancel }));
    if (resources.weather && !weatherDrain) weatherDrain = clean('Weather', () => resources.weather.stop());
  }
  function stopPreparation(child, owner) {
    if (owner.stopping) return;
    owner.stopping = true;
    try { if (!child.kill('SIGTERM')) markFailure('cleanup', 'NFS preparation could not be terminated. Use disabled/pre-mounted NFS or allow ordinary owned-child signals.'); }
    catch { markFailure('cleanup', 'NFS preparation termination failed; cleanup remains unconfirmed.'); }
  }
  function shutdown() {
    if (shutdownPromise) return shutdownPromise;
    phase = 'stopping'; shutdownPromise = new Promise((resolve) => { resolveShutdown = resolve; });
    deadline = schedule(() => {
      markFailure('cleanup', 'Dashboard shutdown exceeded its deadline; forcing process exit.');
      if (preparations.size) log('NFS preparation children remain live or unconfirmed. Cleanup requires operator assistance; no replacement is safe.');
      finish(true);
    }, timeoutMs);
    beginDrains(); for (const [child, owner] of preparations) stopPreparation(child, owner);
    void (async () => {
      await startup; beginDrains();
      await Promise.all([httpDrain, weatherDrain, ...[...preparations.values()].map((owner) => owner.exited)]);
      if (finished) return;
      if (resources.homeAssistant) await clean('Home Assistant transport', () => resources.homeAssistant.dispose());
      if (finished) return;
      if (failure !== 'cleanup') { try { resources.store?.close(); } catch { markFailure('cleanup', 'SQLite closure failed.'); } }
      finish();
    })().catch(() => { markFailure('cleanup', 'Dashboard cleanup failed.'); finish(); });
    return shutdownPromise;
  }
  return {
    getState: () => ({ phase, failure, pendingPreparations: preparations.size }),
    get stopping() { return phase === 'stopping' || phase === 'stopped'; },
    attach(name, resource) { resources[name] = resource; if (phase === 'stopping') beginDrains(); },
    startupFinished() { if (startupSettled) return; startupSettled = true; if (phase === 'startup') phase = 'running'; resolveStartup(); },
    fail(error) { markFailure('application', `Dashboard startup failed: ${String(error?.message ?? error).slice(0, 500)}`); return shutdown(); },
    ownPreparation(child) {
      if (!child) { markFailure('cleanup', 'NFS preparation ownership is unavailable.'); return; }
      let resolveExit; const owner = { exited: new Promise((resolve) => { resolveExit = resolve; }), stopping: false };
      preparations.set(child, owner); preparationStatus();
      const exited = () => { if (!preparations.delete(child)) return; resolveExit(); preparationStatus(); };
      child.once('exit', exited);
      child.on('error', () => {
        if (!child.pid) exited();
        else if (preparations.has(child)) markFailure('cleanup', 'NFS preparation signal/ownership failure; its exit is not confirmed.');
      });
      if (child.exitCode !== null && child.exitCode !== undefined || child.signalCode) exited();
      if (phase === 'stopping' && preparations.has(child)) stopPreparation(child, owner);
    },
    shutdown
  };
}
