import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createWeatherTransport, providerJson } from '../src/weather-provider.js';
import { rawAir } from './fixtures/weather.js';
import { proxyRuntime, weatherClient, weatherNetwork } from './fixtures/weather-network.js';

test('weather transport gives dual-stack connections two seconds without changing process defaults', async t => {
  const defaultTimeout = net.getDefaultAutoSelectFamilyAttemptTimeout(); const connections = [];
  const connect = net.connect;
  t.mock.method(net, 'connect', function (options, ...args) { connections.push(options); return connect.call(this, options, ...args); });
  const server = http.createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(rawAir())); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const transport = createWeatherTransport();
  t.after(async () => { await transport.stop(); await new Promise(resolve => server.close(resolve)); });
  const data = await providerJson(new URL(`http://127.0.0.1:${server.address().port}/`), AbortSignal.timeout(10000), transport.fetch);
  assert.equal(data.current.us_aqi, 91);
  assert.equal(connections.length, 1);
  assert.equal(connections[0].autoSelectFamily, true);
  assert.equal(connections[0].autoSelectFamilyAttemptTimeout, 2000);
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), defaultTimeout);
});

test('weather transport still aborts a stalled response body and releases its socket', async t => {
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'Content-Type': 'application/json' }); response.flushHeaders(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const transport = createWeatherTransport(); const controller = new AbortController();
  t.after(async () => { controller.abort(); await transport.stop(); await new Promise(resolve => server.close(resolve)); });
  const response = await transport.fetch(`http://127.0.0.1:${server.address().port}/`, { signal: controller.signal });
  const body = response.text(); controller.abort();
  await assert.rejects(body, { name: 'AbortError' });
});

test('weather proxy opt-in matches native startup policy without enabling ambient proxy variables', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  const cases = [
    { name: 'proxy variables alone', enabled: false },
    { name: 'environment opt-in', env: { NODE_USE_ENV_PROXY: '1' }, enabled: true },
    { name: 'command-line opt-in', args: ['--use-env-proxy'], enabled: true },
    { name: 'NODE_OPTIONS opt-in', env: { NODE_OPTIONS: '--use-env-proxy' }, enabled: true },
    { name: 'command line disables environment opt-in', args: ['--no-use-env-proxy'], env: { NODE_USE_ENV_PROXY: '1' }, enabled: false },
    { name: 'command line disables NODE_OPTIONS opt-in', args: ['--no-use-env-proxy'], env: { NODE_OPTIONS: '--use-env-proxy' }, enabled: false }
  ];
  for (const scenario of cases) await t.test(scenario.name, async t => {
    for (const native of [true, false]) await t.test(native ? 'native' : 'weather', async t => {
      const before = network.requests.length;
      const client = weatherClient(t, { kind: 'fetch', native, url: network.httpUrl, denyTargetLookup: scenario.enabled }, { ca: network.cert, args: scenario.args, env: { HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpsProxy, ...scenario.env } });
      const result = await client.wait('result');
      assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.current.us_aqi, 91);
      assert.equal(result.proxyEnabled, scenario.enabled); assert.equal(result.defaultUnchanged, true);
      assert.equal(network.requests.length - before, scenario.enabled ? 1 : 0, `${native ? 'native' : 'weather'} routing`);
    });
  });
});

test('HTTP and HTTPS proxy selection and lowercase precedence match native fetch', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  for (const scenario of [
    { name: 'HTTP_PROXY', url: network.httpUrl, proxy: 'http-proxy' },
    { name: 'HTTPS_PROXY', url: network.httpsUrl, proxy: 'https-proxy' },
    { name: 'http_proxy overrides HTTP_PROXY', url: network.httpUrl, env: { http_proxy: network.httpsProxy }, proxy: 'https-proxy' },
    { name: 'https_proxy overrides HTTPS_PROXY', url: network.httpsUrl, env: { https_proxy: network.httpProxy }, proxy: 'http-proxy' }
  ]) await t.test(scenario.name, async t => {
    for (const native of [true, false]) await t.test(native ? 'native' : 'weather', async t => {
      const before = network.requests.length;
      const client = weatherClient(t, { kind: 'fetch', native, url: scenario.url, denyTargetLookup: true }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpsProxy, ...scenario.env } });
      const result = await client.wait('result'); assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(network.requests.length, before + 1); assert.equal(network.requests.at(-1).id, scenario.proxy);
      if (!native) { assert.ok(result.connections.length); for (const connection of result.connections) { assert.equal(connection.autoSelectFamily, true); assert.equal(connection.attemptTimeout, 2000); } }
    });
  });
});

