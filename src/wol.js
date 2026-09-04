import dgram from 'node:dgram';
import { networkInterfaces } from 'node:os';

const MAC_PATTERN = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const IPV4_PART_PATTERN = /^(0|[1-9]\d{0,2})$/;
export const MOONLIGHT_WOL_PORTS = Object.freeze([9, 47009]);

export function normalizeMacAddress(value) {
  if (typeof value !== 'string' || !MAC_PATTERN.test(value.trim())) {
    throw new Error('MAC address must contain six hexadecimal pairs.');
  }
  return value.trim().replaceAll('-', ':').toUpperCase();
}

export function isValidIpv4(value) {
  if (typeof value !== 'string') return false;
  const parts = value.trim().split('.');
  return parts.length === 4 && parts.every((part) => IPV4_PART_PATTERN.test(part) && Number(part) <= 255);
}

export function normalizeBroadcastAddress(value) {
  if (!isValidIpv4(value)) throw new Error('Broadcast address must be a valid IPv4 address.');
  return value.trim();
}

export function createMagicPacket(macAddress) {
  const mac = Buffer.from(normalizeMacAddress(macAddress).replaceAll(':', ''), 'hex');
  const packet = Buffer.alloc(102, 0xff);
  for (let offset = 6; offset < packet.length; offset += 6) mac.copy(packet, offset);
  return packet;
}

function ipv4Number(value) {
  if (!isValidIpv4(value)) return null;
  return value.trim().split('.').reduce((number, part) => (number << 8) | Number(part), 0) >>> 0;
}

function ipv4String(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

export function interfaceBroadcastAddresses(interfaces = networkInterfaces()) {
  const broadcasts = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.internal || address.family !== 'IPv4') continue;
      const ip = ipv4Number(address.address);
      const netmask = ipv4Number(address.netmask);
      if (ip === null || netmask === null) continue;
      broadcasts.push(ipv4String((ip | (~netmask >>> 0)) >>> 0));
    }
  }
  return broadcasts;
}

export function moonlightDeliveryPlan({ broadcastAddress, ipAddress = null, port = 9, interfaces }) {
  const configuredBroadcast = normalizeBroadcastAddress(broadcastAddress);
  if (ipAddress && !isValidIpv4(ipAddress)) throw new Error('IP address must be a valid IPv4 address when provided.');
  const destinations = [ipAddress?.trim(), '255.255.255.255', configuredBroadcast, ...interfaceBroadcastAddresses(interfaces)].filter(Boolean);
  const uniqueDestinations = [...new Set(destinations)];
  const ports = [...new Set([...MOONLIGHT_WOL_PORTS, port])];
  return uniqueDestinations.flatMap((address) => ports.map((destinationPort) => ({ address, port: destinationPort })));
}

function bind(socket) {
  return new Promise((resolve, reject) => {
    const fail = (error) => { socket.off('error', fail); reject(error); };
    socket.once('error', fail);
    socket.bind(() => { socket.off('error', fail); resolve(); });
  });
}

function send(socket, packet, { address, port }) {
  return new Promise((resolve, reject) => socket.send(packet, port, address, (error) => error ? reject(error) : resolve()));
}

export async function sendMagicPacket({ macAddress, broadcastAddress, ipAddress, port, interfaces, socketFactory = () => dgram.createSocket('udp4') }) {
  const packet = createMagicPacket(macAddress);
  const deliveries = moonlightDeliveryPlan({ broadcastAddress, ipAddress, port, interfaces });
  const socket = socketFactory();
  try {
    socket.on('error', () => {});
    await bind(socket);
    socket.setBroadcast(true);
    const results = await Promise.allSettled(deliveries.map((delivery) => send(socket, packet, delivery)));
    const sent = results.filter((result) => result.status === 'fulfilled').length;
    if (!sent) throw new Error(`Unable to send the wake packet to any of ${deliveries.length} Moonlight-compatible UDP destinations.`);
    return { attempted: deliveries.length, sent, failed: deliveries.length - sent };
  } finally {
    socket.close();
  }
}
