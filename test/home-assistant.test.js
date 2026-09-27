import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeAssistantClient, homeAssistantWebSocketError, isHomeAssistantClientError, normalizeHomeAssistantCredentials, normalizeHomeAssistantDevices } from '../src/home-assistant.js';

function message(socket, data) {
  socket.dispatchEvent(new MessageEvent('message', { data: typeof data === 'string' ? data : JSON.stringify(data) }));
}

function successfulFactory({ devices = [{ id: 'device-1', name: 'Lamp', area_id: 'living' }], areas = [{ area_id: 'living', name: 'Living room' }], entityRegistry = { entities: [{ ei: 'light.lamp', di: 'device-1', en: 'Lamp power' }, { ei: 'sensor.temperature', di: 'device-1', en: 'Temperature' }] }, states = [{ entity_id: 'light.lamp', state: 'off', attributes: { friendly_name: 'Desk lamp' } }, { entity_id: 'sensor.temperature', state: '21.5', attributes: { friendly_name: 'Room temperature', unit_of_measurement: '°C', device_class: 'temperature' } }], sockets = [] } = {}) {
  return (url) => {
    const socket = new EventTarget();
    socket.url = url; socket.sent = []; socket.closed = false;
    socket.close = () => { socket.closed = true; };
    socket.send = (raw) => {
      const request = JSON.parse(raw); socket.sent.push(request);
      if (request.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
      if (request.id === 1) queueMicrotask(() => message(socket, { id: 1, type: 'result', success: true, result: devices }));
      if (request.id === 2) queueMicrotask(() => message(socket, { id: 2, type: 'result', success: true, result: areas }));
      if (request.id === 3) queueMicrotask(() => message(socket, { id: 3, type: 'result', success: true, result: entityRegistry }));
      if (request.id === 4) queueMicrotask(() => message(socket, { id: 4, type: 'result', success: true, result: states }));
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
  ], [{ area_id: 'area-1', name: ' Kitchen ' }], { entity_categories: { 0: 'config', 1: 'diagnostic' }, entities: [
    { ei: 'light.alpha', di: '1', en: 'Registry name' },
    { ei: 'switch.beta', di: '2', en: 'Beta switch' },
    { ei: 'fan.hidden', di: '1', hb: true },
    { ei: 'input_boolean.config', di: '1', ec: 0 },
    { ei: 'sensor.temperature', di: '1' },
    { ei: 'sensor.humidity', di: '1', ec: 1 },
    { ei: 'sensor.config', di: '1', ec: 0 },
    { ei: 'light.orphan', di: 'missing' }
  ] }, [
    { entity_id: 'light.alpha', state: 'on', attributes: { friendly_name: 'Alpha light', private: 'secret' } },
    { entity_id: 'switch.beta', state: 'unavailable', attributes: {} },
    { entity_id: 'fan.hidden', state: 'off', attributes: {} },
    { entity_id: 'input_boolean.config', state: 'on', attributes: {} },
    { entity_id: 'sensor.temperature', state: '20', attributes: { friendly_name: 'Temperature', unit_of_measurement: '°C', device_class: 'temperature', private: 'secret' }, context: { id: 'private-context' } },
    { entity_id: 'sensor.humidity', state: '45', attributes: { friendly_name: 'Humidity', unit_of_measurement: '%', device_class: 'humidity' } },
    { entity_id: 'sensor.config', state: '1', attributes: { friendly_name: 'Config value' } },
    { entity_id: 'light.orphan', state: 'off', attributes: {} }
  ]);
  assert.deepEqual(devices, [
    { deviceId: '1', name: 'Alpha', area: 'Kitchen', disabled: false, measurements: [
      { entityId: 'sensor.humidity', name: 'Humidity', value: '45', status: 'available', available: true, unit: '%', deviceClass: 'humidity' },
      { entityId: 'sensor.temperature', name: 'Temperature', value: '20', status: 'available', available: true, unit: '°C', deviceClass: 'temperature' }
    ], controls: [{ entityId: 'light.alpha', domain: 'light', name: 'Alpha light', state: 'on' }] },
    { deviceId: '2', name: 'Beta', area: null, manufacturer: 'Maker', model: 'Model', disabled: true, measurements: [], controls: [] },
    { deviceId: '3', name: 'Fallback model', area: null, model: 'Fallback model', disabled: false, measurements: [], controls: [] }
  ]);
  assert.equal(JSON.stringify(devices).includes('secret'), false);
  assert.throws(() => normalizeHomeAssistantDevices({}, []), /invalid device registry/);
  assert.throws(() => normalizeHomeAssistantDevices([{}, {}], [], { entities: [] }, [], 1), /too many/);
});

