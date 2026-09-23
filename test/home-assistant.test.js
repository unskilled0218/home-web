import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantClient, normalizeHomeAssistantCredentials, normalizeHomeAssistantDevices } from '../src/home-assistant.js';

function message(socket, data) {
  socket.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
}

function successfulFactory({ devices = [{ id: 'device-1', name: 'Lamp', area_id: 'living' }], areas = [{ area_id: 'living', name: 'Living room' }], sockets = [] } = {}) {
  return (url) => {
    const socket = new EventTarget();
    socket.url = url; socket.sent = []; socket.closed = false;
    socket.close = () => { socket.closed = true; };
    socket.send = (raw) => {
      const request = JSON.parse(raw); socket.sent.push(request);
      if (request.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
      if (request.id === 1) queueMicrotask(() => message(socket, { id: 1, type: 'result', success: true, result: devices }));
      if (request.id === 2) queueMicrotask(() => message(socket, { id: 2, type: 'result', success: true, result: areas }));
    };
    sockets.push(socket);
    queueMicrotask(() => message(socket, { type: 'auth_required' }));
    return socket;
  };
}

test('normalizes Home Assistant credentials and safe device metadata', () => {
  assert.deepEqual(normalizeHomeAssistantCredentials({ url: ' https://home.example.test/ ', accessToken: ' token ' }), { baseUrl: 'https://home.example.test', accessToken: 'token' });
  assert.deepEqual(normalizeHomeAssistantCredentials({ url: 'http://home.local:8123', accessToken: '' }, {}), { baseUrl: 'http://home.local:8123', accessToken: null });
  for (const url of ['file:///tmp', 'https://user@home.test', 'https://home.test/path', 'https://home.test?query=1']) assert.throws(() => normalizeHomeAssistantCredentials({ url, accessToken: 'token' }), /Home Assistant URL/);
  assert.throws(() => normalizeHomeAssistantCredentials({ url: 'https://home.test', accessToken: '' }), /required/);

  const devices = normalizeHomeAssistantDevices([
    { id: '2', name: ' Beta ', manufacturer: ' Maker ', model: ' Model ', area_id: 'missing', disabled_by: 'user', connections: [['mac', 'secret']] },
    { id: '1', name_by_user: ' Alpha ', name: 'Ignored', area_id: 'area-1' },
    { id: '1', name: 'Duplicate' },
    { id: '', name: 'Invalid' },
    { id: '3', model: 'Fallback model' }
  ], [{ area_id: 'area-1', name: ' Kitchen ' }]);
  assert.deepEqual(devices, [
    { name: 'Alpha', area: 'Kitchen', disabled: false },
    { name: 'Beta', area: null, manufacturer: 'Maker', model: 'Model', disabled: true },
    { name: 'Fallback model', area: null, model: 'Fallback model', disabled: false }
  ]);
  assert.equal(JSON.stringify(devices).includes('secret'), false);
  assert.throws(() => normalizeHomeAssistantDevices({}, []), /invalid device registry/);
  assert.throws(() => normalizeHomeAssistantDevices([{}, {}], [], 1), /too many/);
});

test('authenticates and correlates Home Assistant device and area commands', async () => {
  const sockets = [];
  const client = createHomeAssistantClient({ webSocketFactory: successfulFactory({ sockets }) });
  const devices = await client.listDevices({ baseUrl: 'https://home.example.test', accessToken: 'private-token' });
  assert.deepEqual(devices, [{ name: 'Lamp', area: 'Living room', disabled: false }]);
  assert.equal(sockets[0].url, 'wss://home.example.test/api/websocket');
  assert.deepEqual(sockets[0].sent, [
    { type: 'auth', access_token: 'private-token' },
    { id: 1, type: 'config/device_registry/list' },
    { id: 2, type: 'config/area_registry/list' }
  ]);
  assert.equal(sockets[0].closed, true);
});

test('rejects authentication, command, malformed, closed, and timed-out sessions', async () => {
  const settings = { baseUrl: 'http://home.local:8123', accessToken: 'token' };
  const failureSockets = [];
  const clientFor = (start, options = {}) => createHomeAssistantClient({ timeoutMs: 10, webSocketFactory: () => {
    const socket = new EventTarget(); socket.closed = false; socket.close = () => { socket.closed = true; }; socket.send = () => {}; failureSockets.push(socket); queueMicrotask(() => start(socket)); return socket;
  }, ...options });
  let rejectedSocket;
  const rejected = createHomeAssistantClient({ webSocketFactory: () => {
    const socket = new EventTarget(); socket.closed = false; socket.close = () => { socket.closed = true; }; socket.send = () => queueMicrotask(() => message(socket, { type: 'auth_invalid' })); rejectedSocket = socket; queueMicrotask(() => message(socket, { type: 'auth_required' })); return socket;
  } });
  await assert.rejects(rejected.listDevices(settings), /rejected/);
  assert.equal(rejectedSocket.closed, true);
  await assert.rejects(clientFor((socket) => { message(socket, '{bad'); }).listDevices(settings), /invalid response/);
  await assert.rejects(clientFor((socket) => { socket.dispatchEvent(new Event('close')); }).listDevices(settings), /closed/);
  await assert.rejects(clientFor(() => {}).listDevices(settings), /timed out/);

  let commandFailureSocket;
  const commandFailure = createHomeAssistantClient({ webSocketFactory: () => {
    const socket = new EventTarget(); socket.closed = false; socket.close = () => { socket.closed = true; }; commandFailureSocket = socket; socket.send = (raw) => {
      const request = JSON.parse(raw);
      if (request.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
      if (request.id === 1) queueMicrotask(() => message(socket, { id: 1, type: 'result', success: false, error: { message: 'private detail' } }));
    };
    queueMicrotask(() => message(socket, { type: 'auth_required' })); return socket;
  } });
  await assert.rejects(commandFailure.listDevices(settings), (error) => error.message === 'Home Assistant could not list its device registry.');
  assert.equal(commandFailureSocket.closed, true);
  assert.equal(failureSockets.every((socket) => socket.closed), true);
});

test('rejects out-of-order, repeated authentication, and duplicate command results', async () => {
  const settings = { baseUrl: 'http://home.local:8123', accessToken: 'token' };
  const clientWith = (configure) => createHomeAssistantClient({ webSocketFactory: () => {
    const socket = new EventTarget(); socket.closed = false; socket.close = () => { socket.closed = true; }; socket.send = (raw) => configure(socket, JSON.parse(raw)); configure(socket); return socket;
  } });
  await assert.rejects(clientWith((socket, sent) => { if (!sent) queueMicrotask(() => message(socket, { type: 'auth_ok' })); }).listDevices(settings), /unexpected authentication/);
  await assert.rejects(clientWith((socket, sent) => {
    if (!sent) queueMicrotask(() => message(socket, { type: 'auth_required' }));
    else if (sent.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_required' }));
  }).listDevices(settings), /unexpected authentication/);
  await assert.rejects(clientWith((socket, sent) => {
    if (!sent) queueMicrotask(() => message(socket, { type: 'auth_required' }));
    else if (sent.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
    else if (sent.id === 1) queueMicrotask(() => { message(socket, { id: 1, type: 'result', success: true, result: [] }); message(socket, { id: 1, type: 'result', success: true, result: [] }); });
  }).listDevices(settings), /invalid command response/);
  await assert.rejects(clientWith((socket, sent) => {
    if (!sent) queueMicrotask(() => message(socket, { type: 'auth_required' }));
    else if (sent.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
    else if (sent.id === 1) queueMicrotask(() => message(socket, { id: 1, type: 'result', success: true }));
  }).listDevices(settings), /invalid device registry/);
});

test('bounds messages and caches, deduplicates, refreshes, and clears snapshots', async () => {
  const sockets = [];
  const client = createHomeAssistantClient({ webSocketFactory: successfulFactory({ sockets }), cacheSeconds: 60 });
  const settings = { baseUrl: 'http://home.local:8123', accessToken: 'token' };
  const [first, concurrent] = await Promise.all([client.listDevices(settings), client.listDevices(settings)]);
  assert.deepEqual(first, concurrent);
  assert.equal(sockets.length, 1);
  await client.listDevices(settings);
  assert.equal(sockets.length, 1);
  await client.listDevices(settings, { force: true });
  assert.equal(sockets.length, 2);
  client.clearCache();
  await client.listDevices(settings);
  assert.equal(sockets.length, 3);

  let boundedSocket;
  const bounded = createHomeAssistantClient({ maxMessageBytes: 5, webSocketFactory: () => {
    const socket = new EventTarget(); socket.closed = false; socket.close = () => { socket.closed = true; }; socket.send = () => {}; boundedSocket = socket; queueMicrotask(() => message(socket, { type: 'auth_required' })); return socket;
  } });
  await assert.rejects(bounded.listDevices(settings), /invalid response/);
  assert.equal(boundedSocket.closed, true);
});
