import { filterHomeDevices, flattenCollections, groupHomeDevices, homeControlPresentation, homeMeasurementPresentation, isLatestRequest, showDialogError } from './app-helpers.js';

export function selectedHomeDevices(devices, selections) {
  return selections.map((selection) => {
    const device = devices.find((item) => item.selectionId === selection.id);
    if (!device) return { name: 'Selected device unavailable', area: 'Unavailable', measurements: [], controls: [] };
    return { ...device, measurements: selection.readings.map((id) => device.measurements.find((reading) => reading.selectionId === id) ?? { name: 'Selected reading unavailable', available: false, status: 'unavailable', value: null }) };
  });
}

export function createHomeIntegrations({ document = globalThis.document, onDevices = () => {}, fetchImpl = fetch } = {}) {
let active = new Set(); let selections = []; let loadGeneration = 0; let bookmarkGeneration = 0; let homeStatusRequest = 0;
const state = { devices: [], bookmarks: new Map(), linkwarden: null, collections: [], collectionRequest: 0, homeAssistant: null, homeDevices: [], homeDeviceRequest: 0, homeAssistantRequest: 0, pendingHomeControls: new Set() };
const devicesElement = document.querySelector('#devices');
const statusElement = document.querySelector('#status');
const dialog = document.querySelector('#device-dialog');
const form = document.querySelector('#device-form');
const deviceError = document.querySelector('#device-error');
const bookmarkStatusElement = document.querySelector('#bookmark-status');
const linkwardenDialog = document.querySelector('#linkwarden-dialog');
const linkwardenForm = document.querySelector('#linkwarden-form');
const linkwardenError = document.querySelector('#linkwarden-error');
const collectionTreeElement = document.querySelector('#collection-tree');
const disconnectLinkwardenButton = document.querySelector('#disconnect-linkwarden');
const linkwardenAccountElement = document.querySelector('#linkwarden-account');
const homeAssistantDevicesElement = document.querySelector('#home-assistant-devices');
const homeAssistantStatusElement = document.querySelector('#home-assistant-status');
const homeAssistantAccountElement = document.querySelector('#home-assistant-account');
const homeAssistantToolbar = document.querySelector('#home-assistant-toolbar');
const homeDeviceSearch = document.querySelector('#home-device-search');
const refreshHomeDevicesButton = document.querySelector('#refresh-home-devices');
const disconnectHomeAssistantButton = document.querySelector('#disconnect-home-assistant');
const homeAssistantDialog = document.querySelector('#home-assistant-dialog');
const homeAssistantForm = document.querySelector('#home-assistant-form');
const homeAssistantError = document.querySelector('#home-assistant-error');
const homeAssistantSubmit = document.querySelector('#home-assistant-submit');
function setStatus(message = '', error = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', error);
}

async function api(path, options) {
  const response = await fetchImpl(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function button(text, className, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.className = className; element.addEventListener('click', action);
  return element;
}

function showDialog(target) {
  const launcher = document.activeElement;
  target.showModal();
  target.addEventListener('close', () => launcher?.focus(), { once: true });
}

function render() {
  devicesElement.replaceChildren();
  if (!state.devices.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No devices yet. Add devices in Home Settings.'; devicesElement.append(empty); return;
  }
  const groups = Map.groupBy(state.devices, (device) => device.group || 'Ungrouped');
  for (const [group, devices] of groups) {
    const section = document.createElement('section'); section.className = 'group';
    const title = document.createElement('h3'); title.textContent = group; section.append(title);
    const grid = document.createElement('div'); grid.className = 'device-grid';
    for (const device of devices) {
      const card = document.createElement('article'); card.className = 'device';
      const name = document.createElement('h3'); name.textContent = device.name;
      card.append(name);
      const details = document.createElement('p'); details.textContent = `${device.macAddress}${device.ipAddress ? ` · ${device.ipAddress}` : ''}`; card.append(details);
      const actions = document.createElement('div'); actions.className = 'device-actions';
      actions.append(button('Wake', 'button', () => wake(device)), button('Edit', 'text-button', () => openForm(device)), button('Remove', 'text-button', () => removeDevice(device)));
      card.append(actions); grid.append(card);
    }
    section.append(grid); devicesElement.append(section);
  }
}

function bookmarkGrid(bookmarks) {
  const grid = document.createElement('div'); grid.className = 'bookmark-grid';
  for (const bookmark of bookmarks) {
    const card = document.createElement('article'); card.className = 'bookmark';
    const link = document.createElement('a'); link.href = bookmark.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = bookmark.name; card.append(link);
    if (bookmark.description) { const description = document.createElement('p'); description.textContent = bookmark.description; card.append(description); }
    if (bookmark.tags?.length) { const tags = document.createElement('p'); tags.className = 'tags'; tags.textContent = bookmark.tags.join(' · '); card.append(tags); }
    grid.append(card);
  }
  return grid;
}

function setHomeAssistantStatus(message = '', error = false) {
  homeAssistantStatusElement.textContent = message;
  homeAssistantStatusElement.classList.toggle('error', error);
}

function renderHomeDevices(message = '', error = false) {
  homeAssistantDevicesElement.replaceChildren();
  const configured = Boolean(state.homeAssistant?.configured);
  const credentialsPresent = Boolean(state.homeAssistant?.accessTokenPresent);
  homeAssistantAccountElement.hidden = !credentialsPresent;
  homeAssistantAccountElement.textContent = credentialsPresent ? state.homeAssistant.baseUrl : '';
  homeAssistantToolbar.hidden = !configured;
  disconnectHomeAssistantButton.hidden = !credentialsPresent;
  refreshHomeDevicesButton.disabled = !configured;
  if (message) setHomeAssistantStatus(message, error);
  else if (state.homeAssistant?.needsReauthentication) setHomeAssistantStatus('Home Assistant needs re-authentication. Open settings and enter a new long-lived access token.', true);
  else if (!configured) setHomeAssistantStatus('Home Assistant is not connected. Open Home Assistant settings to connect.');
  else setHomeAssistantStatus();
  if (!configured) return;
  const chosen = selectedHomeDevices(state.homeDevices, selections);
  if (!selections.length) { setHomeAssistantStatus('Choose devices and readings in Home Settings.'); return; }
  const filtered = filterHomeDevices(chosen, homeDeviceSearch.value);
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = state.homeDevices.length ? 'No Home Assistant devices match that search.' : 'No devices are available in this Home Assistant registry.'; homeAssistantDevicesElement.append(empty); return;
  }
  for (const [area, devices] of groupHomeDevices(filtered)) {
    const section = document.createElement('section'); section.className = 'home-device-group';
    const title = document.createElement('h3'); title.textContent = area; section.append(title);
    const grid = document.createElement('div'); grid.className = 'home-device-grid';
    for (const device of devices) {
      const card = document.createElement('article'); card.className = 'home-device';
      const name = document.createElement('h4'); name.textContent = device.name; card.append(name);
      const details = [device.manufacturer, device.model].filter(Boolean).join(' · ');
      if (details) { const metadata = document.createElement('p'); metadata.textContent = details; card.append(metadata); }
      if (device.disabled) { const disabled = document.createElement('p'); disabled.className = 'device-state'; disabled.textContent = 'Disabled in Home Assistant'; card.append(disabled); }
      if (device.measurements?.length) {
        const readings = document.createElement('div'); readings.className = 'home-readings';
        const readingsTitle = document.createElement('p'); readingsTitle.className = 'home-card-label'; readingsTitle.textContent = 'Readings';
        const list = document.createElement('dl'); list.className = 'home-reading-list';
        for (const measurement of device.measurements) {
          const row = document.createElement('div'); row.className = 'home-reading';
          const name = document.createElement('dt'); name.textContent = measurement.name;
          const value = document.createElement('dd');
          const presentation = homeMeasurementPresentation(measurement);
          value.classList.toggle('unavailable', presentation.unavailable);
          const readingValue = document.createElement('span'); readingValue.className = 'home-reading-value'; readingValue.textContent = presentation.text;
          value.append(readingValue);
          if (presentation.unit) { const unit = document.createElement('span'); unit.className = 'home-reading-unit'; unit.textContent = presentation.unit; value.append(' ', unit); }
          row.append(name, value); list.append(row);
        }
        readings.append(readingsTitle, list); card.append(readings);
      }
      if (device.controls?.length) {
        const controls = document.createElement('div'); controls.className = 'home-controls';
        const controlsTitle = document.createElement('p'); controlsTitle.className = 'home-card-label'; controlsTitle.textContent = 'Controls'; controls.append(controlsTitle);
        for (const control of device.controls) {
          const row = document.createElement('div'); row.className = 'home-control';
          const summary = document.createElement('div'); summary.className = 'home-control-summary';
          const label = document.createElement('span'); label.className = 'home-control-name'; label.textContent = control.name;
          const currentState = document.createElement('span'); currentState.className = `home-control-state ${control.state}`; currentState.textContent = control.state;
          summary.append(label, currentState);
          const pending = state.pendingHomeControls.has(control.controlToken);
          const presentation = homeControlPresentation(control, pending);
          const actionButton = button(presentation.text, 'button secondary home-control-button', () => controlHomeAssistant(control, presentation.action));
          actionButton.disabled = presentation.disabled;
          actionButton.ariaLabel = `${presentation.action === 'turn_on' ? 'Turn on' : 'Turn off'} ${control.name}`;
          actionButton.setAttribute('aria-pressed', presentation.pressed ? 'true' : 'false');
          row.append(summary, actionButton); controls.append(row);
        }
        card.append(controls);
      }
      grid.append(card);
    }
    section.append(grid); homeAssistantDevicesElement.append(section);
  }
}

async function loadHomeDevices(refresh = false, actionMessage = '') {
  const request = ++state.homeDeviceRequest;
  setHomeAssistantStatus('Loading Home Assistant devices…');
  try {
    const result = await api(`/api/home-assistant/devices${refresh ? '?refresh=1' : ''}`);
    if (!isLatestRequest(state.homeDeviceRequest, request)) return;
    state.homeDevices = result.devices; onDevices(state.homeDevices); renderHomeDevices(actionMessage);
  } catch (error) { if (isLatestRequest(state.homeDeviceRequest, request)) renderHomeDevices(actionMessage ? `${actionMessage} Refresh failed: ${error.message}` : error.message, true); }
}

async function controlHomeAssistant(control, action) {
  if (!control.available || state.pendingHomeControls.has(control.controlToken)) return;
  const connectionRequest = state.homeAssistantRequest;
  state.pendingHomeControls.add(control.controlToken);
  renderHomeDevices(`${action === 'turn_on' ? 'Turning on' : 'Turning off'} ${control.name}…`);
  try {
    const result = await api(`/api/home-assistant/controls/${encodeURIComponent(control.controlToken)}`, { method: 'POST', body: JSON.stringify({ action }) });
    if (!isLatestRequest(state.homeAssistantRequest, connectionRequest)) return;
    state.pendingHomeControls.delete(control.controlToken);
    if (active.has('home-assistant')) await loadHomeDevices(true, result.message);
  } catch (error) {
    state.pendingHomeControls.delete(control.controlToken);
    if (isLatestRequest(state.homeAssistantRequest, connectionRequest)) renderHomeDevices(error.message, true);
  }
}

async function loadHomeAssistant() {
  const request = ++homeStatusRequest;
  try {
    const homeAssistant = (await api('/api/home-assistant')).homeAssistant;
    if (!isLatestRequest(homeStatusRequest, request)) return;
    state.homeAssistant = homeAssistant;
    renderHomeDevices();
    if (state.homeAssistant.configured) await loadHomeDevices();
  } catch (error) { if (isLatestRequest(homeStatusRequest, request)) renderHomeDevices(error.message, true); }
}

function renderCollectionTree(message = '') {
  collectionTreeElement.replaceChildren();
  collectionTreeElement.hidden = !state.linkwarden?.configured;
  disconnectLinkwardenButton.hidden = !state.linkwarden?.configured;
  linkwardenAccountElement.hidden = !state.linkwarden?.configured;
  linkwardenAccountElement.textContent = state.linkwarden?.configured ? `${state.linkwarden.username} · ${state.linkwarden.baseUrl}` : '';
  bookmarkStatusElement.textContent = message;
  if (!state.linkwarden?.configured) { bookmarkStatusElement.textContent = 'Bookmarks are not connected. Open Home Settings to connect Linkwarden.'; return; }
  if (!state.collections.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No collections are available for this account.'; collectionTreeElement.append(empty); return; }
  const renderNodes = (collections) => {
    const list = document.createElement('ul');
    for (const collection of collections) {
      const item = document.createElement('li');
      const name = document.createElement('div'); name.className = 'collection-node'; name.textContent = collection.name; item.append(name);
      const bookmarks = state.bookmarks.get(collection.collectionToken);
      if (bookmarks?.length) item.append(bookmarkGrid(bookmarks));
      if (collection.children.length) item.append(renderNodes(collection.children));
      list.append(item);
    }
    return list;
  };
  collectionTreeElement.append(renderNodes(state.collections));
}

async function load() {
  const request = ++loadGeneration;
  try { const result = await api('/api/devices'); if (request !== loadGeneration) return; state.devices = result.devices; render(); } catch (error) { if (request === loadGeneration) setStatus(error.message, true); }
}

async function loadBookmarks() {
  const collections = flattenCollections(state.collections);
  if (!collections.length) { renderCollectionTree(); return; }
  const request = ++bookmarkGeneration;
  bookmarkStatusElement.textContent = 'Loading bookmarks…';
  const results = [];
  for (let offset = 0; offset < collections.length; offset += 6) {
    results.push(...await Promise.allSettled(collections.slice(offset, offset + 6).map(async (collection) => {
      const query = new URLSearchParams({ collection: collection.collectionToken });
      return { collection, result: await api(`/api/bookmarks?${query}`) };
    })));
    if (request !== bookmarkGeneration) return;
  }
  if (results.every((result) => result.status === 'rejected' && result.reason.message.startsWith('Select a collection'))) { await loadCollections(); return; }
  const bookmarks = new Map(state.bookmarks);
  let failed = 0; let stale = 0;
  for (const result of results) {
    if (result.status === 'rejected') { failed++; continue; }
    bookmarks.set(result.value.collection.collectionToken, result.value.result.bookmarks);
    if (result.value.result.stale) stale++;
  }
  state.bookmarks = bookmarks;
  const message = failed ? `${failed} bookmark folder(s) could not be loaded.` : stale ? 'Showing recently cached bookmarks while Linkwarden is unavailable.' : '';
  renderCollectionTree(message);
}

async function loadCollections() {
  const request = ++state.collectionRequest;
  state.bookmarks = new Map();
  bookmarkStatusElement.textContent = 'Loading collections…';
  try { const collections = (await api('/api/linkwarden/collections')).collections; if (request !== state.collectionRequest) return; state.collections = collections; renderCollectionTree(); await loadBookmarks(); }
  catch (error) { if (request !== state.collectionRequest) return; state.collections = []; renderCollectionTree(error.message); }
}

async function loadLinkwarden() {
  const request = ++state.collectionRequest;
  try { const result = await api('/api/linkwarden'); if (request !== state.collectionRequest) return; state.linkwarden = result.linkwarden; renderCollectionTree(); if (state.linkwarden.configured) await loadCollections(); } catch (error) { if (request === state.collectionRequest) bookmarkStatusElement.textContent = error.message; }
}

function wakeRequest(device) {
  return api(`/api/devices/${device.id}/wake`, { method: 'POST', body: '{}' });
}

async function wake(device) {
  setStatus(`Sending wake packet to ${device.name}…`);
  try { setStatus((await wakeRequest(device)).message); if (active.has('wol')) await load(); } catch (error) { setStatus(error.message, true); }
}

async function removeDevice(device) {
  if (!window.confirm(`Remove ${device.name}? This cannot be undone.`)) return;
  try { await api(`/api/devices/${device.id}`, { method: 'DELETE' }); setStatus(`${device.name} removed.`); await load(); } catch (error) { setStatus(error.message, true); }
}

function openForm(device = null) {
  form.reset();
  showDialogError(deviceError);
  document.querySelector('#dialog-title').textContent = device ? 'Edit device' : 'Add device';
  for (const [key, selector] of Object.entries({ id: '#device-id', name: '#name', macAddress: '#mac', broadcastAddress: '#broadcast', ipAddress: '#ip', group: '#group' })) document.querySelector(selector).value = device?.[key] ?? '';
  showDialog(dialog);
}

document.querySelector('#cancel').addEventListener('click', () => dialog.close());
document.querySelector('#dialog-close').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showDialogError(deviceError);
  const id = document.querySelector('#device-id').value;
  const payload = Object.fromEntries(new FormData(form));
  try {
    await api(id ? `/api/devices/${id}` : '/api/devices', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    dialog.close(); setStatus(id ? 'Device updated.' : 'Device added.'); await load();
  } catch (error) { showDialogError(deviceError, error.message); }
});
function openLinkwardenForm() {
  const settings = state.linkwarden;
  linkwardenForm.reset(); linkwardenError.textContent = '';
  document.querySelector('#linkwarden-url').value = settings?.baseUrl ?? '';
  document.querySelector('#linkwarden-username').value = settings?.username ?? '';
  document.querySelector('#linkwarden-help').textContent = settings?.encryptionReady ? 'The access token is encrypted on this server and never shown again. Leave it blank to retain the configured token.' : 'Set a valid server encryption key before connecting Linkwarden.';
  showDialog(linkwardenDialog);
}

document.querySelector('#linkwarden-close').addEventListener('click', () => linkwardenDialog.close());
disconnectLinkwardenButton.addEventListener('click', async () => {
  if (!window.confirm('Disconnect Linkwarden and delete its saved API key?')) return;
  try { await api('/api/linkwarden', { method: 'DELETE' }); state.collectionRequest += 1; state.collections = []; state.bookmarks = new Map(); await loadLinkwarden(); } catch (error) { bookmarkStatusElement.textContent = error.message; }
});
linkwardenForm.addEventListener('submit', async (event) => {
  event.preventDefault(); linkwardenError.textContent = '';
  try {
    const result = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(linkwardenForm))) });
    state.collectionRequest += 1; bookmarkGeneration++; state.linkwarden = result.linkwarden; state.collections = result.collections; state.bookmarks = new Map();
    linkwardenDialog.close(); renderCollectionTree(); await loadBookmarks();
  } catch (error) { linkwardenError.textContent = error.message; }
});