test('authenticates and correlates Home Assistant device and area commands', async () => {
  const sockets = [];
  const client = createHomeAssistantClient({ webSocketFactory: successfulFactory({ sockets }) });
  const devices = await client.listDevices({ baseUrl: 'https://home.example.test', accessToken: 'private-token' });
  assert.deepEqual(devices, [{ deviceId: 'device-1', name: 'Lamp', area: 'Living room', disabled: false, measurements: [{ entityId: 'sensor.temperature', name: 'Room temperature', value: '21.5', status: 'available', available: true, unit: '°C', deviceClass: 'temperature' }], controls: [{ entityId: 'light.lamp', domain: 'light', name: 'Desk lamp', state: 'off' }] }]);
  assert.equal(sockets[0].url, 'wss://home.example.test/api/websocket');
  assert.deepEqual(sockets[0].sent, [
    { type: 'auth', access_token: 'private-token' },
    { id: 1, type: 'config/device_registry/list' },
    { id: 2, type: 'config/area_registry/list' },
    { id: 3, type: 'config/entity_registry/list_for_display' },
    { id: 4, type: 'get_states' }
  ]);
  assert.equal(sockets[0].closed, true);
});

test('normalizes every supported control domain and non-actionable state', () => {
  const entities = ['light.alpha', 'switch.beta', 'fan.gamma', 'input_boolean.delta'];
  const devices = normalizeHomeAssistantDevices(
    [{ id: 'device', name: 'Controls' }],
    [],
    { entities: entities.map((entityId) => ({ ei: entityId, di: 'device' })) },
    [
      { entity_id: 'light.alpha', state: 'off', attributes: {} },
      { entity_id: 'switch.beta', state: 'on', attributes: {} },
      { entity_id: 'fan.gamma', state: 'custom', attributes: {} },
      { entity_id: 'input_boolean.delta', state: 'unavailable', attributes: {} }
    ]
  );
  assert.deepEqual(devices[0].controls.map(({ domain, state }) => ({ domain, state })), [
    { domain: 'light', state: 'off' },
    { domain: 'switch', state: 'on' },
    { domain: 'input_boolean', state: 'unavailable' },
    { domain: 'fan', state: 'unknown' }
  ]);
});