test('NO_PROXY bypass and lowercase precedence match native fetch', proxyRuntime, async t => {
  const network = await weatherNetwork(t); const port = new URL(network.httpUrl).port;
  for (const scenario of [
    { name: 'exact host', value: 'weather.invalid' },
    { name: 'domain suffix', value: '.weather.invalid', url: network.httpUrl.replace('weather.invalid', 'sub.weather.invalid') },
    { name: 'matching host and port', value: `weather.invalid:${port}` },
    { name: 'nonmatching port remains proxied', value: 'weather.invalid:1', proxied: true },
    { name: 'wildcard', value: '*' },
    { name: 'lowercase overrides uppercase', value: 'other.invalid', env: { no_proxy: 'weather.invalid' } }
  ]) await t.test(scenario.name, async t => {
    for (const native of [true, false]) await t.test(native ? 'native' : 'weather', async t => {
      const before = network.requests.length;
      const client = weatherClient(t, { kind: 'fetch', native, url: scenario.url ?? network.httpUrl }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpsProxy, NO_PROXY: scenario.value, ...scenario.env } });
      const result = await client.wait('result'); assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.data.current.us_aqi, 91); assert.equal(network.requests.length - before, scenario.proxied ? 1 : 0);
    });
  });
});

test('HTTPS proxying preserves target certificate trust and hostname validation', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  for (const scenario of [
    { name: 'trusted target', ca: network.cert, ok: true },
    { name: 'untrusted target', ok: false, codes: ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'] },
    { name: 'wrong target hostname', ca: network.cert, url: network.httpsUrl.replace('weather.invalid', 'wrong.invalid'), ok: false, codes: ['ERR_TLS_CERT_ALTNAME_INVALID'] },
    { name: 'untrusted HTTPS proxy', url: network.httpUrl, proxy: network.httpsProxy, ok: false, codes: ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'] },
    { name: 'wrong HTTPS proxy hostname', ca: network.cert, url: network.httpUrl, proxy: network.httpsProxy.replace('localhost', 'wrong.invalid'), lookup: true, ok: false, codes: ['UND_ERR_PRX_TLS', 'ERR_TLS_CERT_ALTNAME_INVALID'] }
  ]) await t.test(scenario.name, async t => {
    for (const native of [true, false]) await t.test(native ? 'native' : 'weather', async t => {
      const client = weatherClient(t, { kind: 'fetch', native, url: scenario.url ?? network.httpsUrl, denyTargetLookup: !scenario.lookup }, { ca: scenario.ca, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: scenario.proxy ?? network.httpProxy, HTTPS_PROXY: scenario.proxy ?? network.httpProxy } });
      const result = await client.wait('result'); assert.equal(result.ok, scenario.ok, JSON.stringify(result));
      if (!scenario.ok) assert.ok(scenario.codes.includes(result.code), JSON.stringify(result));
    });
  });
});

test('weather wildcard domains include the apex; native comparisons use subdomains', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  for (const url of [network.httpUrl, network.httpsUrl]) {
    const { protocol, port } = new URL(url);
    for (const scenario of [
      { name: 'apex', env: { NO_PROXY: '*.weather.invalid' } },
      { name: 'subdomain', env: { NO_PROXY: '*.weather.invalid' }, url: url.replace('weather.invalid', 'sub.weather.invalid') },
      { name: 'lowercase only', env: { no_proxy: '*.weather.invalid' } },
      { name: 'lowercase precedence', env: { NO_PROXY: 'wrong.invalid', no_proxy: '*.weather.invalid' } },
      { name: 'empty lowercase', env: { NO_PROXY: '*.weather.invalid', no_proxy: '' }, proxied: true },
      { name: 'matching port', env: { NO_PROXY: `*.weather.invalid:${port}` } },
      { name: 'wrong port', env: { NO_PROXY: '*.weather.invalid:1' }, proxied: true },
      { name: 'mixed list', env: { NO_PROXY: 'other.invalid, *.weather.invalid , elsewhere.invalid' } },
      { name: 'case insensitive', env: { NO_PROXY: '*.WEATHER.INVALID' } },
      ...(protocol === 'http:' ? [{ name: 'unrelated host', env: { NO_PROXY: '*.weather.invalid' }, url: url.replace('weather.invalid', 'wrong.invalid'), proxied: true }] : [])
    ]) await t.test(`${protocol} ${scenario.name}`, async t => {
      for (const native of [true, false]) await t.test(native ? 'native subdomain contract' : 'weather apex and subdomain contract', async t => {
        // Native wildcard-apex semantics vary with bundled Undici. Subdomain routing is shared;
        // weather must additionally preserve its explicit apex-bypass contract on every runtime.
        const target = native ? (scenario.url ?? url).replace('://weather.invalid', '://sub.weather.invalid') : (scenario.url ?? url);
        const before = network.requests.length;
        const client = weatherClient(t, { kind: 'fetch', native, url: target }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpProxy, ...scenario.env } });
        const result = await client.wait('result'); assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.data.current.us_aqi, 91);
        assert.equal(network.requests.length - before, scenario.proxied ? 1 : 0, `${native ? 'native' : 'weather'} routing`);
        if (!native && !scenario.proxied) {
          assert.equal(result.defaultUnchanged, true); assert.ok(result.connections.length);
          for (const connection of result.connections) { assert.equal(connection.autoSelectFamily, true); assert.equal(connection.attemptTimeout, 2000); }
        }
      });
    });
  }
});

