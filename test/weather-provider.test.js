import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { createWeatherTransport, providerJson } from '../src/weather-provider.js';
import { rawAir } from './fixtures/weather.js';

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
