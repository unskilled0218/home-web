import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';
import { fixtureHosts } from './weather-network.js';
import { within } from './lifecycle.js';

// The fixture is inert when Node's test discovery imports helper files.
if (process.env.WEATHER_NETWORK_CASE) {
  const config = JSON.parse(process.env.WEATHER_NETWORK_CASE); const connections = [];
  const deadline = setTimeout(() => { console.error('Weather fixture child exceeded its deadline.'); process.exit(2); }, 12000);
  const send = value => process.send(value);
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    const permitted = hostname === 'localhost' || (fixtureHosts.includes(hostname) && !config.denyTargetLookup);
    queueMicrotask(() => permitted ? (options?.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4)) : callback(Object.assign(new Error('Fixture refuses external DNS'), { code: 'ENOTFOUND' })));
  };
  for (const [module, method] of [[net, 'connect'], [tls, 'connect']]) {
    const original = module[method];
    module[method] = function (options, ...args) { connections.push({ tls: module === tls, autoSelectFamily: options.autoSelectFamily, attemptTimeout: options.autoSelectFamilyAttemptTimeout }); return original.call(this, options, ...args); };
  }
  const { createWeatherTransport } = await import('../../src/weather-provider.js');
  let service; let external; let store; let closed = false; let stopped = false; let callerDisposals = 0; let poolDisposals = 0;
  const defaultTimeout = net.getDefaultAutoSelectFamilyAttemptTimeout();
  async function finish() {
    await service?.stop(); await external?.stop(); if (store && !closed) store.close(); clearTimeout(deadline); process.disconnect();
  }
  process.on('message', message => {
    void (async () => {
      if (message.type === 'exit') await finish();
      else if (message.type === 'stop') {
        const { createShutdownCoordinator } = await import('../../src/shutdown.js');
        const owner = createShutdownCoordinator({ report: message => { throw new Error(message); } });
        let snapshot;
        owner.attach(config.mode === 'global' ? 'weather' : 'localWeather', { async stop() { await Promise.all([service.stop(), service.stop()]); stopped = true; } });
        owner.attach('store', { close() { assert.equal(stopped, true); assert.ok(external ? poolDisposals === 0 : poolDisposals > 0, 'owned pool disposal must settle before store cleanup'); if (config.mode === 'global') snapshot = service.snapshot(); store.close(); closed = true; } });
        owner.startupFinished(); const result = await within(owner.shutdown(), 3000);
        assert.equal(result.cleanupSafe, true); assert.equal(result.code, 0);
        if (config.mode === 'local') assert.throws(() => service.query(config.location, 'UTC'), /unavailable/);
        let callerStillWorks;
        if (external) { const response = await external.fetch(config.url, { signal: AbortSignal.timeout(2000) }); callerStillWorks = (await response.json()).current.us_aqi; }
        send({ type: 'stopped', stopped, closed, snapshot, callerStillWorks, callerDisposals, poolDisposals });
      } else if (message.type === 'dispose-external') { await external.stop(); send({ type: 'external-disposed' }); }
    })().catch(error => { console.error(error); process.exitCode = 1; void finish(); });
  });
  if (config.kind === 'fetch') {
    let transport;
    try {
      transport = config.native ? null : createWeatherTransport();
      const response = await (transport?.fetch ?? fetch)(config.url, { signal: AbortSignal.timeout(2500) });
      const data = await response.json();
      send({ type: 'result', ok: true, data, connections, defaultUnchanged: defaultTimeout === net.getDefaultAutoSelectFamilyAttemptTimeout(), proxyEnabled: Boolean(http.globalAgent.options?.proxyEnv) });
    } catch (error) { send({ type: 'result', ok: false, code: error.cause?.code ?? error.code, message: error.message }); }
    finally { await transport?.stop(); }
  } else {
    const { EnvHttpProxyAgent } = await import('undici');
    const destroy = EnvHttpProxyAgent.prototype.destroy;
    // Observe completion of the public dispatcher API without replacing actual destruction.
    EnvHttpProxyAgent.prototype.destroy = async function (...args) { const result = await destroy.apply(this, args); poolDisposals++; return result; };
    const { createStore } = await import('../../src/db.js');
    store = createStore(':memory:'); store.saveWeatherLocation(config.location, 0);
    if (config.injected) external = createWeatherTransport();
    const callerFetch = (...args) => external.fetch(...args);
    callerFetch.stop = callerFetch.dispose = () => { callerDisposals++; };
    const options = external ? { fetchImpl: callerFetch } : {};
    const { createWeatherService } = await import('../../src/weather.js');
    const { createLocalWeatherService } = await import('../../src/local-weather.js');
    service = config.mode === 'global' ? createWeatherService({ store, ...options }) : createLocalWeatherService(options);
    service.start(); send({ type: 'started' });
    const snapshot = () => config.mode === 'global' ? service.snapshot() : service.query(config.location, 'UTC');
    snapshot();
    if (!config.pending) {
      await within((async () => { while (!stopped) { const state = snapshot(); if (!state.refreshing) { assert.deepEqual(state.air, { aqi: 91 }); send({ type: 'ready', snapshot: state }); return; } await new Promise(resolve => setTimeout(resolve, 10)); } })(), 5000);
    }
  }
}