test('reused transports observe bypass edits with weather apex and native subdomain routing', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  for (const url of [network.httpUrl, network.httpsUrl]) {
    for (const variable of ['NO_PROXY', 'no_proxy']) for (const rule of ['*.weather.invalid', 'weather.invalid']) {
      await t.test(`${new URL(url).protocol} ${variable} ${rule}`, async t => {
        for (const native of [true, false]) await t.test(native ? 'native subdomain contract' : 'weather apex contract', async t => {
          const target = native ? url.replace('://weather.invalid', '://sub.weather.invalid') : url;
          const client = weatherClient(t, { kind: 'sequence', native, url: target }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpProxy } });
          await client.wait('sequence-ready');
          for (const [id, value] of ['other.invalid', rule, 'other.invalid'].entries()) {
            const before = network.proxyRequestCount;
            client.send({ type: 'request', id, env: { [variable]: value } });
            const result = await client.wait('step', id); assert.equal(result.ok, true, JSON.stringify(result));
            assert.equal(result.data.current.us_aqi, 91);
            assert.equal(network.proxyRequestCount - before, id === 1 ? 0 : 1, `${native ? 'native' : 'weather'} step ${id}`);
          }
        });
      });
    }
    await t.test(`${new URL(url).protocol} lowercase deletion and empty override`, async t => {
      for (const native of [true, false]) await t.test(native ? 'native subdomain contract' : 'weather apex contract', async t => {
        const target = native ? url.replace('://weather.invalid', '://sub.weather.invalid') : url;
        const client = weatherClient(t, { kind: 'sequence', native, url: target }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: network.httpProxy, HTTPS_PROXY: network.httpProxy, NO_PROXY: '*.weather.invalid' } });
        await client.wait('sequence-ready');
        const steps = [{ no_proxy: 'other.invalid' }, { no_proxy: null }, { no_proxy: '' }, { no_proxy: null }, { NO_PROXY: null }];
        for (const [id, env] of steps.entries()) {
          const before = network.proxyRequestCount; client.send({ type: 'request', id, env });
          const result = await client.wait('step', id); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.current.us_aqi, 91);
          assert.equal(network.proxyRequestCount - before, [0, 2, 4].includes(id) ? 1 : 0, `${native ? 'native' : 'weather'} step ${id}`);
        }
      });
    });
  }
});

test('weather stop closes both proxy and supplemental wildcard pools while the client stays alive', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  const client = weatherClient(t, { kind: 'sequence', url: network.httpsUrl }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy } });
  await client.wait('sequence-ready');
  for (const [id, value] of ['other.invalid', '*.weather.invalid'].entries()) {
    const before = network.requests.length; client.send({ type: 'request', id, env: { NO_PROXY: value } });
    const result = await client.wait('step', id); assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.data.current.us_aqi, 91);
    assert.equal(network.requests.length - before, id === 0 ? 1 : 0);
  }
  assert.equal(network.openProxyConnections, 1); assert.equal(network.openTargetConnections, 2, 'one tunneled and one direct keep-alive socket');
  client.send('dispose-transport'); const disposed = await client.wait('transport-disposed'); assert.equal(disposed.samePromise, true);
  await Promise.all([network.waitForTargetClose(), network.waitForProxyClose()]);
  assert.equal(client.alive, true); assert.equal(network.openTargetConnections, 0); assert.equal(network.openProxyConnections, 0);
});

for (const abort of [true, false]) test(`wildcard bypass releases a stalled body on ${abort ? 'abort' : 'stop'}`, proxyRuntime, async t => {
  const network = await weatherNetwork(t, { holdAir: true });
  const url = new URL('/v1/air-quality', network.httpsUrl).href;
  const client = weatherClient(t, { kind: 'sequence', url }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy, NO_PROXY: '*.weather.invalid' } });
  await client.wait('sequence-ready'); client.send({ type: 'request', id: 0, pending: true, abort }); await client.wait('headers', 0);
  assert.equal(network.requests.length, 0);
  if (!abort) { assert.equal(network.openTargetConnections, 1); client.send('dispose-transport'); await client.wait('transport-disposed'); }
  const result = await client.wait('step', 0); assert.equal(result.ok, false);
  if (abort) { assert.equal(result.name, 'AbortError'); client.send('dispose-transport'); await client.wait('transport-disposed'); }
  await network.waitForTargetClose(); assert.equal(client.alive, true); assert.equal(network.openTargetConnections, 0);
});

test('wildcard bypass retains target certificate validation', proxyRuntime, async t => {
  const network = await weatherNetwork(t);
  const client = weatherClient(t, { kind: 'fetch', url: network.httpsUrl }, { env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy, NO_PROXY: '*.weather.invalid' } });
  const result = await client.wait('result'); assert.equal(result.ok, false);
  assert.ok(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(result.code), JSON.stringify(result));
  assert.equal(network.requests.length, 0);
});