function openHomeAssistantForm() {
  homeAssistantForm.reset(); showDialogError(homeAssistantError);
  document.querySelector('#home-assistant-url').value = state.homeAssistant?.baseUrl ?? '';
  document.querySelector('#home-assistant-help').textContent = state.homeAssistant?.needsReauthentication ? 'The saved token cannot be read. Enter a new long-lived access token to reconnect.' : state.homeAssistant?.encryptionReady ? 'The access token is encrypted on this server and never shown again. Leave it blank to retain the token when the URL is unchanged.' : 'Set a valid server encryption key before connecting Home Assistant.';
  showDialog(homeAssistantDialog);
}

document.querySelector('#home-assistant-close').addEventListener('click', () => homeAssistantDialog.close());
homeDeviceSearch.addEventListener('input', () => renderHomeDevices());
refreshHomeDevicesButton.addEventListener('click', () => loadHomeDevices(true));
disconnectHomeAssistantButton.addEventListener('click', async () => {
  if (!window.confirm('Disconnect Home Assistant and delete its saved access token?')) return;
  const request = ++state.homeAssistantRequest;
  homeStatusRequest++; state.homeDeviceRequest++;
  try {
    await api('/api/home-assistant', { method: 'DELETE' });
    if (!isLatestRequest(state.homeAssistantRequest, request)) return;
    state.homeDeviceRequest += 1; state.pendingHomeControls.clear(); state.homeAssistant = { configured: false, accessTokenPresent: false, needsReauthentication: false, encryptionReady: state.homeAssistant?.encryptionReady }; state.homeDevices = []; onDevices([]); homeDeviceSearch.value = ''; renderHomeDevices();
  } catch (error) { if (isLatestRequest(state.homeAssistantRequest, request)) renderHomeDevices(error.message, true); }
});
homeAssistantForm.addEventListener('submit', async (event) => {
  event.preventDefault(); showDialogError(homeAssistantError); homeAssistantSubmit.disabled = true;
  const request = ++state.homeAssistantRequest;
  homeStatusRequest++; state.homeDeviceRequest++;
  try {
    const result = await api('/api/home-assistant', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(homeAssistantForm))) });
    if (!isLatestRequest(state.homeAssistantRequest, request)) return;
    state.homeDeviceRequest += 1; state.pendingHomeControls.clear(); state.homeAssistant = result.homeAssistant; state.homeDevices = result.devices; onDevices(state.homeDevices); homeDeviceSearch.value = '';
    homeAssistantDialog.close(); renderHomeDevices('Home Assistant connected.');
  } catch (error) { if (isLatestRequest(state.homeAssistantRequest, request)) showDialogError(homeAssistantError, error.message); }
  finally { homeAssistantSubmit.disabled = false; }
});

return {
  configure(ids, selected) {
    selections = selected; renderHomeDevices();
    const next = new Set(ids);
    if (!next.has('wol') && active.has('wol')) loadGeneration++;
    if (!next.has('bookmarks') && active.has('bookmarks')) { state.collectionRequest++; bookmarkGeneration++; }
    if (!next.has('home-assistant') && active.has('home-assistant')) { state.homeDeviceRequest++; homeStatusRequest++; }
    if (next.has('wol') && !active.has('wol')) void load();
    if (next.has('bookmarks') && !active.has('bookmarks')) void loadLinkwarden();
    if (next.has('home-assistant') && !active.has('home-assistant')) void loadHomeAssistant();
    active = next;
  },
  async openSettings(type) {
    if (type === 'bookmarks') { await loadLinkwarden(); openLinkwardenForm(); }
    if (type === 'home-assistant') { await loadHomeAssistant(); openHomeAssistantForm(); }
    if (type === 'wol') openForm();
  },
  async devices() { await loadHomeAssistant(); return state.homeDevices; },
  suspend() { active = new Set(); loadGeneration++; bookmarkGeneration++; state.collectionRequest++; state.homeDeviceRequest++; homeStatusRequest++; }
};
}
