import test from 'node:test';
import assert from 'node:assert/strict';
import { createMagicPacket, isValidIpv4, normalizeBroadcastAddress, normalizeMacAddress } from '../src/wol.js';

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
