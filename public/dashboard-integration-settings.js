import { createHomeAssistantController, homeAssistantOrigin } from './dashboard-home-assistant.js';
import { createWolController } from './dashboard-wol.js';
import { SETTINGS_POLL_MS } from './dashboard-settings-sync.js';

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
    dispose() { disposed = true; active = false; cancel(timer); for (const controller of controllers) controller.dispose(); }
  };
}

export function createIntegrationSettings({ document, confirm = (message) => window.confirm(message) }) {
  const $ = (id) => document.getElementById(id);
  const haForm = $('home-assistant-connection'); const wolForm = $('wol-device-form');
  let session = 0; let opened = false; let visible = true; let disposed = false;
  let haDirty = false; let editor = 0; let editingId = null; let wolDirty = false; let baseline = '';
  const rows = new Map();
  const fields = { name: 'wol-name', macAddress: 'wol-mac', broadcastAddress: 'wol-broadcast', ipAddress: 'wol-ip', group: 'wol-group' };
  const values = (device) => JSON.stringify(Object.keys(fields).map((key) => device?.[key] ?? ''));
  function setFields(device) { for (const [key, id] of Object.entries(fields)) $(id).value = device?.[key] ?? ''; baseline = values(device); wolDirty = false; }
  function tokenGuidance() {
    const state = homeAssistant.getState(); const origin = homeAssistantOrigin($('home-assistant-url').value);
    $('home-assistant-url').setCustomValidity(origin || !$('home-assistant-url').value ? '' : 'Enter an http or https origin without credentials, a path, query, or fragment.');
    $('home-assistant-token').required = !state.configured || state.needsReauthentication || !origin || origin !== state.baseUrl;
  }
  function renderHomeAssistant(state) {
    if (disposed) return;
    const saved = !state.discovered ? 'Loading saved Home Assistant connection…' : state.needsReauthentication ? 'Home Assistant needs re-authentication. Enter a new token.' : !state.encryptionReady ? 'Home Assistant credential encryption is unavailable on this server.' : state.configured ? `Saved connection: ${state.baseUrl}` : 'Home Assistant is not connected.';
    $('home-assistant-status').textContent = state.error ? `${saved} ${state.error}` : saved;
    if (opened && !haDirty && state.discovered) $('home-assistant-url').value = state.baseUrl;
    for (const control of haForm.elements) control.disabled = state.mutationPending;
    $('connect-home-assistant').disabled = state.mutationPending || !state.discovered || !state.encryptionReady;
    $('disconnect-home-assistant').disabled = state.mutationPending || !state.accessTokenPresent;
    tokenGuidance();
  }
  function changeEditor(device) {
    editor++; editingId = device?.id ?? null; setFields(device);
    $('wol-editor-title').textContent = editingId === null ? 'Add device' : `Edit ${device.name}`;
    $('save-wol-device').textContent = editingId === null ? 'Add device' : 'Save device';
    $('cancel-wol-edit').hidden = editingId === null;
    $('wol-editor-status').textContent = ''; $('wol-settings-status').textContent = '';
  }
  async function action(controller, work, message, statusId, success = () => {}) {
    const owner = session; const selection = editor;
    $(statusId).textContent = 'Saving server settings…';
    try {
      await work();
      if (!disposed && opened && owner === session && (controller !== wol || selection === editor)) { success(); $(statusId).textContent = message; }
    } catch (failure) {
      if (!disposed && opened && owner === session && (controller !== wol || selection === editor)) $(statusId).textContent = failure.status === 404 ? 'This device was removed in another browser. Your draft is kept; cancel editing to add a new device.' : failure.message;
    }
  }
  function makeRow(device) {
    const node = document.createElement('li'); const title = document.createElement('strong'); const details = document.createElement('p'); const actions = document.createElement('div'); actions.className = 'integration-actions';
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = 'Edit';
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Delete';
    edit.addEventListener('click', () => { const saved = wol.getState().devices.find((item) => item.id === device.id); if (saved && !wol.getState().mutationPending) { changeEditor(saved); $('wol-name').focus(); } });
    remove.addEventListener('click', () => {
      const saved = wol.getState().devices.find((item) => item.id === device.id);
      if (!saved || wol.getState().mutationPending || !confirm(`Delete ${saved.name}? Its saved wake audit records will also be deleted.`)) return;
      void action(wol, () => wol.remove(saved.id), 'Device deleted.', 'wol-settings-status', () => { if (editingId === saved.id) changeEditor(null); $('wol-name').focus(); });
    });
    actions.append(edit, remove); node.append(title, details, actions);
    return { node, title, details, edit, remove };
  }
  function renderWol(state) {
    if (disposed) return;
    $('wol-status').textContent = state.error || (!state.discovered ? 'Loading saved devices…' : state.devices.length ? `${state.devices.length} saved device${state.devices.length === 1 ? '' : 's'}.` : 'No devices saved.');
    const retained = new Set();
    for (const device of state.devices) {
      let row = rows.get(device.id);
      if (!row) { row = makeRow(device); rows.set(device.id, row); $('wol-devices').append(row.node); }
      retained.add(device.id); row.title.textContent = device.name;
      row.details.textContent = `${device.macAddress} · Broadcast ${device.broadcastAddress}${device.ipAddress ? ` · IP ${device.ipAddress}` : ''}${device.group ? ` · ${device.group}` : ''}`;
      row.edit.setAttribute('aria-label', `Edit ${device.name}`); row.remove.setAttribute('aria-label', `Delete ${device.name}`);
      row.edit.disabled = state.mutationPending; row.remove.disabled = state.mutationPending;
    }
    for (const [id, row] of rows) if (!retained.has(id)) { row.node.remove(); rows.delete(id); }
    for (const control of wolForm.elements) control.disabled = state.mutationPending;
    $('save-wol-device').disabled = state.mutationPending || !state.discovered;
    if (editingId !== null && state.discovered) {
      const saved = state.devices.find((device) => device.id === editingId);
      $('wol-editor-status').textContent = !saved ? 'This device was removed in another browser. Your draft is kept; cancel editing to add a new device.' : baseline !== values(saved) ? 'Saved values changed. Cancel and select Edit again to reload, or explicitly save your draft.' : '';
      if (saved && !wolDirty && !state.mutationPending) { setFields(saved); $('wol-editor-status').textContent = ''; }
    }
  }
  const homeAssistant = createHomeAssistantController({ onChange: renderHomeAssistant });
  const wol = createWolController({ onChange: renderWol });
  const poller = createIntegrationPoller([homeAssistant, wol]);
  const updateActive = () => poller.setActive(opened && visible && !disposed);
  haForm.addEventListener('input', () => { haDirty = true; tokenGuidance(); });
  haForm.addEventListener('submit', (event) => {
    event.preventDefault(); tokenGuidance(); if (!haForm.reportValidity() || homeAssistant.getState().mutationPending) return;
    void action(homeAssistant, () => homeAssistant.connect({ url: $('home-assistant-url').value, accessToken: $('home-assistant-token').value }), 'Home Assistant connected.', 'home-assistant-settings-status', () => { $('home-assistant-token').value = ''; haDirty = false; renderHomeAssistant(homeAssistant.getState()); });
  });
  $('disconnect-home-assistant').addEventListener('click', () => {
    if (homeAssistant.getState().mutationPending || !confirm('Disconnect Home Assistant and delete its saved access token?')) return;
    void action(homeAssistant, () => homeAssistant.disconnect(), 'Home Assistant disconnected.', 'home-assistant-settings-status', () => { $('home-assistant-token').value = ''; haDirty = false; renderHomeAssistant(homeAssistant.getState()); });
  });
  wolForm.addEventListener('input', () => { wolDirty = true; });
  wolForm.addEventListener('submit', (event) => {
    event.preventDefault(); if (!wolForm.reportValidity() || wol.getState().mutationPending) return;
    const input = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, $(id).value]));
    void action(wol, () => wol.save(input, editingId), 'Device saved.', 'wol-settings-status', () => changeEditor(null));
  });
  $('cancel-wol-edit').addEventListener('click', () => { if (!wol.getState().mutationPending) { changeEditor(null); $('wol-name').focus(); } });
  return {
    open() { if (disposed) return; session++; opened = true; $('home-assistant-settings-status').textContent = ''; $('wol-settings-status').textContent = ''; renderHomeAssistant(homeAssistant.getState()); renderWol(wol.getState()); updateActive(); },
    close() { session++; opened = false; $('home-assistant-token').value = ''; updateActive(); },
    setVisible(next) { visible = next; updateActive(); },
    suspend() { session++; visible = false; updateActive(); },
    dispose() { disposed = true; session++; $('home-assistant-token').value = ''; poller.dispose(); }
  };
}