test('normalizes bounded numeric sensor readings and rejects unsafe states', () => {
  const valid = [
    ['sensor.temperature', '-1.25', 'Temperature', '°C', 'temperature'],
    ['sensor.humidity', '45', 'Humidity', '%', 'humidity'],
    ['sensor.pressure', '1e3', 'Pressure', 'hPa', 'pressure'],
    ['sensor.battery', '+90', 'Battery', '%', 'battery'],
    ['sensor.power', '.5', 'Power', 'W', 'power'],
    ['sensor.unitless', '10.', 'Unitless', undefined, undefined],
    ['sensor.offline', 'unavailable', 'Offline', 'V', 'voltage'],
    ['sensor.pending', 'unknown', 'Pending', undefined, undefined]
  ];
  const invalid = [
    ['sensor.text', 'home'], ['sensor.blank', '  '], ['sensor.hex', '0x10'], ['sensor.nan', 'NaN'],
    ['sensor.infinity', 'Infinity'], ['sensor.negative_infinity', '-Infinity'], ['sensor.partial', '12 watts'], ['sensor.long', '1'.repeat(65)]
  ];
  const entityRegistry = {
    entity_categories: { 0: 'config', 1: 'diagnostic' },
    entities: [
      ...valid.map(([entityId], index) => ({ ei: entityId, di: 'active', ...(index === 3 && { ec: 1 }) })),
      ...invalid.map(([entityId]) => ({ ei: entityId, di: 'active' })),
      { ei: 'sensor.config', di: 'active', ec: 0 },
      { ei: 'sensor.hidden', di: 'active', hb: true },
      { ei: 'sensor.orphan', di: 'missing' },
      { ei: 'sensor.disabled', di: 'disabled' },
      { ei: 'binary_sensor.motion', di: 'active' },
      { ei: 'sensor.missing_state', di: 'active' },
      { ei: 'sensor.bad-id!', di: 'active' }
    ]
  };
  const states = [
    ...valid.map(([entityId, state, name, unit, deviceClass]) => ({ entity_id: entityId, state, attributes: { friendly_name: name, ...(unit && { unit_of_measurement: unit }), ...(deviceClass && { device_class: deviceClass }), secret: 'private' }, context: { id: 'private' } })),
    ...invalid.map(([entityId, state]) => ({ entity_id: entityId, state, attributes: { friendly_name: entityId } })),
    { entity_id: 'sensor.config', state: '1', attributes: {} },
    { entity_id: 'sensor.hidden', state: '2', attributes: {} },
    { entity_id: 'sensor.orphan', state: '3', attributes: {} },
    { entity_id: 'sensor.disabled', state: '4', attributes: {} },
    { entity_id: 'binary_sensor.motion', state: '1', attributes: {} },
    { entity_id: 'sensor.bad-id!', state: '5', attributes: {} }
  ];
  const devices = normalizeHomeAssistantDevices([{ id: 'active', name: 'Active' }, { id: 'disabled', name: 'Disabled', disabled_by: 'user' }], [], entityRegistry, states);
  const readings = devices[0].measurements;
  assert.equal(readings.length, valid.length);
  const byName = Object.fromEntries(readings.map((reading) => [reading.name, reading]));
  assert.deepEqual(byName.Temperature, { entityId: 'sensor.temperature', name: 'Temperature', value: '-1.25', status: 'available', available: true, unit: '°C', deviceClass: 'temperature' });
  assert.deepEqual(byName.Pressure, { entityId: 'sensor.pressure', name: 'Pressure', value: '1e3', status: 'available', available: true, unit: 'hPa', deviceClass: 'pressure' });
  assert.deepEqual(byName.Offline, { entityId: 'sensor.offline', name: 'Offline', value: null, status: 'unavailable', available: false, unit: 'V', deviceClass: 'voltage' });
  assert.deepEqual(byName.Pending, { entityId: 'sensor.pending', name: 'Pending', value: null, status: 'unknown', available: false });
  assert.equal(JSON.stringify(readings).includes('private'), false);
  assert.deepEqual(devices[1].measurements, []);
});

test('caps sorted sensor readings per device', () => {
  const entities = Array.from({ length: 105 }, (_, index) => ({ ei: `sensor.value_${String(index).padStart(3, '0')}`, di: 'device' }));
  const states = entities.map(({ ei }, index) => ({ entity_id: ei, state: String(index), attributes: { friendly_name: `Reading ${String(index).padStart(3, '0')}` } }));
  const [device] = normalizeHomeAssistantDevices([{ id: 'device', name: 'Many sensors' }], [], { entities }, states);
  assert.equal(device.measurements.length, 100);
  assert.equal(device.measurements[0].name, 'Reading 000');
  assert.equal(device.measurements.at(-1).name, 'Reading 099');
});

