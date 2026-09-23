import test from 'node:test';
import assert from 'node:assert/strict';
import { createMagicPacket, interfaceBroadcastAddresses, isValidIpv4, moonlightDeliveryPlan, normalizeBroadcastAddress, normalizeMacAddress, sendMagicPacket } from '../src/wol.js';
import { executeWakeRequest } from '../src/wake-request.js';

test('normalizes valid MAC addresses', () => {
  assert.equal(normalizeMacAddress('aa-bb-cc-dd-ee-ff'), 'AA:BB:CC:DD:EE:FF');
  assert.throws(() => normalizeMacAddress('not-a-mac'), /MAC address/);
});

test('creates a standards-compliant magic packet', () => {
  const packet = createMagicPacket('AA:BB:CC:DD:EE:FF');
  assert.equal(packet.length, 102);
  assert.deepEqual(packet.subarray(0, 6), Buffer.alloc(6, 0xff));
  assert.deepEqual(packet.subarray(6, 12), Buffer.from('aabbccddeeff', 'hex'));
  assert.deepEqual(packet.subarray(96, 102), Buffer.from('aabbccddeeff', 'hex'));
});

test('accepts valid IPv4 broadcast addresses only', () => {
  assert.equal(isValidIpv4('192.168.1.255'), true);
  assert.equal(normalizeBroadcastAddress('10.0.0.255'), '10.0.0.255');
  assert.equal(isValidIpv4('192.168.1.999'), false);
  assert.throws(() => normalizeBroadcastAddress('not-an-ip'), /Broadcast address/);
});

test('derives broadcast addresses from active IPv4 interfaces only', () => {
  assert.deepEqual(interfaceBroadcastAddresses({
    ethernet: [{ address: '192.168.5.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
    loopback: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    ipv6: [{ address: '::1', netmask: 'ffff:ffff:ffff:ffff::', family: 'IPv6', internal: false }]
  }), ['192.168.5.255']);
});

test('plans Moonlight-compatible static-port delivery without duplicate destinations or ports', () => {
  const plan = moonlightDeliveryPlan({
    ipAddress: '192.168.1.42',
    broadcastAddress: '192.168.1.255',
    port: 47009,
    interfaces: {
      ethernet: [{ address: '192.168.1.10', netmask: '255.255.255.0', family: 'IPv4', internal: false }],
      wifi: [{ address: '10.0.0.2', netmask: '255.255.255.0', family: 'IPv4', internal: false }]
    }
  });
  assert.deepEqual(plan, [
    { address: '192.168.1.42', port: 9 }, { address: '192.168.1.42', port: 47009 },
    { address: '255.255.255.255', port: 9 }, { address: '255.255.255.255', port: 47009 },
    { address: '192.168.1.255', port: 9 }, { address: '192.168.1.255', port: 47009 },
    { address: '10.0.0.255', port: 9 }, { address: '10.0.0.255', port: 47009 }
  ]);
});

test('sends every Moonlight-compatible UDP datagram and reports the dispatch count', async () => {
  const sent = [];
  const socket = {
    on() {}, once() {}, off() {}, bind(callback) { callback(); }, setBroadcast(value) { assert.equal(value, true); },
    send(packet, port, address, callback) { sent.push({ packet: Buffer.from(packet), port, address }); callback(null); }, close() {}
  };
  const dispatch = await sendMagicPacket({
    macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: '192.168.1.42', port: 9,
    interfaces: {}, socketFactory: () => socket
  });
  assert.deepEqual(dispatch, { attempted: 6, sent: 6, failed: 0 });
  assert.deepEqual(sent.map(({ address, port }) => ({ address, port })), moonlightDeliveryPlan({ broadcastAddress: '192.168.1.255', ipAddress: '192.168.1.42', port: 9, interfaces: {} }));
  assert.ok(sent.every(({ packet }) => packet.equals(createMagicPacket('AA:BB:CC:DD:EE:FF'))));
});

test('fails when every Moonlight-compatible UDP send fails', async () => {
  const socket = {
    on() {}, once() {}, off() {}, bind(callback) { callback(); }, setBroadcast() {},
    send(packet, port, address, callback) { callback(new Error('network unavailable')); }, close() {}
  };
  await assert.rejects(() => sendMagicPacket({ macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', port: 9, interfaces: {}, socketFactory: () => socket }), /Unable to send/);
});

test('contains wake audit failures without changing the dispatch result', async () => {
  const messages = [];
  const device = { macAddress: 'AA:BB:CC:DD:EE:FF', broadcastAddress: '192.168.1.255', ipAddress: null };
  const sent = await executeWakeRequest({
    device,
    port: 9,
    send: async () => ({ attempted: 6, sent: 6, failed: 0 }),
    markWake: () => { throw new Error('device deleted'); },
    audit: () => { throw new Error('foreign key'); },
    logError: (message) => messages.push(message)
  });
  assert.deepEqual(sent, { sent: true, dispatch: { attempted: 6, sent: 6, failed: 0 } });
  assert.deepEqual(messages, ['Wake packet was dispatched, but its audit record could not be persisted.']);

  const failed = await executeWakeRequest({
    device,
    port: 9,
    send: async () => { throw new Error('network unavailable'); },
    markWake: () => assert.fail('markWake must not run'),
    audit: () => { throw new Error('device deleted'); },
    logError: (message) => messages.push(message)
  });
  assert.deepEqual(failed, { sent: false });
  assert.equal(messages[1], 'Unable to persist a failed wake attempt.');
});
