import { BOOKMARK_REFRESH_MS, MAX_BOOKMARK_RESPONSE_BYTES, MAX_BROWSER_BOOKMARKS, MAX_BROWSER_BYTES, bookmarkError, bookmarkProfile, defaultFolderOpen, jsonBytes, normalizeBookmarkLinks, normalizeCollectionTree } from './bookmark-data.js';
import { normalizeBookmarkSelections, selectedBookmarkProjection } from './bookmark-selection-data.js';

function normalizeStatus(data) {
  if (!data || typeof data.configured !== 'boolean' || (data.configured && data.configurationId === null) || (data.configurationId !== null && (typeof data.configurationId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(data.configurationId)))) throw new Error('Invalid Linkwarden status.');
  return { configured: data.configured, configurationId: data.configurationId, encryptionReady: data.encryptionReady === true, needsReauthentication: data.needsReauthentication === true, accessTokenPresent: data.accessTokenPresent === true, baseUrl: typeof data.baseUrl === 'string' ? data.baseUrl : '', username: typeof data.username === 'string' ? data.username : '' };
}

async function responseData(response, signal) {
  if (Number(response.headers?.get('content-length')) > MAX_BOOKMARK_RESPONSE_BYTES) throw new Error('Bookmark response exceeds the dashboard limit.');
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > MAX_BOOKMARK_RESPONSE_BYTES) throw new Error('Bookmark response exceeds the dashboard limit.'); chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function createBookmarkController({ onChange, fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 25000 }) {
  let status = { configured: false, configurationId: null, encryptionReady: false, needsReauthentication: false };
  let tree = []; let discovered = false; let error = ''; let blocked = false; let treeStale = false;
  let profile = 'desktop-expanded'; let hidden = false; let visible = true; let disposed = false;
  let generation = 0; let authority = 0; let timer; let discovery; let recovery; let recoveryUsed = false; let sourceRecoveryUsed = false; let mutation;
  let configurationEpoch = 0;
  let selections = null; let selectedIds = new Set(); let selectedFolders = new Set(); let pickerOpen = false; let accessOrder = 0;
  const pickerOverrides = new Map(); const explicitRequests = new Set();
  const folders = new Map(); const overrides = new Map(); const requests = new Set(); const queue = []; const active = new Map();
  const current = (job) => !disposed && job.generation === generation && folders.get(job.id) === job.folder;
  const open = (folder) => overrides.get(profile)?.get(folder.node.selectionId) ?? defaultFolderOpen(profile, folder.depth);
  const pickerFolderOpen = (folder) => pickerOverrides.get(folder.node.selectionId) ?? folder.depth === 0;
  const totals = () => [...folders.values()].reduce((sum, folder) => ({ count: sum.count + folder.bookmarks.length, bytes: sum.bytes + folder.bytes }), { count: 0, bytes: 0 });
  const limited = () => [...folders.values()].some((folder) => folder.budgetLimited);
  function snapshot() {
    const state = { ...status, discovered, tree, profile, hidden, error, treeStale, loadingTree: Boolean(discovery), mutationPending: Boolean(mutation), limit: limited(), selections, folders: Object.fromEntries([...folders].map(([id, folder]) => [id, { ...folder, node: undefined, parent: undefined, open: open(folder), pickerOpen: pickerFolderOpen(folder) }])) };
    return { ...state, dashboard: selectedBookmarkProjection(state, selections) };
  }
  const emit = () => { if (!disposed) onChange(snapshot()); };
  function arm() {
    cancel(timer); timer = undefined;
    if (!disposed && visible && !mutation) timer = schedule(() => { timer = undefined; void refresh(); }, BOOKMARK_REFRESH_MS);
  }
  function invalidateReads({ keepDiscovery = false } = {}) {
    generation++; cancel(timer); timer = undefined; queue.length = 0; explicitRequests.clear();
    for (const job of active.values()) job.folder.attempted = null;
    active.clear();
    if (!keepDiscovery) { authority++; discovery = undefined; }
    for (const request of requests) if (!request.mutation) request.controller.abort();
    for (const folder of folders.values()) folder.loading = false;
  }
  async function api(url, { method = 'GET', body, mutation: isMutation = false } = {}) {
    const controller = new AbortController(); const entry = { controller, mutation: isMutation }; requests.add(entry);
    const deadline = schedule(() => controller.abort(), timeoutMs); let response;
    try {
      const interrupted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Bookmark request canceled or timed out.')), { once: true }));
      return await Promise.race([(async () => {
        response = await fetchImpl(url, { method, signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) });
        if (controller.signal.aborted) { await response.body?.cancel().catch(() => {}); throw new Error('Bookmark request canceled.'); }
        if (response.status === 204) return null;
        const data = await responseData(response, controller.signal);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid Linkwarden response.');
        if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error.trim().slice(0, 300) || 'Linkwarden is unavailable.' : 'Linkwarden is unavailable.'), { code: typeof data.code === 'string' ? data.code.slice(0, 128) : undefined, status: response.status });
        return data;
      })(), interrupted]);
    } catch (failure) {
      controller.abort();
      if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
      throw failure;
    } finally { cancel(deadline); requests.delete(entry); }
  }
  function adopt(next) {
    const effective = { ...next, ...(blocked && next.configurationId === status.configurationId && { needsReauthentication: status.needsReauthentication, accessDenied: status.accessDenied }) };
    if (next.configurationId === status.configurationId && (!discovered || ['configured', 'encryptionReady', 'needsReauthentication', 'accessTokenPresent', 'baseUrl', 'username'].some((key) => effective[key] !== status[key]))) configurationEpoch++;
    if (next.configurationId !== status.configurationId) {
      configurationEpoch++;
      invalidateReads({ keepDiscovery: true }); folders.clear(); tree = []; overrides.clear(); pickerOverrides.clear(); blocked = false; treeStale = false;
    }
    status = { ...next, ...(blocked && { needsReauthentication: status.needsReauthentication, accessDenied: status.accessDenied }) };
    discovered = true;
    if (!next.configured) { folders.clear(); tree = []; }
    emit();
  }
  function installTree(data) {
    if (data.configurationId !== status.configurationId) throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
    const next = normalizeCollectionTree(data.collections); const retained = new Set();
    const walk = (nodes, depth = 0, parent = null) => {
      for (const node of nodes) {
        const old = folders.get(node.selectionId);
        const folder = old ?? { bookmarks: [], bytes: 0, loaded: false, loading: false, attempted: null, stale: false, truncated: false, budgetLimited: false, evicted: false, lastUsed: 0, error: '' };
        Object.assign(folder, { node, depth, parent }); folders.set(node.selectionId, folder);
        retained.add(node.selectionId); walk(node.children, depth + 1, node.selectionId);
      }
    };
    walk(next); tree = next;
    for (const id of folders.keys()) if (!retained.has(id)) folders.delete(id);
    for (const choices of overrides.values()) for (const id of choices.keys()) if (!retained.has(id)) choices.delete(id);
    for (const id of pickerOverrides.keys()) if (!retained.has(id)) pickerOverrides.delete(id);
    error = ''; treeStale = false;
  }
  function retire(failure) {
    configurationEpoch++;
    const authentication = failure.code === 'LINKWARDEN_AUTHENTICATION_REQUIRED' || failure.status === 401;
    invalidateReads(); tree = []; folders.clear(); blocked = true;
    status = { ...status, needsReauthentication: authentication, accessDenied: !authentication };
    error = failure.message; emit(); arm();
  }
  function rediscoverSource(failure) {
    const retry = !sourceRecoveryUsed; sourceRecoveryUsed = true;
    invalidateReads(); tree = []; folders.clear(); overrides.clear(); pickerOverrides.clear(); error = failure.message; treeStale = false; emit();
    if (retry) void refresh({ recoveryPass: true }); else arm();
  }
  function pickerDisclosed(folder) {
    if (!pickerOpen || !pickerFolderOpen(folder)) return false;
    let parent = folder.parent;
    while (parent) { const ancestor = folders.get(parent); if (!ancestor || !pickerFolderOpen(ancestor)) return false; parent = ancestor.parent; }
    return true;
  }
  function eligible(folder) { return folder.attempted === null || now() - folder.attempted >= BOOKMARK_REFRESH_MS; }
  function enqueue(id, explicit = false) {
    const folder = folders.get(id);
    if (!folder || !visible || disposed || mutation || blocked || !status.configured || active.has(id) || queue.includes(id) || (!explicit && !eligible(folder))) return;
    if (explicit) explicitRequests.add(id);
    queue.push(id); pump();
  }
  function queueRequired() {
    const required = [...folders].filter(([id, folder]) => selectedFolders.has(id) || (!folder.evicted && (folder.loaded || pickerDisclosed(folder))));
    required.sort(([left], [right]) => Number(selectedFolders.has(right)) - Number(selectedFolders.has(left)));
    for (const [id] of required) enqueue(id);
  }
  function reclaim(count, bytes, exclude) {
    const candidates = [...folders.values()].filter((folder) => folder !== exclude).sort((left, right) => Number(pickerDisclosed(left)) - Number(pickerDisclosed(right)) || left.lastUsed - right.lastUsed);
    let used = totals();
    for (const folder of candidates) {
      if (used.count + count <= MAX_BROWSER_BOOKMARKS && used.bytes + bytes <= MAX_BROWSER_BYTES) break;
      const retained = folder.bookmarks.filter((link) => selectedIds.has(link.selectionId));
      if (retained.length === folder.bookmarks.length) continue;
      const retainedBytes = retained.reduce((sum, link) => sum + jsonBytes(link), 0);
      used.count -= folder.bookmarks.length - retained.length; used.bytes -= folder.bytes - retainedBytes;
      Object.assign(folder, { bookmarks: retained, bytes: retainedBytes, loaded: retained.length > 0, evicted: true, budgetLimited: false });
    }
  }
  function acceptLinks(folder, data, explicit) {
    if (data.collectionSelectionId !== folder.node.selectionId) throw bookmarkError('Bookmark folder identity changed.', 'INVALID_BOOKMARKS');
    const links = normalizeBookmarkLinks(data.bookmarks);
    const preferred = links.filter((link) => selectedIds.has(link.selectionId));
    folder.bookmarks = []; folder.bytes = 0;
    const reserved = explicit ? links : preferred;
    reclaim(reserved.length, reserved.reduce((sum, link) => sum + jsonBytes(link), 0), folder);
    const used = totals();
    const accepted = []; let bytes = 0;
    for (const link of [...preferred, ...links.filter((link) => !selectedIds.has(link.selectionId))]) { const size = jsonBytes(link); if (used.count + accepted.length >= MAX_BROWSER_BOOKMARKS || used.bytes + bytes + size > MAX_BROWSER_BYTES) continue; accepted.push(link); bytes += size; }
    Object.assign(folder, { bookmarks: accepted, bytes, loaded: true, evicted: false, lastUsed: ++accessOrder, stale: data.stale === true, truncated: data.truncated === true, budgetLimited: accepted.length !== links.length, error: '' });
  }
  async function recoverTokens() {
    if (recovery) return recovery;
    if (recoveryUsed) return false;
    recoveryUsed = true;
    const operation = refresh({ recoveryPass: true }).then(() => true);
    recovery = operation;
    try { return await operation; } finally { if (recovery === operation) recovery = undefined; }
  }
  async function load(job) {
    const configurationId = status.configurationId;
    job.folder.loading = true; job.folder.attempted = now(); emit();
    try {
      let data;
      const token = job.folder.node.collectionToken;
      try { data = await api(`/api/bookmarks?collection=${encodeURIComponent(token)}`); }
      catch (failure) {
        if (failure.code !== 'COLLECTION_SELECTION_EXPIRED' || !current(job)) throw failure;
        if (job.folder.node.collectionToken === token && !await recoverTokens()) throw failure;
        if (!current(job)) throw failure;
        data = await api(`/api/bookmarks?collection=${encodeURIComponent(job.folder.node.collectionToken)}`);
      }
      if (!current(job)) return;
      if (data.configurationId !== configurationId) throw bookmarkError('Linkwarden source changed.', 'LINKWARDEN_CONFIGURATION_CHANGED');
      acceptLinks(job.folder, data, job.explicit);
    } catch (failure) {
      if (!current(job)) return;
      if (failure.code === 'LINKWARDEN_AUTHENTICATION_REQUIRED' || failure.status === 401) { retire(failure); return; }
      if (failure.code === 'LINKWARDEN_CONFIGURATION_CHANGED') { rediscoverSource(failure); return; }
      if (failure.code === 'LINKWARDEN_ACCESS_DENIED' || failure.status === 403) Object.assign(job.folder, { bookmarks: [], bytes: 0, loaded: false, stale: false });
      else job.folder.stale = job.folder.loaded;
      job.folder.error = failure.message;
    } finally {
      if (active.get(job.id) === job) active.delete(job.id);
      if (current(job)) { job.folder.loading = false; emit(); }
      pump();
    }
  }
  function pump() {
    if (disposed || !visible || mutation || blocked) return;
    while (active.size < 4 && queue.length) {
      queue.sort((left, right) => Number(selectedFolders.has(right)) - Number(selectedFolders.has(left)));
      const id = queue.shift(); const folder = folders.get(id);
      const explicit = explicitRequests.delete(id);
      if (!folder) continue;
      const used = totals();
      if (!explicit && !selectedFolders.has(id) && ((!pickerDisclosed(folder) && !folder.loaded) || folder.evicted)) continue;
      if (!explicit && !selectedFolders.has(id) && !folder.loaded && (used.count >= MAX_BROWSER_BOOKMARKS || used.bytes >= MAX_BROWSER_BYTES)) { folder.budgetLimited = true; continue; }
      const job = { id, folder, generation, explicit }; active.set(id, job); void load(job);
    }
  }
  function refresh({ recoveryPass = false } = {}) {
    if (disposed || !visible || mutation) return Promise.resolve();
    if (discovery) return discovery;
    if (!recoveryPass) { recoveryUsed = false; sourceRecoveryUsed = false; }
    const owner = ++authority; let retry = false;
    const operation = (async () => {
      try {
        const next = normalizeStatus((await api('/api/linkwarden')).linkwarden);
        if (owner !== authority || disposed || mutation) return;
        adopt(next);
        const adoptedGeneration = generation;
        if (status.configured && !blocked) {
          const data = await api('/api/linkwarden/collections');
          if (adoptedGeneration !== generation || disposed || mutation) return;
          installTree(data);
        }
        emit(); queueRequired();
      } catch (failure) {
        if (disposed || mutation || owner !== authority) return;
        if (failure.code === 'LINKWARDEN_AUTHENTICATION_REQUIRED' || failure.status === 401 || failure.code === 'LINKWARDEN_ACCESS_DENIED' || failure.status === 403) { retire(failure); return; }
        if (failure.code === 'LINKWARDEN_CONFIGURATION_CHANGED') {
          retry = !sourceRecoveryUsed; sourceRecoveryUsed = true;
          invalidateReads({ keepDiscovery: true }); tree = []; folders.clear(); overrides.clear(); pickerOverrides.clear();
        }
        error = failure.message; treeStale = tree.length > 0; emit();
      } finally {
        if (discovery === operation) { discovery = undefined; emit(); if (retry) void refresh({ recoveryPass: true }); else arm(); }
      }
    })();
    discovery = operation; emit(); return operation;
  }
  async function mutate(method, credentials) {
    if (mutation || disposed) throw new Error('A Linkwarden connection change is already pending.');
    configurationEpoch++; invalidateReads(); const owner = {}; mutation = owner; emit();
    try {
      const data = await api('/api/linkwarden', { method, body: credentials, mutation: true });
      if (mutation !== owner || disposed) return;
      blocked = false; sourceRecoveryUsed = false; recoveryUsed = false;
      if (method === 'DELETE') adopt(normalizeStatus({ configured: false, configurationId: null, encryptionReady: status.encryptionReady }));
      else { adopt(normalizeStatus(data.linkwarden)); installTree(data); }
      error = ''; emit();
    } finally {
      if (mutation === owner) { configurationEpoch++; mutation = undefined; emit(); queueRequired(); arm(); }
    }
  }
  return {
    configure(value) {
      const next = normalizeBookmarkSelections(value);
      if (JSON.stringify(next) === JSON.stringify(selections)) return;
      selections = next; selectedIds = new Set((next ?? []).map((record) => record.selectionId)); selectedFolders = new Set((next ?? []).map((record) => record.collectionSelectionId));
      if (selectedIds.size) {
        for (const folder of folders.values()) {
          if (selectedFolders.has(folder.node.selectionId) || pickerDisclosed(folder)) continue;
          const retained = folder.bookmarks.filter((link) => selectedIds.has(link.selectionId));
          if (retained.length !== folder.bookmarks.length) Object.assign(folder, { bookmarks: retained, bytes: retained.reduce((sum, link) => sum + jsonBytes(link), 0), loaded: retained.length > 0, evicted: true, budgetLimited: false });
        }
      }
      const cachedIds = new Set([...folders.values()].flatMap((folder) => folder.bookmarks.map((link) => link.selectionId)));
      for (const record of next ?? []) { const folder = folders.get(record.collectionSelectionId); if (folder && !cachedIds.has(record.selectionId)) folder.attempted = null; }
      emit(); queueRequired();
    },
    setPickerOpen(value) { pickerOpen = value; emit(); queueRequired(); },
    setPickerFolderOpen(id, value) { const folder = folders.get(id); if (!folder) return; pickerOverrides.set(id, value); folder.lastUsed = ++accessOrder; emit(); queueRequired(); },
    start() { return discovered ? Promise.resolve() : refresh(); }, refresh,
    setPresentation({ mobile = false, mode = 'compact', hidden: nextHidden = false }) { profile = bookmarkProfile(mobile, mode); hidden = nextHidden; emit(); queueRequired(); },
    setFolderOpen(id, value) { const folder = folders.get(id); if (!folder || open(folder) === value) return; if (!overrides.has(profile)) overrides.set(profile, new Map()); overrides.get(profile).set(id, value); emit(); queueRequired(); },
    retryFolder(id) { enqueue(id, true); },
    async connect(credentials) {
      if (status.needsReauthentication && !(typeof credentials.accessToken === 'string' && credentials.accessToken.trim())) throw new Error('An access token is required for Linkwarden re-authentication.');
      return mutate('PUT', { url: credentials.url, username: credentials.username, accessToken: credentials.accessToken });
    },
    disconnect: () => mutate('DELETE'),
    setVisible(value) { if (visible === value) return; visible = value; if (!visible) invalidateReads(); else void refresh(); },
    getState: snapshot,
    captureConfigurationObserver() {
      const epoch = configurationEpoch; const pending = Boolean(mutation);
      return (metadata) => {
        if (disposed || pending || mutation || epoch !== configurationEpoch || !metadata.available) return;
        const next = normalizeStatus(metadata);
        const keys = ['configured', 'configurationId', 'encryptionReady', 'accessTokenPresent', 'baseUrl', 'username'];
        if (discovered && keys.every((key) => next[key] === status[key])) return;
        configurationEpoch++; invalidateReads(); adopt(next);
        if (next.configured && !blocked) void refresh(); else { emit(); arm(); }
      };
    },
    dispose() { disposed = true; invalidateReads(); for (const request of requests) request.controller.abort(); tree = []; folders.clear(); overrides.clear(); pickerOverrides.clear(); }
  };
}