test('classifies safe TLS failures without exposing upstream details', () => {
  const cases = [
    ['DEPTH_ZERO_SELF_SIGNED_CERT', /not trusted.*NODE_EXTRA_CA_CERTS/],
    ['UNABLE_TO_VERIFY_LEAF_SIGNATURE', /not trusted/],
    ['ERR_TLS_CERT_ALTNAME_INVALID', /does not match.*hostname/],
    ['CERT_HAS_EXPIRED', /expired or not yet valid/],
    ['CERT_NOT_YET_VALID', /expired or not yet valid/],
    ['PRIVATE_UPSTREAM_CODE', /^Home Assistant connection failed.*NODE_EXTRA_CA_CERTS/]
  ];
  for (const [code, expected] of cases) {
    const error = homeAssistantWebSocketError({ error: { code, message: 'private-token https://secret.internal' } });
    assert.equal(isHomeAssistantClientError(error), true);
    assert.match(error.message, expected);
    assert.doesNotMatch(error.message, /private-token|secret\.internal/);
  }
  assert.equal(isHomeAssistantClientError(new Error('upstream detail')), false);
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
  await assert.rejects(commandFailure.listDevices(settings), (error) => error.message === 'Home Assistant could not list its device controls.');
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
    else if (sent.id === 2) queueMicrotask(() => message(socket, { id: 2, type: 'result', success: true, result: [] }));
    else if (sent.id === 3) queueMicrotask(() => message(socket, { id: 3, type: 'result', success: true, result: { entities: [] } }));
    else if (sent.id === 4) queueMicrotask(() => message(socket, { id: 4, type: 'result', success: true, result: [] }));
  }).listDevices(settings), /invalid device registry/);
});

test('sends only allowlisted Home Assistant service actions', async () => {
  const settings = { baseUrl: 'http://home.local:8123', accessToken: 'private-token' };
  for (const [domain, action] of [['light', 'turn_on'], ['switch', 'turn_off'], ['fan', 'turn_on'], ['input_boolean', 'turn_off']]) {
    const sent = [];
    const client = createHomeAssistantClient({ webSocketFactory: () => {
      const socket = new EventTarget(); socket.close = () => {}; socket.send = (raw) => {
        const request = JSON.parse(raw); sent.push(request);
        if (request.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
        if (request.type === 'call_service') queueMicrotask(() => message(socket, { id: 1, type: 'result', success: true, result: { private: 'ignored' } }));
      };
      queueMicrotask(() => message(socket, { type: 'auth_required' })); return socket;
    } });
    await client.controlEntity(settings, { domain, entityId: `${domain}.office` }, action);
    assert.deepEqual(sent, [
      { type: 'auth', access_token: 'private-token' },
      { id: 1, type: 'call_service', domain, service: action, target: { entity_id: `${domain}.office` } }
    ]);
  }
  const client = createHomeAssistantClient({ webSocketFactory: () => { throw new Error('must not connect'); } });
  await assert.rejects(client.controlEntity(settings, { domain: 'lock', entityId: 'lock.front' }, 'unlock'), /target is invalid/);
  await assert.rejects(client.controlEntity(settings, { domain: 'light', entityId: 'switch.wrong' }, 'turn_on'), /target is invalid/);
});

test('contains Home Assistant action protocol failures', async () => {
  const settings = { baseUrl: 'http://home.local:8123', accessToken: 'private-token' };
  const target = { domain: 'light', entityId: 'light.office' };
  const clientFor = (respond, timeoutMs = 20) => createHomeAssistantClient({ timeoutMs, webSocketFactory: () => {
    const socket = new EventTarget(); socket.close = () => {}; socket.send = (raw) => {
      const request = JSON.parse(raw);
      if (request.type === 'auth') queueMicrotask(() => message(socket, { type: 'auth_ok' }));
      if (request.type === 'call_service') queueMicrotask(() => respond(socket));
    };
    queueMicrotask(() => message(socket, { type: 'auth_required' })); return socket;
  } });
  await assert.rejects(clientFor((socket) => message(socket, { id: 1, type: 'result', success: false, error: { message: 'private target' } })).controlEntity(settings, target, 'turn_on'), (error) => error.message === 'Home Assistant could not control this entity.');
  await assert.rejects(clientFor((socket) => message(socket, '{bad')).controlEntity(settings, target, 'turn_on'), /invalid action response/);
  await assert.rejects(clientFor((socket) => socket.dispatchEvent(new Event('close'))).controlEntity(settings, target, 'turn_on'), /closed the connection/);
  await assert.rejects(clientFor(() => {}, 5).controlEntity(settings, target, 'turn_on'), /action timed out/);
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
