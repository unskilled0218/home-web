import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyRuntime, weatherClient, weatherNetwork } from './fixtures/weather-network.js';
import { within } from './fixtures/lifecycle.js';
import { location } from './fixtures/weather.js';

for (const mode of ['global', 'local']) {
  test(`${mode} service stop destroys its real idle pool before fixture cleanup`, proxyRuntime, async t => {
    const network = await weatherNetwork(t);
    const client = weatherClient(t, { kind: 'service', mode, location }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy } });
    const ready = await client.wait('ready'); assert.deepEqual(ready.snapshot.air, { aqi: 91 });
    assert.ok(network.openProxyConnections > 0, 'successful retrieval retained a real keep-alive connection');
    client.send('stop'); const result = await client.wait('stopped');
    assert.equal(result.stopped, true); assert.equal(result.closed, true); assert.ok(result.poolDisposals > 0);
    await network.waitForProxyClose();
    assert.equal(client.alive, true, 'socket closure must come from service disposal, not process exit');
    assert.equal(network.openProxyConnections, 0);
  });

  test(`${mode} service cancels pending body work before coordinator store cleanup`, proxyRuntime, async t => {
    const network = await weatherNetwork(t, { holdAir: true });
    const client = weatherClient(t, { kind: 'service', mode, location, pending: true }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy } });
    await client.wait('started'); await within(network.airStarted);
    assert.ok(network.openProxyConnections > 0);
    client.send('stop'); const result = await client.wait('stopped');
    assert.equal(result.stopped, true); assert.equal(result.closed, true); assert.ok(result.poolDisposals > 0);
    if (mode === 'global') { assert.equal(result.snapshot.air, null); assert.equal(result.snapshot.airUpdated, null); assert.equal(result.snapshot.refreshing, false); }
    network.releaseAir(); await network.waitForProxyClose();
    assert.equal(client.alive, true); assert.equal(network.openProxyConnections, 0);
  });

  test(`${mode} service leaves an injected transport usable by its caller`, proxyRuntime, async t => {
    const network = await weatherNetwork(t);
    const client = weatherClient(t, { kind: 'service', mode, location, injected: true, url: network.httpsUrl }, { ca: network.cert, env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: network.httpProxy } });
    await client.wait('ready'); client.send('stop');
    const result = await client.wait('stopped');
    assert.equal(result.callerDisposals, 0); assert.equal(result.poolDisposals, 0); assert.equal(result.callerStillWorks, 91); assert.ok(network.openProxyConnections > 0);
    client.send('dispose-external'); await client.wait('external-disposed'); await network.waitForProxyClose();
    assert.equal(client.alive, true); assert.equal(network.openProxyConnections, 0);
  });
}
