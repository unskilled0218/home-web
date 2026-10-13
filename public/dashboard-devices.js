import { createHomeAssistantController } from './dashboard-home-assistant.js';
import { createWolController } from './dashboard-wol.js';
import { createHomeAssistantDeviceController, requestDeviceJson } from './dashboard-home-assistant-devices.js';
import { SETTINGS_POLL_MS } from './dashboard-settings-sync.js';
import { normalizeDeviceSelections } from './dashboard-helpers.js';

export function createIntegrationPoller(controllers, { schedule = setTimeout, cancel = clearTimeout } = {}) {
  let active = false; let timer; let disposed = false;
  function tick() {
    if (!active || disposed) return;
    for (const controller of controllers) void controller.refresh().catch(() => {});
    timer = schedule(tick, SETTINGS_POLL_MS);
  }
  return {
    setActive(next) {
      if (disposed || next === active) return;
      active = next; cancel(timer); timer = undefined;
      for (const controller of controllers) controller.setPaused(!next);
      if (next) tick();
    },
    dispose() { if (disposed) return; disposed = true; active = false; cancel(timer); for (const controller of controllers) controller.dispose(); }
  };
}

export function createDashboardDevices({ onChange = () => {}, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout, now = Date.now, timeoutMs = 12000 } = {}) {
  let disposed = false; let visible = false; let pickerOpen = false; let selections = [];
  let actionSequence = 0; let actionMessage = ''; const pending = new Map();
  const options = { fetchImpl, schedule, cancel, timeoutMs };
  const homeAssistant = createHomeAssistantController(options);
  const wol = createWolController(options);
  const snapshots = createHomeAssistantDeviceController({ ...options, now, onChange: emit, onConfigurationChanged: () => homeAssistant.refresh() });
  const poller = createIntegrationPoller([homeAssistant, wol], { schedule, cancel });
  function state() { return { homeAssistant: homeAssistant.getState(), wol: wol.getState(), snapshot: snapshots.getState(), selections: [...selections], pendingIds: [...pending.keys()], actionMessage }; }
  function emit() { if (!disposed) onChange(state()); }
  function updateSnapshot() {
    const status = homeAssistant.getState();
    snapshots.configure({ configurationId: status.configurationId, configured: status.configured, enabled: pickerOpen || selections.length > 0 });
  }
  const unsubscribeHa = homeAssistant.subscribe(() => { updateSnapshot(); emit(); });
  const unsubscribeWol = wol.subscribe(() => {
    for (const [id, request] of pending) if (!wol.getState().devices.some((device) => device.id === id)) request.removed = true;
    emit();
  });
  async function wake(id) {
    if (disposed || pending.has(id)) return;
    const device = wol.getState().devices.find((value) => value.id === id);
    if (!device || !wol.getState().discovered) return;
    const owner = { controller: new AbortController(), sequence: ++actionSequence, removed: false }; pending.set(id, owner);
    actionMessage = `Sending a wake packet to ${device.name}…`; emit();
    try {
      const result = await requestDeviceJson(`/api/devices/${id}/wake`, { ...options, signal: owner.controller.signal, method: 'POST', maxBytes: 65536 });
      if (!result || typeof result.message !== 'string') throw new Error('Wake outcome is uncertain. Check the computer before retrying.');
      if (!disposed && owner.sequence === actionSequence) actionMessage = owner.removed ? 'A wake packet was sent for a device removed while the request was pending. This does not confirm that it powered on.' : `Wake packet sent to ${device.name}. This does not confirm that it powered on.`;
    } catch (failure) {
      if (!disposed && owner.sequence === actionSequence) actionMessage = owner.removed ? 'The device was removed while its wake request was pending. Its outcome may be uncertain.' : failure.message;
      if (failure.status === 404 && !disposed) void wol.refresh();
    } finally { if (pending.get(id) === owner) pending.delete(id); emit(); }
  }
  return {
    homeAssistant, wol, getState: state, wake,
    configure(next) {
      if (disposed) return;
      selections = normalizeDeviceSelections(next); updateSnapshot();
      const known = new Set(snapshots.getState().devices.map((device) => device.selectionId));
      if (selections.some((id) => !known.has(id))) void snapshots.refresh();
      emit();
    },
    setPickerOpen(next) { if (disposed) return; pickerOpen = next; updateSnapshot(); emit(); },
    refresh() { void homeAssistant.refresh(); void wol.refresh(); },
    setVisible(next) { if (disposed || visible === next) return; visible = next; snapshots.setVisible(next); poller.setActive(next); },
    dispose() { if (disposed) return; disposed = true; unsubscribeHa(); unsubscribeWol(); snapshots.dispose(); poller.dispose(); for (const owner of pending.values()) owner.controller.abort(); pending.clear(); }
  };
}
