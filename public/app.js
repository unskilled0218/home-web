import { restoreCollectionFocus, runBulkWake, selectedButtonState, showDialogError, updateCollectionSelection, updateSelection } from './app-helpers.js';

const state = { devices: [], selected: new Set(), bulkWakePending: false, bookmarks: [], linkwarden: null, collections: [], activeCollectionToken: null, collectionRequest: 0 };
const devicesElement = document.querySelector('#devices');
const statusElement = document.querySelector('#status');
const searchElement = document.querySelector('#search');
const selectedButton = document.querySelector('#wake-selected');
const dialog = document.querySelector('#device-dialog');
const form = document.querySelector('#device-form');
const deviceError = document.querySelector('#device-error');
const bookmarksElement = document.querySelector('#bookmarks');
const bookmarkStatusElement = document.querySelector('#bookmark-status');
const linkwardenDialog = document.querySelector('#linkwarden-dialog');
const linkwardenForm = document.querySelector('#linkwarden-form');
const linkwardenError = document.querySelector('#linkwarden-error');
const collectionTreeElement = document.querySelector('#collection-tree');
const refreshBookmarksButton = document.querySelector('#refresh-bookmarks');
const disconnectLinkwardenButton = document.querySelector('#disconnect-linkwarden');
const linkwardenAccountElement = document.querySelector('#linkwarden-account');

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

function updateSelectedButton() {
  const presentation = selectedButtonState(state.selected.size, state.bulkWakePending);
  selectedButton.disabled = presentation.disabled;
  selectedButton.textContent = presentation.text;
}

