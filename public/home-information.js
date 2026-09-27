import { clockText, sampleHours, temperatureRange, weatherDescription, weatherIconFile } from './dashboard-helpers.js';
import { createWeatherController } from './dashboard-weather.js';
import { createCalendarController, formatCalendarEvent } from './dashboard-calendar.js';

export function createHomeInformation({ document = globalThis.document } = {}) {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text) => { const element = document.createElement(tag); element.textContent = text; return element; };
  let preferences = { timezone: 'UTC', dateStyle: 'medium' }; let active = new Set(); let visible = !document.hidden; let clockTimer; let lastWeather = {}; let lastCalendar = {}; let settingsOpen = false;
  const value = (number, unit = '') => number === null || number === undefined ? 'Unavailable' : `${number}${unit}`;
  function clock() { const now = new Date(); const text = clockText(now, preferences); $('home-date').textContent = text.date; $('home-clock').textContent = text.time; $('home-clock').dateTime = now.toISOString(); }
  function icon(code, day) { const image = document.createElement('img'); image.src = `/weather-icons/${weatherIconFile(code, day)}`; image.alt = ''; return image; }
  function forecastItem(code, day, label, temperature) { const li = document.createElement('li'); li.append(icon(code, day), node('span', label), node('strong', temperature), node('span', weatherDescription(code, day))); return li; }
  function renderWeather(state) {
    lastWeather = state;
    $('home-weather-status').textContent = !preferences.location ? 'Choose a weather location in Settings.' : state.forecastError ? (state.forecast ? 'Forecast is stale. Retrying hourly.' : 'Forecast unavailable. Retrying hourly.') : state.loading ? 'Updating weather…' : '';
    $('home-weather-current').replaceChildren(); $('home-hourly').replaceChildren(); $('home-daily').replaceChildren();
    const data = state.forecast;
    if (data) {
      const current = data.current;
      $('home-weather-current').append(icon(current.weather_code, current.is_day), node('strong', value(current.temperature_2m, data.units.temperature_2m)), node('span', weatherDescription(current.weather_code, current.is_day)), node('p', `Wind ${value(current.wind_speed_10m, data.units.wind_speed_10m)} · Humidity ${value(current.relative_humidity_2m, data.units.relative_humidity_2m)} · Precipitation ${value(current.precipitation, data.units.precipitation)}`));
      for (const hour of sampleHours(data.hourly)) $('home-hourly').append(forecastItem(hour.code, hour.day, new Intl.DateTimeFormat(undefined, { timeZone: preferences.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: preferences.hour12 }).format(new Date(hour.time * 1000)), value(hour.temperature, data.hourlyUnit)));
      for (const day of data.daily) $('home-daily').append(forecastItem(day.code, 1, new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T12:00:00Z`)), temperatureRange(day.min, day.max, data.dailyUnit)));
    }
    $('home-air').textContent = !preferences.location ? '' : state.air ? `US AQI: ${state.air.aqi}${state.airError ? ' (stale)' : ''} · CAMS ENSEMBLE` : state.airError ? 'Air quality unavailable.' : '';
  }
  function renderCalendar(state) {
    lastCalendar = state;
    $('home-calendar-status').textContent = state.needsReauthentication ? 'Calendar needs re-authentication in Settings.' : state.accessDenied ? 'Calendar access denied.' : !state.configured ? 'Connect a calendar in Settings.' : state.error ? `${state.error}${state.events?.length ? ' Showing stale events.' : ''}` : state.stale ? 'Showing stale calendar events.' : state.loading && !state.events?.length ? 'Loading calendar…' : !state.events?.length ? 'No events in the next 14 days.' : '';
    $('home-events').replaceChildren();
    for (const event of state.events ?? []) {
      const formatted = formatCalendarEvent(event, preferences); if (!formatted) continue;
      const li = document.createElement('li'); li.append(node('strong', event.title), node('span', `${formatted.date} · ${formatted.timing === 'current' ? 'Now · ' : ''}${formatted.time}`)); if (event.location) li.append(node('span', event.location)); $('home-events').append(li);
    }
  }
  const weather = createWeatherController({ onChange: renderWeather });
  const calendar = createCalendarController({ onChange: renderCalendar });
  calendar.configure({ calendarVisible: false });
  weather.setVisible(visible); calendar.setVisible(visible);
  function apply() {
    clearInterval(clockTimer); if (active.has('time')) { clock(); if (visible) clockTimer = setInterval(clock, 1000); }
    weather.configure({ ...preferences, weatherVisible: active.has('weather') }); weather.setVisible(visible);
    calendar.configure({ ...preferences, calendarVisible: active.has('calendar') || settingsOpen }); calendar.setVisible(visible);
    renderWeather(lastWeather); renderCalendar(lastCalendar);
  }
  const form = $('home-calendar-form');
  function fill() { const state = calendar.getState(); form.elements.serverUrl.value = state.serverUrl ?? ''; form.elements.username.value = state.username ?? ''; form.elements.password.value = ''; }
  function pending(value) { $('home-calendar-connect').disabled = value; $('home-calendar-disconnect').disabled = value; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); pending(true);
    try { await calendar.connect(Object.fromEntries(new FormData(form))); $('home-calendar-message').textContent = calendar.getState().error || 'Calendar connected.'; fill(); }
    finally { pending(false); }
  });
  $('home-calendar-disconnect').addEventListener('click', async () => {
    if (!confirm('Disconnect calendar and delete its saved credentials?')) return;
    pending(true); try { await calendar.disconnect(); $('home-calendar-message').textContent = calendar.getState().error || 'Calendar disconnected.'; fill(); } finally { pending(false); }
  });
  $('home-calendar-close').addEventListener('click', () => $('home-calendar-dialog').close());
  $('home-calendar-dialog').addEventListener('close', () => { settingsOpen = false; apply(); });
  return {
    configure(ids, next) { active = new Set(ids); preferences = next; apply(); },
    setVisible(next) { visible = next; apply(); },
    async openCalendar() { settingsOpen = true; apply(); await calendar.start(); fill(); $('home-calendar-dialog').showModal(); },
    dispose() { clearInterval(clockTimer); weather.dispose(); calendar.dispose(); }
  };
}
