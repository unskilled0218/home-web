import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantController, homeAssistantOrigin } from '../public/dashboard-home-assistant.js';

const status = (configured = false, baseUrl = '') => ({ homeAssistant: { configured, configurationId: configured ? 'c'.repeat(43) : null, baseUrl, accessTokenPresent: configured, encryptionReady: true, needsReauthentication: false } });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

test('Home Assistant origin eligibility matches the server URL contract', () => {
  for (const url of ['https://home.test', 'https://home.test/', 'https://home.test:443/', ' https://home.test/ ']) assert.equal(homeAssistantOrigin(url), 'https://home.test', url);
  for (const url of ['invalid', 'ftp://home.test', 'https://user:password@home.test', 'https://home.test/path', 'https://home.test/?query=1', 'https://home.test/#fragment']) assert.equal(homeAssistantOrigin(url), null, url);
});

test('Home Assistant adopts only public status, supports empty token updates and 204 disconnect', async () => {
  const calls = []; let saved = status();
  const controller = createHomeAssistantController({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (options.method === 'DELETE') { saved = status(); return new Response(null, { status: 204 }); }
    if (options.method === 'PUT') { saved = status(true, 'https://home.test'); return Response.json({ ...saved, devices: [{ controlToken: 'not-a-setting' }], accessToken: 'not-a-setting' }); }
    return Response.json(saved);
  } });
  controller.setPaused(false); await controller.refresh();
  await controller.connect({ url: 'https://home.test', accessToken: 'secret' }); await controller.refresh();
  assert.equal(controller.getState().configured, true);
  assert.doesNotMatch(JSON.stringify(controller.getState()), /secret|controlToken|not-a-setting/);
  await controller.connect({ url: 'https://home.test:443/', accessToken: '' });
  assert.equal(JSON.parse(calls.filter((call) => call.method === 'PUT').at(-1).body).accessToken, '');
  await controller.disconnect(); await controller.refresh();
  assert.equal(controller.getState().configured, false); assert.equal(controller.getState().mutationPending, false);
  controller.dispose();
});

test('old reads cannot undo a Home Assistant mutation and duplicate mutations are rejected', async () => {
  const old = deferred(); const put = deferred(); let reads = 0;
  const controller = createHomeAssistantController({ fetchImpl: (_url, options) => options.method === 'PUT' ? put.promise : ++reads === 1 ? old.promise : Promise.resolve(Response.json(status(true, 'https://new.test'))) });
  controller.setPaused(false); const read = controller.refresh();
  const mutation = controller.connect({ url: 'https://new.test', accessToken: 'secret' });
  await assert.rejects(controller.connect({ url: 'https://other.test', accessToken: 'secret' }), /already pending/);
  put.resolve(Response.json(status(true, 'https://new.test'))); await mutation;
  old.resolve(Response.json(status())); await read; await controller.refresh();
  assert.equal(controller.getState().baseUrl, 'https://new.test'); controller.dispose();
});

test('failed reconnect and subsequent failed reads preserve confirmed Home Assistant status', async () => {
  let failRead = false;
  const controller = createHomeAssistantController({ fetchImpl: async (_url, options) => {
    if (options.method === 'PUT') return Response.json({ error: 'Home Assistant connection failed.' }, { status: 400 });
    if (failRead) throw new Error('private network detail');
    return Response.json(status(true, 'https://saved.test'));
  } });
  controller.setPaused(false); await controller.refresh(); failRead = true;
  await assert.rejects(controller.connect({ url: 'https://other.test', accessToken: 'secret' }), /connection failed/);
  await controller.refresh();
  assert.equal(controller.getState().baseUrl, 'https://saved.test'); assert.match(controller.getState().error, /unavailable/);
  assert.doesNotMatch(controller.getState().error, /private/); controller.dispose();
});

test('pause discards pre-pause responses, resumes fresh reads, and queues a read after a mutation', async () => {
  const first = deferred(); const put = deferred(); let reads = 0;
  const controller = createHomeAssistantController({ fetchImpl: (_url, options) => options.method === 'PUT' ? put.promise : ++reads === 1 ? first.promise : Promise.resolve(Response.json(status(true, 'https://fresh.test'))) });
  controller.setPaused(false); const stale = controller.refresh(); controller.setPaused(true); controller.setPaused(false); await controller.refresh();
  first.resolve(Response.json(status())); await stale; assert.equal(controller.getState().baseUrl, 'https://fresh.test');
  const mutation = controller.connect({ url: 'https://fresh.test', accessToken: '' });
  controller.setPaused(true); controller.setPaused(false); await controller.refresh();
  put.resolve(Response.json(status(true, 'https://fresh.test'))); await mutation; await controller.refresh();
  assert.equal(reads, 3); controller.dispose();
});

test('request deadline rejects uncertain mutations without retries and disposal suppresses callbacks', async () => {
  const timers = new Map(); let id = 0; let calls = 0; let emitted = 0;
  const controller = createHomeAssistantController({ fetchImpl: () => { calls++; return new Promise(() => {}); }, onChange: () => emitted++, schedule: (fn) => { timers.set(++id, fn); return id; }, cancel: (key) => timers.delete(key) });
  const pending = controller.connect({ url: 'https://home.test', accessToken: 'secret' });
  const rejected = assert.rejects(pending, /outcome is uncertain/); [...timers.values()][0](); await rejected;
  assert.equal(calls, 1); assert.equal(controller.getState().mutationPending, false);
  controller.setPaused(false); const read = controller.refresh(); controller.dispose(); const before = emitted; await read;
  assert.equal(emitted, before); assert.equal(timers.size, 0);
});

test('malformed Home Assistant discovery cannot establish a connection', async () => {
  const controller = createHomeAssistantController({ fetchImpl: async () => Response.json({ homeAssistant: { configured: true, accessToken: 'secret' } }) });
  controller.setPaused(false); await controller.refresh(); assert.equal(controller.getState().discovered, false); assert.match(controller.getState().error, /Invalid Home Assistant/); controller.dispose();
});

test('failed disconnect never reclassifies a saved Home Assistant connection as deleted', async () => {
  const controller = createHomeAssistantController({ fetchImpl: async (_url, options) => options.method === 'DELETE' ? Response.json({ error: 'Disconnect failed.' }, { status: 503 }) : Response.json(status(true, 'https://saved.test')) });
  controller.setPaused(false); await controller.refresh(); await assert.rejects(controller.disconnect(), /Disconnect failed/); await controller.refresh();
  assert.equal(controller.getState().configured, true); assert.equal(controller.getState().accessTokenPresent, true); assert.equal(controller.getState().mutationPending, false); controller.dispose();
});
