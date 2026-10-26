import { createSettingsSync } from './dashboard-settings-sync.js';
import { normalizeDashboardPreferences, legacyDashboardPreferences, normalizeLocation, SETTINGS_KEY } from './dashboard-helpers.js';
import { SCOPE_KEY, CATEGORY_SCOPES_KEY, LOCAL_SETTINGS_KEY, parseSettingsJson, validateScope, validateCategoryScopes, validateLocalSettings, decodeStoredLocalSettings, validateSettingsTransfer, validateConfigurationMetadata, MAX_SETTINGS_TRANSFER_BYTES } from './dashboard-settings-data.js';
import { CATEGORY_IDS, settingsCategory, categoryScopes, composeCategoryPreferences, patchCategory } from './dashboard-settings-categories.js';
import { requestDashboardJson } from './dashboard-request.js';

const unavailable = () => ({ weather: { available: false }, calendar: { available: false }, linkwarden: { available: false } });
const serviceCategory = name => ({ linkwarden: 'bookmarks', 'home-assistant': 'home-assistant', wol: 'wol', weather: 'weather', calendar: 'calendar' })[name] ?? name;
export function createSettingsScope({ storage, onSnapshot, onState = () => {}, captureObservers = () => ({}), fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout }) {
  let scopes = { schema: 1, revision: 0, scopes: categoryScopes() }; const epochs = Object.fromEntries(CATEGORY_IDS.map(id => [id, 0]));
  let scopeError = ''; let localError = ''; let corruptRaw; let global; let metadata; let timer; let visible = true; let started = false; let disposed = false; let importing = false;
  const actions = new Map();
  let local = { schema: 1, revision: 0, preferences: normalizeDashboardPreferences(), weatherLocation: null, followGlobalPhotos: true };
  const api = (url, options = {}) => requestDashboardJson(url, { fetchImpl, schedule, cancel, ...options });
  const anyGlobal = () => CATEGORY_IDS.some(id => scopes.scopes[id] === 'global');
  function readScopes() {
    const raw = storage?.getItem(CATEGORY_SCOPES_KEY);
    if (raw !== null && raw !== undefined) return validateCategoryScopes(parseSettingsJson(raw));
    let mode = 'local'; try { const legacy = storage?.getItem(SCOPE_KEY); if (legacy) mode = validateScope(parseSettingsJson(legacy)); } catch { /* Invalid legacy mode is a Local default, not write authority for Global. */ }
    return { schema: 1, revision: 0, scopes: categoryScopes(mode) };
  }
  function readLocal() {
    const raw = storage?.getItem(LOCAL_SETTINGS_KEY);
    if (raw) return decodeStoredLocalSettings(parseSettingsJson(raw));
    const legacy = storage?.getItem(SETTINGS_KEY); const old = legacy ? parseSettingsJson(legacy) : null;
    return { schema: 1, revision: 0, preferences: legacyDashboardPreferences(old) ?? normalizeDashboardPreferences(), weatherLocation: normalizeLocation(old?.location), followGlobalPhotos: true };
  }
  try { scopes = readScopes(); } catch { scopeError = 'Category scopes could not be read. Use General to recover the scope map.'; try { corruptRaw = storage?.getItem(CATEGORY_SCOPES_KEY); } catch { /* Unreadable storage cannot be recovered by overwriting it. */ } }
  try { local = readLocal(); } catch { localError = 'Local settings could not be read. Save to replace this preview.'; }
  function globalState() { return global?.getState() ?? { snapshot: { initialized: false, revision: 0, preferences: normalizeDashboardPreferences(), integrations: unavailable() }, confirmed: false, pending: false, cache: false }; }
  function categoryState(id) {
    settingsCategory(id); const mode = scopes.scopes[id]; const base = mode === 'global' ? globalState() : { confirmed: true, pending: false, cache: false, snapshot: { revision: local.revision }, error: localError };
    const source = JSON.stringify([id, mode, epochs[id]]);
    return { category: id, mode, source, revision: base.snapshot.revision, saveToken: JSON.stringify([source, base.snapshot.revision]), confirmed: base.confirmed && !scopeError, cache: base.cache, pending: base.pending || mode === 'global' && importing, mutating: (actions.get(id) ?? 0) > 0, error: scopeError || base.error || '', snapshot: { preferences: effectivePreferences() } };
  }
  function effectivePreferences() { return composeCategoryPreferences(scopes.scopes, local.preferences, globalState().snapshot.preferences); }
  function state() {
    const shared = globalState();
    return { scopes: { ...scopes.scopes }, scopeRevision: scopes.revision, scopeError, recoverable: corruptRaw !== undefined && corruptRaw !== null, categories: Object.fromEntries(CATEGORY_IDS.map(id => [id, categoryState(id)])), snapshot: { preferences: effectivePreferences(), integrations: shared.snapshot.integrations }, weatherLocation: scopes.scopes.weather === 'local' ? local.weatherLocation : shared.snapshot.integrations.weather?.location ?? null, followGlobalPhotos: local.followGlobalPhotos, pending: importing || shared.pending, mutating: actions.size > 0 };
  }
  const emit = () => { if (!disposed) onState(state()); };
  function publish(observers = {}) { if (!disposed) onSnapshot(state().snapshot, observers); emit(); }
  function ensureGlobal() {
    if (global) return;
    global = createSettingsSync({ storage, fetchImpl, schedule, cancel, captureObservers, onSnapshot(_value, observers) { if (!disposed) publish(observers); }, onState() { if (!disposed) emit(); } });
    global.setVisible(visible && anyGlobal());
  }
  function adoptScopes(next, reset = false) {
    let changed = reset;
    for (const id of CATEGORY_IDS) if (reset || next.scopes[id] !== scopes.scopes[id]) { epochs[id]++; changed = true; }
    scopes = next; scopeError = ''; corruptRaw = undefined;
    return changed;
  }
  function syncScopes() {
    try { return adoptScopes(readScopes()); }
    catch (failure) { scopeError = 'Category scopes could not be read. Use General to recover the scope map.'; try { corruptRaw = storage?.getItem(CATEGORY_SCOPES_KEY); } catch { corruptRaw = undefined; } throw failure; }
  }
  function stopMetadata() { cancel(timer); timer = undefined; metadata?.abort(); metadata = undefined; }
  async function refreshMetadata() {
    if (disposed || !visible || metadata) return;
    const owner = new AbortController(); metadata = owner; const captured = captureObservers();
    try {
      const value = validateConfigurationMetadata(await api('/api/dashboard/configuration', { signal: owner.signal }));
      if (!owner.signal.aborted && !disposed) for (const name of ['calendar', 'linkwarden']) if (scopes.scopes[serviceCategory(name)] === 'local' && value[name]?.available) captured[name]?.(value[name]);
    } catch { /* Installation reads do not determine preference ownership. */ }
    finally { if (metadata === owner) { metadata = undefined; if (!disposed && visible) timer = schedule(() => { timer = undefined; void refreshMetadata(); }, 5000); } }
  }
  function updatePolling() {
    if (!started || disposed) return;
    if (anyGlobal()) ensureGlobal();
    global?.setVisible(visible && anyGlobal());
    if (!visible || ['calendar', 'bookmarks'].every(id => scopes.scopes[id] === 'global')) stopMetadata();
    else if (!metadata && !timer) void refreshMetadata();
  }
  async function refresh() {
    try { syncScopes(); } catch { /* Preserve the last map for display, never writes. */ }
    try { local = readLocal(); localError = ''; } catch { localError = 'Local settings could not be reloaded. The previous preview is retained.'; }
    updatePolling(); publish();
    if (anyGlobal()) { ensureGlobal(); await global.refresh(); }
  }
  function admitMutation(id, token, { globalOnly = false, confirmed = true } = {}) {
    if (disposed) throw new Error('Settings have been disposed.');
    let changed;
    try { changed = syncScopes(); } catch { emit(); throw new Error(scopeError); }
    if (changed) { updatePolling(); publish(); }
    const current = categoryState(id);
    if (token !== current.saveToken) throw new Error(`${settingsCategory(id).label} settings source or revision changed. Reload this category before saving.`);
    if (globalOnly && current.mode !== 'global') throw new Error(`Select Global ${settingsCategory(id).label} settings before changing server resources.`);
    if (confirmed && !current.confirmed) throw new Error(`Reload ${settingsCategory(id).label} settings before saving.`);
    return current;
  }
  function persistLocal(id, token, next) {
    let current;
    try { current = readLocal(); } catch { if (!localError) throw new Error('Local settings became unreadable. Reload before saving.'); current = local; }
    if (current.revision !== local.revision) { local = current; publish(); throw new Error('Local settings changed in another tab. Reload this category.'); }
    const value = validateLocalSettings({ ...next, schema: 1, revision: current.revision + 1 });
    if (!storage) throw new Error('Browser storage is unavailable. Local settings were not saved.');
    admitMutation(id, token); storage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(value)); local = value; localError = '';
    try { storage.removeItem(SETTINGS_KEY); } catch { /* Committed Local data is authoritative. */ }
    publish(); return categoryState(id);
  }
  async function changeScope(id, mode, { canChange = true } = {}) {
    settingsCategory(id); if (!['local', 'global'].includes(mode)) throw new Error('Invalid category scope.');
    const revision = scopes.revision; const changed = syncScopes(); if (changed) { updatePolling(); publish(); }
    if (revision !== scopes.revision) throw new Error('Category choices changed in another tab. Review them before changing scope.');
    const current = categoryState(id); if (current.mode === mode) return;
    if (!canChange || current.pending || current.mutating) throw new Error(`Save or discard ${settingsCategory(id).label} edits and pending actions before changing scope.`);
    if (!storage) throw new Error('Browser storage is unavailable. Scope was not saved.');
    const next = validateCategoryScopes({ schema: 1, revision: scopes.revision + 1, scopes: { ...scopes.scopes, [id]: mode } });
    storage.setItem(CATEGORY_SCOPES_KEY, JSON.stringify(next)); adoptScopes(next); updatePolling(); publish();
    if (mode === 'global' && started) await global.refresh();
  }
  async function resetScopes(confirm) {
    const captured = storage?.getItem(CATEGORY_SCOPES_KEY);
    if (captured === null || captured === undefined) throw new Error('There is no corrupt category map to reset.');
    let valid = false; try { validateCategoryScopes(parseSettingsJson(captured)); valid = true; } catch { /* Recovery replaces only an invalid map. */ }
    if (valid) throw new Error('Category choices are valid. Reload them instead.');
    if (!await confirm('Reset only this browser’s category choices to Local? Saved preferences, weather location, image-follow choice, credentials, and server records will not be deleted. Unsaved drafts will require reload.')) return false;
    if (storage.getItem(CATEGORY_SCOPES_KEY) !== captured) { try { syncScopes(); updatePolling(); publish(); } catch { emit(); } throw new Error('Category choices changed during recovery. Review them before retrying.'); }
    const next = validateCategoryScopes({ schema: 1, revision: 1, scopes: categoryScopes() });
    storage.setItem(CATEGORY_SCOPES_KEY, JSON.stringify(next)); adoptScopes(next, true); updatePolling(); publish(); return true;
  }
  function beginIntegrationAction(name, token) {
    const id = serviceCategory(name); admitMutation(id, token, { globalOnly: name !== 'weather' });
    actions.set(id, (actions.get(id) ?? 0) + 1); const releaseGlobal = scopes.scopes[id] === 'global' && ['weather', 'calendar', 'linkwarden'].includes(name) ? global?.beginIntegrationAction(name) : null;
    emit(); let done = false;
    const release = () => { if (done) return; done = true; const count = (actions.get(id) ?? 1) - 1; if (count) actions.set(id, count); else actions.delete(id); releaseGlobal?.(); emit(); };
    release.check = () => admitMutation(id, token, { globalOnly: name !== 'weather' });
    return release;
  }
  return {
    getState: state, getCategoryState: categoryState,
    getTransferState() { const base = globalState(); const general = categoryState('general'); return { ...base, mode: general.mode, source: general.source, saveToken: general.saveToken, pending: importing || base.pending, mutating: actions.size > 0, scopeError }; },
    async start() { if (disposed) return; started = true; updatePolling(); publish(); await refresh(); },
    refresh, changeScope, resetScopes, admitMutation, beginIntegrationAction,
    async saveCategory(id, patch, token, options = {}) {
      const current = admitMutation(id, token); if (current.pending) throw new Error('A settings save or import is already pending.');
      const hasFollow = Object.hasOwn(options, 'followGlobalPhotos');
      if (hasFollow && (id !== 'images' || current.mode !== 'local' || typeof options.followGlobalPhotos !== 'boolean')) throw new Error('The photo-follow option belongs to Local Images only.');
      const preferences = patchCategory(id, current.mode === 'local' ? local.preferences : globalState().snapshot.preferences, patch);
      if (current.mode === 'local') return persistLocal(id, token, { ...local, preferences, ...(hasFollow ? { followGlobalPhotos: options.followGlobalPhotos } : {}) });
      ensureGlobal(); return global.save(preferences, current.revision, () => admitMutation(id, token));
    },
    saveLocalLocation(location, token) { const current = admitMutation('weather', token); if (current.mode !== 'local') throw new Error('Local Weather is not active.'); return persistLocal('weather', token, { ...local, weatherLocation: location }); },
    async exportGlobal() { return validateSettingsTransfer(await api('/api/dashboard/settings/export', { maxBytes: MAX_SETTINGS_TRANSFER_BYTES })); },
    async importGlobal(settings, expected, token) {
      const current = admitMutation('general', token, { globalOnly: true });
      if (current.pending || actions.size) throw new Error('Wait for shared settings actions before importing.');
      if (!['preferencesRevision', 'weatherRevision'].every(key => Number.isSafeInteger(expected[key]) && expected[key] >= 0) || expected.preferencesRevision !== globalState().snapshot.revision) throw new Error('Reload Global preference and weather revisions before importing.');
      const validated = validateSettingsTransfer(settings); ensureGlobal(); importing = true; emit();
      try {
        admitMutation('general', token, { globalOnly: true });
        const value = await api('/api/dashboard/settings/import', { method: 'POST', maxBytes: MAX_SETTINGS_TRANSFER_BYTES, body: { settings: validated, ...expected } });
        global.adoptCommittedSnapshot(value.snapshot); return value;
      } finally { importing = false; emit(); }
    },
    storageChanged(event) { if (!disposed && [null, CATEGORY_SCOPES_KEY, SCOPE_KEY, LOCAL_SETTINGS_KEY].includes(event.key)) void refresh(); },
    setVisible(next) { visible = next; updatePolling(); if (next && started) void refresh(); },
    dispose() { disposed = true; stopMetadata(); global?.dispose(); }
  };
}
