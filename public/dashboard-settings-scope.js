import { createSettingsSync } from './dashboard-settings-sync.js';
import { normalizeDashboardPreferences, legacyDashboardPreferences, normalizeLocation, SETTINGS_KEY } from './dashboard-helpers.js';
import { SCOPE_KEY, LOCAL_SETTINGS_KEY, parseSettingsJson, validateScope, validateLocalSettings, validateSettingsTransfer, validateConfigurationMetadata, MAX_SETTINGS_TRANSFER_BYTES } from './dashboard-settings-data.js';
import { requestDashboardJson } from './dashboard-request.js';

const unavailable = () => ({ weather: { available: false }, calendar: { available: false }, linkwarden: { available: false } });
export function createSettingsScope({ storage, onSnapshot, onState = () => {}, captureObservers = () => ({}), fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout }) {
  let mode = 'local'; let epoch = 0; let error = ''; let visible = true; let disposed = false; let started = false; let pending = false; let actions = 0;
  let global; let metadata; let timer; let local = { schema: 1, revision: 0, preferences: normalizeDashboardPreferences(), weatherLocation: null };
  const api = (url, options = {}) => requestDashboardJson(url, { fetchImpl, schedule, cancel, ...options });
  try { const raw = storage?.getItem(SCOPE_KEY); if (raw) mode = validateScope(parseSettingsJson(raw)); } catch { error = 'Settings scope could not be read. Using Local preview.'; }
  function readLocal() {
    const raw = storage?.getItem(LOCAL_SETTINGS_KEY);
    if (raw) return validateLocalSettings(parseSettingsJson(raw));
    const legacy = storage?.getItem(SETTINGS_KEY); const old = legacy ? parseSettingsJson(legacy) : null;
    return { schema: 1, revision: 0, preferences: legacyDashboardPreferences(old) ?? normalizeDashboardPreferences(), weatherLocation: normalizeLocation(old?.location) };
  }
  try { local = readLocal(); } catch { error = 'Local settings could not be read. Save to replace this preview.'; }
  function state() {
    const base = mode === 'global' && global ? global.getState() : { snapshot: { initialized: true, revision: local.revision, preferences: local.preferences, integrations: unavailable() }, confirmed: true, cache: false, pending: false };
    return { ...base, mode, source: `${mode}:${epoch}`, saveToken: `${mode}:${epoch}:${base.snapshot.revision}`, weatherLocation: mode === 'local' ? local.weatherLocation : null, pending: pending || base.pending, mutating: actions > 0, error: error || base.error || '' };
  }
  const emit = () => { if (!disposed) onState(state()); };
  function publish(observers = {}) { if (!disposed) onSnapshot(state().snapshot, observers); emit(); }
  function ensureGlobal() {
    if (global) return;
    global = createSettingsSync({ storage, fetchImpl, schedule, cancel, captureObservers, onSnapshot(value, observers) { if (mode === 'global' && !disposed) { onSnapshot(value, observers); emit(); } }, onState() { if (mode === 'global') emit(); } });
    global.setVisible(visible && mode === 'global');
  }
  function stopMetadata() { cancel(timer); timer = undefined; metadata?.abort(); metadata = undefined; }
  async function refreshMetadata() {
    if (disposed || !visible || mode !== 'local' || metadata) return;
    const owner = new AbortController(); metadata = owner; const captured = captureObservers(); const source = epoch;
    try {
      const value = validateConfigurationMetadata(await api('/api/dashboard/configuration', { signal: owner.signal }));
      if (!owner.signal.aborted && epoch === source && mode === 'local') for (const name of ['calendar', 'linkwarden']) if (value[name]?.available) captured[name]?.(value[name]);
    } catch { /* Read-only metadata failure must not disable Local settings. */ }
    finally { if (metadata === owner) { metadata = undefined; if (!disposed && visible && mode === 'local') timer = schedule(() => { timer = undefined; void refreshMetadata(); }, 5000); } }
  }
  function refresh() {
    if (mode === 'global') { ensureGlobal(); return global.refresh(); }
    try { local = readLocal(); error = ''; publish(); } catch { error = 'Local settings could not be reloaded. The previous preview is retained.'; emit(); }
    return refreshMetadata();
  }
  function validateToken(token) { if (token !== state().saveToken) throw new Error('Settings source or revision changed. Reload preferences before saving.'); }
  function persistLocal(next, token) {
    validateToken(token);
    const savedMode = storage?.getItem(SCOPE_KEY);
    let persistedMode = 'local'; try { if (savedMode) persistedMode = validateScope(parseSettingsJson(savedMode)); } catch { /* Explicit Local save may recover an invalid mode preview. */ }
    if (persistedMode !== 'local') throw new Error('Settings scope changed in another tab. Reload preferences.');
    let current; try { current = readLocal(); } catch { if (!error) throw new Error('Local settings changed or became unreadable. Reload before replacing them.'); current = local; }
    if (current.revision !== local.revision) { local = current; publish(); throw new Error('Local settings changed in another tab. Reload preferences.'); }
    const value = validateLocalSettings({ ...next, schema: 1, revision: current.revision + 1 });
    if (!storage) throw new Error('Browser storage is unavailable. Local settings were not saved.');
    storage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(value)); local = value; error = '';
    try { storage.removeItem(SETTINGS_KEY); } catch { /* The committed local record is authoritative. */ }
    publish(); return state().snapshot;
  }
  async function changeScope(next, { canChange = true, persist = true } = {}) {
    if (!['local', 'global'].includes(next)) throw new Error('Invalid settings scope.');
    if (disposed || next === mode) return;
    if (persist && (!canChange || state().pending || actions)) throw new Error('Save or discard pending edits before changing settings scope.');
    if (persist) { if (!storage) throw new Error('Browser storage is unavailable. Scope was not saved.'); storage.setItem(SCOPE_KEY, JSON.stringify({ schema: 1, mode: next })); }
    epoch++; error = ''; stopMetadata(); global?.setVisible(false); mode = next;
    if (mode === 'local') { try { local = readLocal(); } catch { error = 'Local settings could not be loaded.'; } }
    else ensureGlobal();
    publish();
    if (started && visible) { if (mode === 'global') global.setVisible(true); await refresh(); }
  }
  function storageChanged(event) {
    if (disposed || ![null, SCOPE_KEY, LOCAL_SETTINGS_KEY].includes(event.key)) return;
    try {
      const raw = storage?.getItem(SCOPE_KEY); let next = 'local';
      try { if (raw) next = validateScope(parseSettingsJson(raw)); } catch { /* Corrupt scope data defaults to Local, never Global. */ }
      if (next !== mode) { void changeScope(next, { persist: false }); return; }
      if (mode === 'local') { local = readLocal(); error = ''; publish(); }
    } catch { error = 'Changed browser settings could not be read.'; emit(); }
  }
  return {
    getState: state,
    async start() { if (disposed) return; started = true; if (mode === 'global') { ensureGlobal(); global.setVisible(visible); } publish(); await refresh(); },
    refresh,
    changeScope,
    async save(preferences, token) {
      if (pending) throw new Error('A settings import is already pending.');
      validateToken(token);
      if (mode === 'local') return persistLocal({ ...local, preferences }, token);
      ensureGlobal(); return global.save(preferences, state().snapshot.revision);
    },
    saveLocalLocation(location, token = state().saveToken) { if (mode !== 'local') throw new Error('Local scope is not active.'); return persistLocal({ ...local, weatherLocation: location }, token); },
    beginIntegrationAction(name) { actions++; const release = mode === 'global' && ['weather', 'calendar', 'linkwarden'].includes(name) ? global?.beginIntegrationAction(name) : null; emit(); let done = false; return () => { if (done) return; done = true; actions--; release?.(); emit(); }; },
    async exportGlobal() { return validateSettingsTransfer(await api('/api/dashboard/settings/export', { maxBytes: MAX_SETTINGS_TRANSFER_BYTES })); },
    async importGlobal(settings, expected, token) {
      validateToken(token); if (mode !== 'global' || pending || actions || !state().confirmed) throw new Error('Select confirmed Global settings before importing.');
      if (!['preferencesRevision', 'weatherRevision'].every(key => Number.isSafeInteger(expected[key]) && expected[key] >= 0)) throw new Error('Reload both global preferences and weather configuration before importing.');
      const source = epoch; pending = true; emit();
      try {
        const value = await api('/api/dashboard/settings/import', { method: 'POST', maxBytes: MAX_SETTINGS_TRANSFER_BYTES, body: { settings: validateSettingsTransfer(settings), ...expected } });
        if (source === epoch && mode === 'global') global.adoptCommittedSnapshot(value.snapshot);
        return value;
      } finally { pending = false; emit(); }
    },
    storageChanged,
    setVisible(next) { visible = next; if (next && started) storageChanged({ key: null }); global?.setVisible(next && mode === 'global'); if (!next) stopMetadata(); else if (started && mode === 'local') void refreshMetadata(); },
    dispose() { disposed = true; epoch++; stopMetadata(); global?.dispose(); }
  };
}
