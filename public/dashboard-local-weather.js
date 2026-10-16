import { presentForecast } from './weather-data.js';
import { validateLocalWeatherSnapshot, localWeatherSource, MAX_LOCAL_WEATHER_BYTES } from './local-weather-data.js';
import { requestDashboardJson } from './dashboard-request.js';

export function createLocalWeatherController({ onChange, fetchImpl = fetch, schedule = setTimeout, cancel = clearTimeout }) {
  let settings; let location = null; let source; let timer; let read; let visible = true; let disposed = false;
  let state = { configured: false, location: null, revision: 0, forecast: null, air: null, discovered: true, refreshing: false };
  function emit() { if (!disposed) onChange({ ...state, location, forecast: presentForecast(state.forecast, settings), loading: state.refreshing, mutationPending: false }); }
  function pause() { cancel(timer); timer = undefined; read?.abort(); read = undefined; }
  async function refresh() {
    if (disposed || !visible || !settings || !location || read) return;
    cancel(timer); timer = undefined; const owner = new AbortController(); read = owner; const expected = source; const place = location;
    try {
      const result = validateLocalWeatherSnapshot(await requestDashboardJson('/api/weather/local', { fetchImpl, signal: owner.signal, schedule, cancel, method: 'POST', maxBytes: MAX_LOCAL_WEATHER_BYTES, body: { location: place, timezone: settings.timezone } }), place, settings.timezone);
      if (owner.signal.aborted || source !== expected || disposed) return;
      state = { ...result, discovered: true, serviceError: false }; emit();
    } catch { if (!owner.signal.aborted && source === expected && !disposed) { state = { ...state, serviceError: true, refreshing: false }; emit(); } }
    finally { if (read === owner) { read = undefined; if (visible && !disposed) timer = schedule(() => { timer = undefined; void refresh(); }, state.refreshing ? 5000 : 60000); } }
  }
  return {
    configure(next, place) {
      settings = next; location = place; const nextSource = place ? localWeatherSource(place, next.timezone) : null;
      if (nextSource !== source) { source = nextSource; pause(); state = { configured: Boolean(place), revision: 0, location: place, forecast: null, air: null, discovered: true, refreshing: Boolean(place) }; emit(); void refresh(); }
      else emit();
    },
    refresh,
    getState: () => ({ ...state, location }),
    setVisible(next) { if (visible === next) return; visible = next; if (!next) pause(); else void refresh(); },
    dispose() { disposed = true; pause(); }
  };
}
