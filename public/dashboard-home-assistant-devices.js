import { DEVICE_SELECTION_ID } from './dashboard-helpers.js';

export const DEVICE_SNAPSHOT_POLL_MS = 30000;
export const MAX_DEVICE_RESPONSE_BYTES = 8 * 1024 * 1024;
const readingId = /^r_[A-Za-z0-9_-]{43}$/;
const boundedText = (value, limit) => typeof value === 'string' && value.length <= limit;

export function decodeDeviceSnapshot(value) {
  if (!value || typeof value.configured !== 'boolean' || (value.configurationId !== null && !/^[A-Za-z0-9_-]{43}$/.test(value.configurationId)) || !Array.isArray(value.devices) || value.devices.length > 5000 || value.configured && !value.configurationId || !value.configured && value.devices.length) throw new Error('Invalid Home Assistant device snapshot.');
  const seen = new Set(); const readings = new Set();
  const devices = value.devices.map((device) => {
    if (!device || !DEVICE_SELECTION_ID.test(device.selectionId) || seen.has(device.selectionId) || !boundedText(device.name, 160) || !(device.area === null || boundedText(device.area, 160)) || typeof device.disabled !== 'boolean' || !Array.isArray(device.measurements) || device.measurements.length > 5000) throw new Error('Invalid Home Assistant device.');
    seen.add(device.selectionId);
    const measurements = device.measurements.map((reading) => {
      if (!reading || !readingId.test(reading.selectionId) || readings.has(reading.selectionId) || !boundedText(reading.name, 160) || !['available', 'unknown', 'unavailable'].includes(reading.status) || reading.available !== (reading.status === 'available') || reading.unit !== undefined && !boundedText(reading.unit, 32)) throw new Error('Invalid Home Assistant reading.');
      if (reading.available ? !(boundedText(reading.value, 128) && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(reading.value) && Number.isFinite(Number(reading.value))) : reading.value !== null) throw new Error('Invalid Home Assistant reading value.');
      readings.add(reading.selectionId);
      return { selectionId: reading.selectionId, name: reading.name, value: reading.value, status: reading.status, available: reading.available, ...(reading.unit !== undefined && { unit: reading.unit }) };
    });
    return { selectionId: device.selectionId, name: device.name, area: device.area, disabled: device.disabled, measurements, ...(boundedText(device.model, 160) && { model: device.model }), ...(boundedText(device.manufacturer, 160) && { manufacturer: device.manufacturer }) };
  });
  return { configured: value.configured, configurationId: value.configurationId, devices };
}

// Device GETs and explicit Wake actions share bounded, deadline-owned HTTP reads.
export async function requestDeviceJson(url, { method = 'GET', signal, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 12000, maxBytes = MAX_DEVICE_RESPONSE_BYTES } = {}) {
  const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const interrupted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error(method === 'POST' ? 'Wake request timed out or was canceled. Its outcome is uncertain; do not assume the packet was not sent.' : 'Device request timed out or was canceled.')), { once: true }));
  const deadline = schedule(abort, timeoutMs); let response;
  if (signal?.aborted) abort();
  try {
    return await Promise.race([(async () => {
      response = await fetchImpl(url, { method, credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('Device request canceled.');
      if (Number(response.headers?.get('content-length')) > maxBytes) throw new Error('Device response is too large.');
      let data;
      if (response.body?.getReader) {
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        const stop = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', stop, { once: true });
        try {
          for (;;) { const { value, done } = await reader.read(); if (controller.signal.aborted) throw new Error('Device request canceled.'); if (done) break; size += value.byteLength; if (size > maxBytes) throw new Error('Device response is too large.'); chunks.push(value); }
          const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
          data = JSON.parse(new TextDecoder().decode(bytes));
        } finally { controller.signal.removeEventListener('abort', stop); await reader.cancel().catch(() => {}); reader.releaseLock(); }
      } else { data = await response.json(); if (new TextEncoder().encode(JSON.stringify(data)).length > maxBytes) throw new Error('Device response is too large.'); }
      if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error.slice(0, 300) : 'Device request failed.'), { status: response.status, code: data?.code });
      return data;
    })(), interrupted]);
  } catch (error) {
    controller.abort();
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
    if (error.status || /too large|timed out|canceled/.test(error.message)) throw error;
    throw new Error(method === 'POST' ? 'Wake request failed. Its outcome is uncertain; check the computer before retrying.' : 'Home Assistant device readings are unavailable.');
  } finally { cancel(deadline); signal?.removeEventListener('abort', abort); }
}

export function createHomeAssistantDeviceController({ onChange = () => {}, onConfigurationChanged = () => {}, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout, now = Date.now, timeoutMs = 12000 } = {}) {
  let configurationId = null; let configured = false; let enabled = false; let visible = false; let disposed = false;
  let generation = 0; let timer; let read; let devices = []; let error = ''; let discovered = false; let fetchedAt = null;
  const state = () => ({ configurationId, configured, devices, error, discovered, fetchedAt, loading: Boolean(read) });
  const emit = () => { if (!disposed) onChange(state()); };
  const active = () => configured && enabled && visible && !disposed;
  function invalidate() { generation++; cancel(timer); timer = undefined; read?.controller.abort(); read = undefined; }
  function arm() { cancel(timer); timer = undefined; if (active()) timer = schedule(() => { timer = undefined; void refresh(); }, DEVICE_SNAPSHOT_POLL_MS); }
  function refresh() {
    if (!active()) return Promise.resolve();
    if (read) return read.promise;
    cancel(timer); timer = undefined;
    const owner = { generation, configurationId, controller: new AbortController(), promise: null }; read = owner;
    owner.promise = (async () => {
      try {
        const next = decodeDeviceSnapshot(await requestDeviceJson('/api/home-assistant/devices?controls=0', { signal: owner.controller.signal, fetchImpl, schedule, cancel, timeoutMs }));
        if (read !== owner || owner.generation !== generation || !active()) return;
        if (!next.configured || next.configurationId !== owner.configurationId) { error = 'Home Assistant configuration changed. Reloading saved status.'; await onConfigurationChanged(); return; }
        devices = next.devices; discovered = true; fetchedAt = now(); error = '';
      } catch (failure) {
        if (read === owner && owner.generation === generation && active()) { error = failure.message; if (failure.status === 409) await onConfigurationChanged(); }
      } finally { if (read === owner) { read = undefined; emit(); arm(); } }
    })();
    emit(); return owner.promise;
  }
  return {
    getState: state, refresh,
    configure(next) {
      const changed = configurationId !== next.configurationId || configured !== next.configured;
      const wasActive = active(); const needed = enabled !== next.enabled;
      configurationId = next.configurationId; configured = next.configured; enabled = next.enabled;
      if (changed) { invalidate(); devices = []; error = ''; discovered = false; fetchedAt = null; emit(); }
      if (!active()) { if (wasActive) invalidate(); }
      else if (changed || needed || !wasActive) void refresh();
    },
    setVisible(next) { if (next === visible || disposed) return; visible = next; if (next) void refresh(); else { invalidate(); emit(); } },
    dispose() { if (disposed) return; disposed = true; invalidate(); }
  };
}
