import { decodeStoredDashboardPreferences, normalizeDashboardPreferences, validateDashboardPreferences, validateDashboardSnapshot } from './dashboard-helpers.js';

export const SHARED_SETTINGS_KEY = 'dashboard.shared-settings.v1';
export const SETTINGS_POLL_MS = 5000;
const unavailable = () => ({ weather: { available: false }, calendar: { available: false }, linkwarden: { available: false } });

export function createSettingsSync({ onSnapshot, onState = () => {}, captureObservers = () => ({}), storage, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000 }) {
  let snapshot = { initialized: false, revision: 0, preferences: normalizeDashboardPreferences(), integrations: unavailable() };
  let cache = false; let confirmed = false; let error = ''; let generation = 0; let timer; let read; let readController; let write; let visible = true; let disposed = false; let queuedRefresh = false;
  const deferrals = new Map(['weather', 'calendar', 'linkwarden'].map((name) => [name, { count: 0, epoch: 0 }]));
  try {
    const value = JSON.parse(storage?.getItem(SHARED_SETTINGS_KEY));
    if (value?.schema === 1 && value.initialized === true && Number.isSafeInteger(value.revision) && value.revision > 0) { snapshot = { ...snapshot, initialized: true, revision: value.revision, preferences: decodeStoredDashboardPreferences(value.preferences) }; cache = true; }
  } catch { /* A bad cache is not authority. */ }
  const state = () => ({ snapshot, confirmed, cache, error, pending: Boolean(write), loading: Boolean(read) });
  const emit = () => { if (!disposed) onState(state()); };
  function arm() { cancel(timer); timer = undefined; if (!disposed && visible && !write) timer = schedule(() => { timer = undefined; void refresh(); }, SETTINGS_POLL_MS); }
  function invalidate() { generation++; cancel(timer); timer = undefined; readController?.abort(); read = undefined; }
  function observers() {
    const captured = captureObservers(); const result = {};
    for (const [name, deferral] of deferrals) {
      const epoch = deferral.epoch; const deferred = deferral.count > 0;
      result[name] = (...args) => { if (!deferred && deferral.count === 0 && deferral.epoch === epoch && args[0]?.available) return captured[name]?.(...args); return false; };
    }
    return result;
  }
  async function api(url, { method = 'GET', body, controller = new AbortController(), beforeWrite } = {}) {
    const deadline = schedule(() => controller.abort(), timeoutMs); let response;
    try {
      const aborted = new Promise((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Shared settings request timed out or was canceled.')), { once: true }));
      return await Promise.race([(async () => {
        beforeWrite?.();
        response = await fetchImpl(url, { method, signal: controller.signal, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) });
        if (controller.signal.aborted) { await response.body?.cancel().catch(() => {}); throw new Error('Shared settings request canceled.'); }
        if (Number(response.headers?.get('content-length')) > 65536) throw new Error('Shared settings response is too large.');
        let data;
        if (response.body?.getReader) {
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          const abort = () => { void reader.cancel().catch(() => {}); }; controller.signal.addEventListener('abort', abort, { once: true });
          try {
            for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) throw new Error('Shared settings response is too large.'); chunks.push(value); }
            const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            data = JSON.parse(new TextDecoder().decode(bytes));
          } finally { controller.signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
        } else data = await response.json();
        if (!response.ok) throw Object.assign(new Error(typeof data?.error === 'string' ? data.error.slice(0, 300) : 'Shared settings unavailable.'), { status: response.status, snapshot: data?.snapshot });
        return validateDashboardSnapshot(data);
      })(), aborted]);
    } catch (failure) { controller.abort(); if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); throw failure; }
    finally { cancel(deadline); }
  }
  function accept(value, captured) {
    snapshot = value; confirmed = true; cache = false; error = '';
    try {
      if (value.initialized) {
        const serialized = JSON.stringify({ schema: 1, initialized: true, revision: value.revision, preferences: value.preferences });
        if (storage?.getItem(SHARED_SETTINGS_KEY) !== serialized) storage?.setItem(SHARED_SETTINGS_KEY, serialized);
      } else storage?.removeItem(SHARED_SETTINGS_KEY);
    } catch { /* Server confirmation does not depend on local caching. */ }
    onSnapshot(value, captured); emit();
  }
  function refresh({ afterCurrent = false } = {}) {
    if (disposed || !visible) return Promise.resolve();
    if (write) { queuedRefresh ||= afterCurrent; return Promise.resolve(); }
    if (read) { queuedRefresh ||= afterCurrent; return read; }
    cancel(timer); timer = undefined; const request = generation; const captured = observers(); readController = new AbortController();
    const operation = (async () => {
      try {
        let value = await api('/api/dashboard/settings', { controller: readController });
        if (request !== generation || disposed) return;
        let appliedObservers = captured;
        accept(value, appliedObservers);
        return value;
      } catch (failure) { if (request === generation && !disposed) { error = failure.message; emit(); } }
      finally { if (read === operation) { read = undefined; emit(); if (queuedRefresh) { queuedRefresh = false; void refresh(); } else arm(); } }
    })();
    read = operation; emit(); return operation;
  }
  return {
    getState: state,
    start: refresh, refresh,
    adoptCommittedSnapshot(value) { if (disposed || write) throw new Error('Global settings are busy.'); invalidate(); accept(validateDashboardSnapshot(value), observers()); arm(); },
    async save(preferences, revision, beforeWrite) {
      if (write || disposed) throw new Error('A shared preference save is already pending.');
      validateDashboardPreferences(preferences); invalidate(); const request = generation; const owner = { controller: new AbortController() }; write = owner; emit();
      const captured = observers();
      try {
        const value = await api('/api/dashboard/settings', { method: 'PUT', body: { revision, preferences }, controller: owner.controller, beforeWrite });
        if (write === owner && !disposed) accept(value, captured);
        return value;
      } catch (failure) {
        if (write === owner && !disposed) {
          if (failure.status === 409 && failure.snapshot) accept(validateDashboardSnapshot(failure.snapshot), captured);
          error = failure.message; emit();
        }
        throw failure;
      } finally { if (write === owner) { write = undefined; emit(); if (queuedRefresh) { queuedRefresh = false; void refresh(); } else arm(); } }
    },
    beginIntegrationAction(name) {
      const deferral = deferrals.get(name); if (!deferral) throw new Error('Unknown integration.');
      deferral.count++; deferral.epoch++; let released = false;
      return () => { if (released) return; released = true; deferral.count--; deferral.epoch++; if (!deferral.count) void refresh({ afterCurrent: true }); };
    },
    setVisible(next) { if (visible === next) return; visible = next; if (next) void refresh(); else { invalidate(); emit(); } },
    dispose() { disposed = true; invalidate(); write?.controller.abort(); }
  };
}
