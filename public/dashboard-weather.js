import { normalizeLocation, text } from './dashboard-helpers.js';
import { presentForecast, validateWeatherSnapshot, weatherTimezone } from './weather-data.js';

export async function requestJson(url, { signal, fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid provider response');
    return data;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function searchLocations(query, options) {
  const name = text(query);
  if (name.length < 2) return [];
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.search = new URLSearchParams({ name, count: '10', language: 'en', format: 'json' });
  const data = await requestJson(url, options);
  if (data.results !== undefined && !Array.isArray(data.results)) throw new Error('Invalid locations');
  return (data.results ?? []).slice(0, 10).map((row) => normalizeLocation({ ...row, label: [text(row?.name), text(row?.admin1), text(row?.country)].filter(Boolean).join(', ') })).filter(Boolean);
}

// One browser owner reads server snapshots; only the server contacts forecast providers.
export function createWeatherController({ onChange, fetchImpl = fetch, now = Date.now, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 10000 }) {
  let settings; let zone; let generation = 0; let timer; let controller; let mutationController; let visible = true; let disposed = false; let mutationPending = false; let lastEnsure = -Infinity;
  let state = { location: null, revision: 0, forecast: null, air: null, discovered: false, refreshing: false };
  const emit = () => onChange({ ...state, forecast: presentForecast(state.forecast, settings), loading: !state.discovered || state.refreshing, mutationPending });
  function stopRead() { generation++; cancel(timer); timer = undefined; controller?.abort(); }
  function arm() {
    cancel(timer); timer = undefined;
    if (!visible || disposed || mutationPending) return;
    timer = schedule(() => { timer = undefined; void refresh({ ensure: !state.refreshing }); }, state.refreshing ? 5000 : 60000);
  }
  async function api(url, { signal, method = 'GET', body } = {}) {
    const request = new AbortController(); const abort = () => request.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const deadline = schedule(abort, timeoutMs);
    try {
      const response = await fetchImpl(url, { method, signal: request.signal, credentials: 'same-origin', ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.error || 'Weather service unavailable.'), { status: response.status });
      return data;
    } finally { cancel(deadline); signal?.removeEventListener('abort', abort); }
  }
  async function refresh({ ensure = true } = {}) {
    if (!settings || disposed || !visible || mutationPending) return;
    stopRead(); const request = generation; controller = new AbortController();
    try {
      const snapshot = validateWeatherSnapshot(await api(`/api/weather?timezone=${encodeURIComponent(zone)}`, { signal: controller.signal }));
      if (request !== generation || snapshot.revision < state.revision || snapshot.timezone !== zone) return;
      state = { ...snapshot, discovered: true, serviceError: false }; emit();
      if (ensure && now() - lastEnsure >= 60000) {
        lastEnsure = now();
        const result = await api('/api/weather/refresh', { method: 'POST', body: { timezone: zone }, signal: controller.signal });
        if (request !== generation) return;
        if (typeof result.scheduled !== 'boolean' || typeof result.refreshing !== 'boolean') throw new Error('Invalid weather refresh status');
        state = { ...state, refreshing: result.refreshing }; emit();
      }
    } catch {
      if (request !== generation) return;
      state = { ...state, serviceError: true, refreshing: false }; emit();
    } finally { if (request === generation) arm(); }
  }
  return {
    configure(next) {
      settings = next; disposed = false;
      const nextZone = weatherTimezone(next.timezone);
      if (zone === nextZone) { emit(); return; }
      zone = nextZone; stopRead(); lastEnsure = -Infinity;
      state = { ...state, forecast: null, forecastUpdated: null, forecastError: false, refreshing: false };
      emit(); void refresh();
    },
    refresh,
    async saveLocation(location) {
      if (mutationPending || !state.discovered || disposed) throw new Error('Wait for the saved weather location to load.');
      stopRead(); mutationPending = true; mutationController = new AbortController(); emit();
      try {
        const saved = validateWeatherSnapshot(await api('/api/weather/location', { method: 'PUT', body: { location, revision: state.revision }, signal: mutationController.signal }));
        if (disposed) return saved.location;
        const sameCoordinates = state.location?.latitude === saved.location.latitude && state.location?.longitude === saved.location.longitude;
        state = { ...state, location: saved.location, revision: saved.revision, configured: true, serviceError: false, ...(!sameCoordinates && { forecast: null, air: null, forecastUpdated: null, airUpdated: null, forecastError: false, airError: false }) };
        mutationPending = false; lastEnsure = -Infinity; emit(); await refresh();
        return saved.location;
      } catch (error) {
        mutationPending = false;
        if (!disposed) { emit(); if (error.status === 409) await refresh(); }
        throw error;
      } finally { mutationPending = false; arm(); }
    },
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      if (visible) { disposed = false; void refresh(); } else stopRead();
    },
    dispose() { disposed = true; stopRead(); mutationController?.abort(); },
    getState: () => ({ ...state })
  };
}