function render() {
  const term = searchElement.value.trim().toLowerCase();
  const filtered = state.devices.filter((device) => [device.name, device.group, device.macAddress, device.ipAddress].filter(Boolean).join(' ').toLowerCase().includes(term));
  updateSelectedButton();
  devicesElement.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = state.devices.length ? 'No devices match that search.' : 'No devices yet. Add the first computer on your LAN.'; devicesElement.append(empty); return;
  }
  const groups = Map.groupBy(filtered, (device) => device.group || 'Ungrouped');
  for (const [group, devices] of groups) {
    const section = document.createElement('section'); section.className = 'group';
    const title = document.createElement('h3'); title.textContent = group; section.append(title);
    const grid = document.createElement('div'); grid.className = 'device-grid';
    for (const device of devices) {
      const card = document.createElement('article'); card.className = 'device';
      const top = document.createElement('div'); top.className = 'device-top';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'select'; checkbox.checked = state.selected.has(device.id); checkbox.ariaLabel = `Select ${device.name}`;
      checkbox.addEventListener('change', () => { updateSelection(state.selected, device.id, checkbox.checked); updateSelectedButton(); });
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
  if (!state.activeCollectionToken) { bookmarkStatusElement.textContent ||= 'Choose a collection to view its bookmarks.'; return; }
  if (!state.bookmarks.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No valid web links were found in this collection.'; bookmarksElement.append(empty); return; }
  for (const bookmark of state.bookmarks) {
    const card = document.createElement('article'); card.className = 'bookmark';
    const link = document.createElement('a'); link.href = bookmark.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = bookmark.name; card.append(link);
    if (bookmark.description) { const description = document.createElement('p'); description.textContent = bookmark.description; card.append(description); }
    if (bookmark.tags?.length) { const tags = document.createElement('p'); tags.className = 'tags'; tags.textContent = bookmark.tags.join(' · '); card.append(tags); }
    bookmarksElement.append(card);
  }
}

function renderCollectionTree() {
  const focusedKey = document.activeElement?.dataset?.collectionKey;
  collectionTreeElement.replaceChildren();
  collectionTreeElement.hidden = !state.linkwarden?.configured;
  disconnectLinkwardenButton.hidden = !state.linkwarden?.configured;
  linkwardenAccountElement.hidden = !state.linkwarden?.configured;
  linkwardenAccountElement.textContent = state.linkwarden?.configured ? `${state.linkwarden.username} · ${state.linkwarden.baseUrl}` : '';
  refreshBookmarksButton.disabled = !state.activeCollectionToken;
  if (!state.linkwarden?.configured) return;
  if (!state.collections.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No collections are available for this account.'; collectionTreeElement.append(empty); return; }
  const renderNodes = (collections, parentKey = '') => {
    const list = document.createElement('ul');
    for (const [index, collection] of collections.entries()) {
      const item = document.createElement('li');
      const select = button(collection.name, 'collection-node', () => selectCollection(collection));
      select.dataset.collectionToken = collection.collectionToken;
      select.dataset.collectionKey = `${parentKey}${index}`;
      select.classList.toggle('selected', collection.collectionToken === state.activeCollectionToken);
      select.setAttribute('aria-current', collection.collectionToken === state.activeCollectionToken ? 'true' : 'false');
      item.append(select);
      if (collection.children.length) item.append(renderNodes(collection.children, `${parentKey}${index}.`));
      list.append(item);
    }
    return list;
  };
  collectionTreeElement.append(renderNodes(state.collections));
  restoreCollectionFocus(collectionTreeElement, focusedKey);
}

async function load() {
  try { state.devices = (await api('/api/devices')).devices; state.selected = new Set([...state.selected].filter((id) => state.devices.some((device) => device.id === id))); render(); } catch (error) { setStatus(error.message, true); }
}

async function loadBookmarks(refresh = false) {
  if (!state.activeCollectionToken) { renderBookmarks(); return; }
  const collectionToken = state.activeCollectionToken;
  bookmarkStatusElement.textContent = 'Loading bookmarks…';
  const query = new URLSearchParams({ collection: collectionToken, ...(refresh && { refresh: '1' }) });
  try { const result = await api(`/api/bookmarks?${query}`); if (collectionToken !== state.activeCollectionToken) return; state.bookmarks = result.bookmarks; renderBookmarks(result.stale ? 'Showing recently cached bookmarks while Linkwarden is unavailable.' : ''); }
  catch (error) { if (collectionToken !== state.activeCollectionToken) return; if (error.message.startsWith('Select a collection')) { await loadCollections(); bookmarkStatusElement.textContent = 'The collection session expired. Choose a collection again.'; } else renderBookmarks(error.message); }
}

async function loadCollections() {
  const request = ++state.collectionRequest;
  state.activeCollectionToken = null; state.bookmarks = []; refreshBookmarksButton.disabled = true;
  bookmarkStatusElement.textContent = 'Loading collections…';
  try { const collections = (await api('/api/linkwarden/collections')).collections; if (request !== state.collectionRequest) return; state.collections = collections; renderCollectionTree(); renderBookmarks(); }
  catch (error) { if (request !== state.collectionRequest) return; state.collections = []; renderCollectionTree(); renderBookmarks(error.message); }
}

async function loadLinkwarden() {
  try { state.linkwarden = (await api('/api/linkwarden')).linkwarden; renderCollectionTree(); renderBookmarks(); if (state.linkwarden.configured) await loadCollections(); } catch (error) { bookmarkStatusElement.textContent = error.message; }
}

async function selectCollection(collection) {
  state.activeCollectionToken = collection.collectionToken; state.bookmarks = []; refreshBookmarksButton.disabled = false; updateCollectionSelection(collectionTreeElement, state.activeCollectionToken); await loadBookmarks();
}

function wakeRequest(device) {
  return api(`/api/devices/${device.id}/wake`, { method: 'POST', body: '{}' });
}

async function wake(device) {
  setStatus(`Sending wake packet to ${device.name}…`);
  try { setStatus((await wakeRequest(device)).message); await load(); } catch (error) { setStatus(error.message, true); }
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
  dialog.showModal();
}

document.querySelector('#new-device').addEventListener('click', () => openForm());
document.querySelector('#cancel').addEventListener('click', () => dialog.close());
document.querySelector('#dialog-close').addEventListener('click', () => dialog.close());
searchElement.addEventListener('input', render);
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
selectedButton.addEventListener('click', async () => {
  if (state.bulkWakePending) return;
  const devices = state.devices.filter((device) => state.selected.has(device.id));
  state.bulkWakePending = true;
  updateSelectedButton();
  try {
    const summary = await runBulkWake(devices, wakeRequest);
    state.selected.clear();
    await load();
    setStatus(summary.message, summary.error);
  } finally { state.bulkWakePending = false; updateSelectedButton(); }
});
function openLinkwardenForm() {
  const settings = state.linkwarden;
  linkwardenForm.reset(); linkwardenError.textContent = '';
  document.querySelector('#linkwarden-url').value = settings?.baseUrl ?? '';
  document.querySelector('#linkwarden-username').value = settings?.username ?? '';
  document.querySelector('#linkwarden-help').textContent = settings?.encryptionReady ? 'The access token is encrypted on this server and never shown again. Leave it blank to retain the configured token.' : 'Set a valid server encryption key before connecting Linkwarden.';
  linkwardenDialog.showModal();
}

document.querySelector('#linkwarden-settings').addEventListener('click', openLinkwardenForm);
document.querySelector('#linkwarden-close').addEventListener('click', () => linkwardenDialog.close());
refreshBookmarksButton.addEventListener('click', () => loadBookmarks(true));
disconnectLinkwardenButton.addEventListener('click', async () => {
  if (!window.confirm('Disconnect Linkwarden and delete its saved API key?')) return;
  try { await api('/api/linkwarden', { method: 'DELETE' }); state.collectionRequest += 1; state.collections = []; state.activeCollectionToken = null; state.bookmarks = []; await loadLinkwarden(); } catch (error) { bookmarkStatusElement.textContent = error.message; }
});
linkwardenForm.addEventListener('submit', async (event) => {
  event.preventDefault(); linkwardenError.textContent = '';
  try {
    const result = await api('/api/linkwarden', { method: 'PUT', body: JSON.stringify(Object.fromEntries(new FormData(linkwardenForm))) });
    state.collectionRequest += 1; state.linkwarden = result.linkwarden; state.collections = result.collections; state.activeCollectionToken = null; state.bookmarks = [];
    linkwardenDialog.close(); renderCollectionTree(); renderBookmarks();
  } catch (error) { linkwardenError.textContent = error.message; }
});
load(); loadLinkwarden();
