import { createConfigurationController } from './dashboard-configuration.js';

function device(value) {
  if (!value || !Number.isSafeInteger(value.id) || value.id <= 0 || ['name', 'macAddress', 'broadcastAddress', 'group'].some((key) => typeof value[key] !== 'string') || !(value.ipAddress === null || typeof value.ipAddress === 'string')) throw new Error('Invalid Wake-on-LAN device.');
  return { id: value.id, name: value.name, macAddress: value.macAddress, broadcastAddress: value.broadcastAddress, ipAddress: value.ipAddress, group: value.group, lastWakeRequestedAt: typeof value.lastWakeRequestedAt === 'string' ? value.lastWakeRequestedAt : null };
}
function devices(data) {
  if (!Array.isArray(data?.devices)) throw new Error('Invalid Wake-on-LAN device list.');
  const values = data.devices.map(device);
  if (new Set(values.map((value) => value.id)).size !== values.length) throw new Error('Duplicate Wake-on-LAN device IDs.');
  return { devices: values };
}
export function createWolController(options = {}) {
  const controller = createConfigurationController({ ...options, url: '/api/devices', initial: { devices: [] }, decode: devices });
  const fields = (input) => Object.fromEntries(['name', 'macAddress', 'broadcastAddress', 'ipAddress', 'group'].map((key) => [key, input[key] ?? '']));
  return { ...controller,
    save(input, id = null) {
      return controller.mutate(id === null ? '/api/devices' : `/api/devices/${id}`, id === null ? 'POST' : 'PUT', fields(input), (data, previous) => {
        const saved = device(data?.device);
        return { devices: [...previous.devices.filter((item) => item.id !== saved.id), saved] };
      });
    },
    remove: (id) => controller.mutate(`/api/devices/${id}`, 'DELETE', undefined, (_data, previous) => ({ devices: previous.devices.filter((item) => item.id !== id) }))
  };
}
