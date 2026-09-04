import dgram from 'node:dgram';

const MAC_PATTERN = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const IPV4_PART_PATTERN = /^(0|[1-9]\d{0,2})$/;

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

export async function sendMagicPacket({ macAddress, broadcastAddress, port }) {
  const packet = createMagicPacket(macAddress);
  const socket = dgram.createSocket('udp4');
  try {
    await new Promise((resolve, reject) => {
      socket.once('error', reject);
      socket.bind(() => {
        try {
          socket.setBroadcast(true);
          socket.send(packet, port, broadcastAddress, (error) => error ? reject(error) : resolve());
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    socket.close();
  }
}
