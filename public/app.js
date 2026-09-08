const state = { devices: [], selected: new Set(), bookmarks: [], linkwarden: null, collections: [] };
const devicesElement = document.querySelector('#devices');
const statusElement = document.querySelector('#status');
const searchElement = document.querySelector('#search');
const selectedButton = document.querySelector('#wake-selected');
const dialog = document.querySelector('#device-dialog');
const form = document.querySelector('#device-form');
const bookmarksElement = document.querySelector('#bookmarks');
const bookmarkStatusElement = document.querySelector('#bookmark-status');
const linkwardenDialog = document.querySelector('#linkwarden-dialog');
const linkwardenForm = document.querySelector('#linkwarden-form');
const linkwardenError = document.querySelector('#linkwarden-error');

function setStatus(message = '', error = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle('error', error);
}

async function api(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = response.status === 204 ? {} : await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function button(text, className, action) {
  const element = document.createElement('button');
  element.type = 'button'; element.textContent = text; element.className = className; element.addEventListener('click', action);
  return element;
}

function render() {
  const term = searchElement.value.trim().toLowerCase();
  const filtered = state.devices.filter((device) => [device.name, device.group, device.macAddress, device.ipAddress].filter(Boolean).join(' ').toLowerCase().includes(term));
  selectedButton.disabled = state.selected.size === 0;
  selectedButton.textContent = state.selected.size ? `Wake selected (${state.selected.size})` : 'Wake selected';
  devicesElement.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = state.devices.length ? 'No devices match that search.' : 'No devices yet. Add the first computer on your LAN.'; devicesElement.append(empty); return;
  }
  const groups = Map.groupBy(filtered, (device) => device.group || 'Ungrouped');
  for (const [group, devices] of groups) {
    const section = document.createElement('section'); section.className = 'group';
    const title = document.createElement('h2'); title.textContent = group; section.append(title);
    const grid = document.createElement('div'); grid.className = 'device-grid';
    for (const device of devices) {
      const card = document.createElement('article'); card.className = 'device';
      const top = document.createElement('div'); top.className = 'device-top';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'select'; checkbox.checked = state.selected.has(device.id); checkbox.ariaLabel = `Select ${device.name}`;
      checkbox.addEventListener('change', () => { checkbox.checked ? state.selected.add(device.id) : state.selected.delete(device.id); render(); });
      const name = document.createElement('h3'); name.textContent = device.name;
      top.append(checkbox, name); card.append(top);
      const details = document.createElement('p'); details.textContent = `${device.macAddress}${device.ipAddress ? ` · ${device.ipAddress}` : ''}`; card.append(details);
      const actions = document.createElement('div'); actions.className = 'device-actions';
      actions.append(button('Wake', 'button', () => wake(device)), button('Edit', 'text-button', () => openForm(device)), button('Remove', 'text-button', () => removeDevice(device)));
      card.append(actions); grid.append(card);
    }
    section.append(grid); devicesElement.append(section);
  }
}

