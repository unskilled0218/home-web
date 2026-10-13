import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarController } from '../public/dashboard-calendar.js';
import { createWeatherController } from '../public/dashboard-weather.js';
import { createBookmarkController } from '../public/dashboard-bookmarks.js';
import { normalizeSettings } from '../public/dashboard-helpers.js';
import { normalizeForecast } from '../public/weather-data.js';
import { rawForecast, epoch } from './fixtures/weather.js';

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };
function timers() { const tasks = new Map(); let id = 0; return { tasks, schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; }, cancel(key) { tasks.delete(key); } }; }
const event = { title: 'Shared event', start: '2026-10-11T13:00:00Z', end: '2026-10-11T14:00:00Z', allDay: false };
const one = 'configuration-calendar-one'; const two = 'configuration-calendar-two';

test('calendar observes remote connections with hidden eligibility atomically and rejects old observers', async (t) => {
  const clock = timers(); let latest; let calls = 0; let cfg = one;
  const calendar = createCalendarController({ ...clock, autoStart: false, onChange: (state) => { latest = state; }, fetchImpl: async () => { calls++; return Response.json({ configured: true, configurationId: cfg, events: [event] }); } }); t.after(() => calendar.dispose());
  calendar.captureConfigurationObserver()({ available: true, configured: false, configurationId: null }, false);
  calendar.captureConfigurationObserver()({ available: true, configured: true, configurationId: one, serverUrl: 'https://cal.test', username: 'sam' }, false); await settle();
  assert.equal(latest.configured, true); assert.equal(calls, 0);
  calendar.captureConfigurationObserver()({ available: true, configured: true, configurationId: one, serverUrl: 'https://cal.test', username: 'sam' }, true); await settle(); assert.equal(calls, 1); assert.equal(latest.events.length, 1);
  for (let i = 0; i < 10; i++) calendar.captureConfigurationObserver()({ available: true, configured: true, configurationId: one, serverUrl: 'https://cal.test', username: 'sam' }, true);
  assert.equal(calls, 1); const old = calendar.captureConfigurationObserver(); cfg = two;
  calendar.captureConfigurationObserver()({ available: true, configured: true, configurationId: two, serverUrl: 'https://cal.test', username: 'sam' }, true); await settle(); old({ available: true, configured: false, configurationId: null }, true);
  assert.equal(latest.configurationId, two); assert.equal(clock.tasks.size, 1);
});

test('calendar access retirement cannot be lifted by same source status, but a new source restores events', async (t) => {
  const clock = timers(); let cfg = one; let fail = false; let latest;
  const calendar = createCalendarController({ ...clock, autoStart: false, onChange: (state) => { latest = state; }, fetchImpl: async () => fail ? Response.json({ error: 'Denied' }, { status: 403 }) : Response.json({ configured: true, configurationId: cfg, events: [event] }) }); t.after(() => calendar.dispose());
  const metadata = () => ({ available: true, configured: true, configurationId: cfg, serverUrl: 'https://cal.test', username: 'sam' });
  calendar.captureConfigurationObserver()(metadata(), true); await settle(); fail = true; await calendar.refresh(); assert.equal(latest.accessDenied, true);
  calendar.captureConfigurationObserver()(metadata(), true); await settle(); assert.equal(latest.accessDenied, true); assert.equal(latest.events.length, 0);
  fail = false; cfg = two; calendar.captureConfigurationObserver()(metadata(), true); await settle(); assert.equal(latest.accessDenied, false); assert.equal(latest.events.length, 1);
});

test('a timed out reconnect cannot report success from the previously configured state', async (t) => {
  const clock = timers(); let pending = false; let latest;
  const calendar = createCalendarController({ ...clock, autoStart: false, onChange: (state) => { latest = state; }, fetchImpl: async (_url, options) => options.method === 'PUT' ? new Promise(() => {}) : Response.json({ configured: true, configurationId: one, events: [event] }) }); t.after(() => calendar.dispose());
  calendar.captureConfigurationObserver()({ available: true, configured: true, configurationId: one }, true); await settle(); const observer = calendar.captureConfigurationObserver();
  const operation = calendar.connect({ serverUrl: 'https://new.test', username: 'sam', password: 'secret' }); pending = true;
  const [key, deadline] = [...clock.tasks].find(([, value]) => value.delay === 25000); clock.tasks.delete(key); deadline.fn(); await operation; pending = false;
  assert.equal(latest.configured, true); assert.match(latest.error, /could not be confirmed/); assert.equal(pending, false);
  observer({ available: true, configured: false, configurationId: null }); assert.equal(latest.configured, true);
});

test('weather location observation is prompt, preserves cached timestamps for the same location, and no-ops on repeats', async (t) => {
  const clock = timers(); let latest; let calls = 0; let location = { latitude: 51, longitude: 0, label: 'London' }; let revision = 1;
  const weather = createWeatherController({ ...clock, autoStart: false, onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    calls++; if (url === '/api/weather/refresh') return Response.json({ scheduled: false, refreshing: false });
    return Response.json({ configured: true, location, revision, timezone: 'UTC', forecastRegistered: true, forecast: normalizeForecast(rawForecast()), air: { aqi: 20 }, forecastUpdated: epoch, airUpdated: epoch, forecastError: false, airError: false, refreshing: false });
  } }); t.after(() => weather.dispose()); weather.configure(normalizeSettings({ timezone: 'UTC' }));
  weather.captureConfigurationObserver()({ available: true, revision, location }); await settle(); assert.equal(latest.forecastUpdated, epoch);
  const count = calls; for (let i = 0; i < 5; i++) weather.captureConfigurationObserver()({ available: true, revision, location }); assert.equal(calls, count);
  weather.captureConfigurationObserver()({ available: true, revision, location: { label: location.label, longitude: location.longitude, latitude: location.latitude } }); assert.equal(calls, count, 'JSON property order is not a configuration change');
  const old = weather.captureConfigurationObserver(); revision = 2; location = { ...location, label: 'London, UK' }; weather.captureConfigurationObserver()({ available: true, revision, location }); await settle(); old({ available: true, revision: 0, location: null });
  assert.equal(latest.location.label, 'London, UK'); assert.equal(latest.forecastUpdated, epoch);
});

test('bookmark configuration observers bootstrap a disconnected client and ignore obsolete source metadata', async (t) => {
  const clock = timers(); let latest; let cfg = one; let calls = 0;
  const metadata = () => ({ available: true, configured: true, configurationId: cfg, encryptionReady: true, accessTokenPresent: true, baseUrl: 'https://links.test', username: 'sam' });
  const bookmarks = createBookmarkController({ ...clock, onChange: (state) => { latest = state; }, fetchImpl: async (url) => { calls++; return Response.json(url === '/api/linkwarden' ? { linkwarden: metadata() } : { configurationId: cfg, collections: [] }); } }); t.after(() => bookmarks.dispose());
  bookmarks.captureConfigurationObserver()({ available: true, configured: false, configurationId: null, encryptionReady: true });
  bookmarks.captureConfigurationObserver()(metadata()); await settle(); assert.equal(latest.configured, true); const count = calls;
  for (let i = 0; i < 5; i++) bookmarks.captureConfigurationObserver()(metadata()); assert.equal(calls, count);
  const old = bookmarks.captureConfigurationObserver(); cfg = two; bookmarks.captureConfigurationObserver()(metadata()); await settle(); old({ available: true, configured: false, configurationId: null, encryptionReady: true }); assert.equal(latest.configurationId, two);
});