function renderBookmarks(message = '') {
  bookmarksElement.replaceChildren();
  bookmarkStatusElement.textContent = message;
  if (!state.linkwarden?.configured) { bookmarkStatusElement.textContent = 'Bookmarks are not connected. Open Bookmarks settings to connect Linkwarden.'; return; }
  if (!state.bookmarks.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No valid bookmarks were found in this collection.'; bookmarksElement.append(empty); return; }
  for (const bookmark of state.bookmarks) {
    const card = document.createElement('article'); card.className = 'bookmark';
    const link = document.createElement('a'); link.href = bookmark.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = bookmark.name; card.append(link);
    if (bookmark.description) { const description = document.createElement('p'); description.textContent = bookmark.description; card.append(description); }
    if (bookmark.tags?.length) { const tags = document.createElement('p'); tags.className = 'tags'; tags.textContent = bookmark.tags.join(' · '); card.append(tags); }
    bookmarksElement.append(card);
  }
}

async function load() {
  try { state.devices = (await api('/api/devices')).devices; state.selected = new Set([...state.selected].filter((id) => state.devices.some((device) => device.id === id))); render(); } catch (error) { setStatus(error.message, true); }
}

async function loadBookmarks(refresh = false) {
  bookmarkStatusElement.textContent = 'Loading bookmarks…';
  try { const result = await api(`/api/bookmarks${refresh ? '?refresh=1' : ''}`); state.bookmarks = result.bookmarks; renderBookmarks(result.stale ? 'Showing recently cached bookmarks while Linkwarden is unavailable.' : ''); } catch (error) { renderBookmarks(error.message); }
}

async function loadLinkwarden() {
  try { state.linkwarden = (await api('/api/linkwarden')).linkwarden; renderBookmarks(); if (state.linkwarden.configured) await loadBookmarks(); } catch (error) { bookmarkStatusElement.textContent = error.message; }
}

async function wake(device) {
  setStatus(`Sending wake packet to ${device.name}…`);
  try { setStatus((await api(`/api/devices/${device.id}/wake`, { method: 'POST', body: '{}' })).message); await load(); } catch (error) { setStatus(error.message, true); }
}

async function removeDevice(device) {
  if (!window.confirm(`Remove ${device.name}? This cannot be undone.`)) return;
  try { await api(`/api/devices/${device.id}`, { method: 'DELETE' }); setStatus(`${device.name} removed.`); await load(); } catch (error) { setStatus(error.message, true); }
}

function openForm(device = null) {
  form.reset();
  document.querySelector('#dialog-title').textContent = device ? 'Edit device' : 'Add device';
  for (const [key, selector] of Object.entries({ id: '#device-id', name: '#name', macAddress: '#mac', broadcastAddress: '#broadcast', ipAddress: '#ip', group: '#group' })) document.querySelector(selector).value = device?.[key] ?? '';
  dialog.showModal();
}

document.querySelector('#new-device').addEventListener('click', () => openForm());
document.querySelector('#cancel').addEventListener('click', () => dialog.close());
document.querySelector('#dialog-close').addEventListener('click', () => dialog.close());
searchElement.addEventListener('input', render);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const id = document.querySelector('#device-id').value;
  const payload = Object.fromEntries(new FormData(form));
  try {
    await api(id ? `/api/devices/${id}` : '/api/devices', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    dialog.close(); setStatus(id ? 'Device updated.' : 'Device added.'); await load();
  } catch (error) { setStatus(error.message, true); }
});
selectedButton.addEventListener('click', async () => {
  const devices = state.devices.filter((device) => state.selected.has(device.id));
  selectedButton.disabled = true;
  const results = await Promise.allSettled(devices.map(wake));
  const failed = results.filter((result) => result.status === 'rejected').length;
  state.selected.clear(); render(); setStatus(failed ? `${failed} wake request(s) failed.` : `Wake packets sent to ${devices.length} device(s).`, Boolean(failed));
});
function openLinkwardenForm() {
  const settings = state.linkwarden;
  linkwardenForm.reset(); linkwardenError.textContent = '';
  document.querySelector('#linkwarden-url').value = settings?.baseUrl ?? '';
  document.querySelector('#linkwarden-username').value = settings?.username ?? '';
  const collectionSelect = document.querySelector('#linkwarden-collection');
  collectionSelect.disabled = true; collectionSelect.replaceChildren(new Option(settings?.collectionName ? `List collections to select ${settings.collectionName}` : 'List collections first', ''));
  document.querySelector('#disconnect-linkwarden').hidden = !settings?.configured;
  document.querySelector('#linkwarden-help').textContent = settings?.encryptionReady ? 'The access token is encrypted on this server and never shown again. Leave it blank to retain the configured token, then list and select a collection.' : 'Set a valid server encryption key before connecting Linkwarden.';
  linkwardenDialog.showModal();
}

function linkwardenPayload() { return Object.fromEntries(new FormData(linkwardenForm)); }

async function listLinkwardenCollections() {
  linkwardenError.textContent = '';
  const select = document.querySelector('#linkwarden-collection');
  select.disabled = true; select.replaceChildren(new Option('Loading collections…', ''));
  try {
    state.collections = (await api('/api/linkwarden/collections', { method: 'POST', body: JSON.stringify(linkwardenPayload()) })).collections;
    select.replaceChildren(new Option(state.collections.length ? 'Choose a collection' : 'No collections available', ''));
    for (const collection of state.collections) select.append(new Option(collection.name, collection.selectionToken));
    select.disabled = state.collections.length === 0;
    if (!state.collections.length) linkwardenError.textContent = 'No collections are available for this Linkwarden account.';
  } catch (error) { select.replaceChildren(new Option('List collections first', '')); linkwardenError.textContent = error.message; }
}

document.querySelector('#linkwarden-settings').addEventListener('click', openLinkwardenForm);
document.querySelector('#linkwarden-close').addEventListener('click', () => linkwardenDialog.close());
document.querySelector('#refresh-bookmarks').addEventListener('click', () => loadBookmarks(true));
document.querySelector('#list-linkwarden-collections').addEventListener('click', listLinkwardenCollections);
document.querySelector('#test-linkwarden').addEventListener('click', async () => {
  linkwardenError.textContent = '';
  try { linkwardenError.textContent = (await api('/api/linkwarden/test', { method: 'POST', body: JSON.stringify(linkwardenPayload()) })).message; } catch (error) { linkwardenError.textContent = error.message; }
});
document.querySelector('#disconnect-linkwarden').addEventListener('click', async () => {
  if (!window.confirm('Disconnect Linkwarden and delete its saved API key?')) return;
  try { await api('/api/linkwarden', { method: 'DELETE' }); linkwardenDialog.close(); state.bookmarks = []; await loadLinkwarden(); } catch (error) { linkwardenError.textContent = error.message; }
});
linkwardenForm.addEventListener('submit', async (event) => {
  event.preventDefault(); linkwardenError.textContent = '';
  try { state.linkwarden = (await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify(linkwardenPayload()) })).linkwarden; linkwardenDialog.close(); await loadBookmarks(true); } catch (error) { linkwardenError.textContent = error.message; }
});
load(); loadLinkwarden();
