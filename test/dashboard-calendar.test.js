import test from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarController, formatAllDayEvent, formatCalendarEvent, formatTimedEvent } from '../public/dashboard-calendar.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const event = { title: 'Planning', start: '2026-01-02T15:00:00.000Z', end: '2026-01-02T16:30:00.000Z', allDay: false, location: 'Office' };

function scheduler() {
  const tasks = new Map();
  let id = 0;
  return {
    tasks,
    schedule(fn, delay) { tasks.set(++id, { fn, delay }); return id; },
    cancel(key) { tasks.delete(key); }
  };
}

test('formats timed events in the dashboard timezone and all-day dates without drift', () => {
  assert.deepEqual(formatTimedEvent(event, { timezone: 'America/Los_Angeles', hour12: true }, { locale: 'en-US' }), { date: 'Fri, Jan 2', time: '7:00 AM - 8:30 AM' });
  assert.deepEqual(formatAllDayEvent({ start: '2026-01-02', end: '2026-01-03', allDay: true }, { locale: 'en-US' }), { date: 'Fri, Jan 2', time: 'All day' });
  assert.deepEqual(formatAllDayEvent({ start: '2026-01-02', end: '2026-01-05', allDay: true }, { locale: 'en-US' }), { date: 'Fri, Jan 2 - Sun, Jan 4', time: 'All day' });
  assert.equal(formatCalendarEvent(event, { timezone: 'UTC' }, { locale: 'en-GB', now: Date.parse('2026-01-02T15:30:00Z') }).timing, 'current');
  assert.equal(formatTimedEvent({ ...event, start: 'bad' }, { timezone: 'UTC' }), null);
  assert.equal(formatAllDayEvent({ start: '2026-02-30', end: '2026-03-01' }), null);
});

test('loads status and events, deduplicates refresh, and owns a five-minute timer', async () => {
  const timers = scheduler();
  const calls = [];
  let latest;
  const controller = createCalendarController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url === '/api/calendar' ? json({ configured: true, collectionUrl: 'https://calendar.test/work/', username: 'sam' }) : json({ configured: true, events: [event], stale: false });
  } });
  await tick();
  assert.deepEqual(calls.map(({ url }) => url), ['/api/calendar', '/api/calendar/events']);
  assert.equal(latest.events[0].title, 'Planning');
  assert.equal(timers.tasks.size, 1);
  assert.equal([...timers.tasks.values()][0].delay, 300000);

  let resolve;
  calls.length = 0;
  controller.dispose();
  const pendingController = createCalendarController({ onChange() {}, fetchImpl: (url) => {
    if (url === '/api/calendar') return Promise.resolve(json({ configured: true }));
    return new Promise((done) => { resolve = done; });
  } });
  await tick();
  const first = pendingController.refresh();
  const second = pendingController.refresh();
  assert.equal(first, second);
  resolve(json({ configured: true, events: [] }));
  await first;
  pendingController.dispose();
});

test('pauses while hidden or disabled and force refreshes with cache bypass', async () => {
  const timers = scheduler();
  const urls = [];
  const controller = createCalendarController({ ...timers, onChange() {}, fetchImpl: async (url) => {
    urls.push(url);
    return url === '/api/calendar' ? json({ configured: true }) : json({ configured: true, events: [] });
  } });
  await tick();
  controller.setVisible(false);
  assert.equal(timers.tasks.size, 0);
  controller.setVisible(true);
  await tick();
  assert.equal(urls.at(-1), '/api/calendar/events');
  controller.configure({ calendarVisible: false });
  assert.equal(timers.tasks.size, 0);
  controller.configure({ calendarVisible: true });
  await tick();
  await controller.forceRefresh();
  assert.equal(urls.at(-1), '/api/calendar/events?refresh=1');
  assert.equal(timers.tasks.size, 1);
  controller.dispose();
});

test('connects atomically, disconnects, and retains a stale snapshot after refresh failure', async () => {
  const timers = scheduler();
  const requests = [];
  let latest;
  let failEvents = false;
  const controller = createCalendarController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (options.method === 'PUT') return json({ configured: true, collectionUrl: 'https://calendar.test/work/', username: 'sam', events: [event], stale: false });
    if (options.method === 'DELETE') return { ok: true, status: 204 };
    if (url === '/api/calendar') return json({ configured: false });
    return failEvents ? json({ error: 'Temporarily unavailable' }, 503) : json({ configured: true, events: [event] });
  } });
  await tick();
  await controller.connect({ collectionUrl: ' https://calendar.test/work/ ', username: ' sam ', password: 'secret' });
  const put = requests.find(({ options }) => options.method === 'PUT');
  assert.deepEqual(JSON.parse(put.options.body), { collectionUrl: 'https://calendar.test/work/', username: 'sam', password: 'secret' });
  assert.equal(latest.events.length, 1);
  failEvents = true;
  await controller.forceRefresh();
  assert.equal(latest.stale, true);
  assert.equal(latest.events.length, 1);
  assert.match(latest.error, /Temporarily unavailable/);
  await controller.disconnect();
  assert.equal(latest.configured, false);
  assert.deepEqual(latest.events, []);
  assert.equal(timers.tasks.size, 0);
  controller.dispose();
});

test('deduplicates duplicate connection submissions', async () => {
  let resolveConnect;
  let puts = 0;
  const controller = createCalendarController({ onChange() {}, fetchImpl: (url, options) => {
    if (options.method === 'PUT') {
      puts++;
      return new Promise((resolve) => { resolveConnect = resolve; });
    }
    return Promise.resolve(json({ configured: false }));
  } });
  await tick();
  const credentials = { collectionUrl: 'https://calendar.test/work/', username: 'sam', password: 'secret' };
  const first = controller.connect(credentials);
  const second = controller.connect(credentials);
  assert.equal(first, second);
  assert.equal(puts, 1);
  resolveConnect(json({ configured: true, events: [] }));
  await first;
  controller.dispose();
});

test('aborts obsolete work and ignores late results after reconnect and disposal', async () => {
  const pending = [];
  const states = [];
  const controller = createCalendarController({ onChange: (state) => states.push(state), fetchImpl: (url, options) => new Promise((resolve) => pending.push({ url, options, resolve })) });
  assert.equal(pending[0].url, '/api/calendar');
  const connect = controller.connect({ collectionUrl: 'https://new.test/calendar/', username: 'new', password: 'secret' });
  assert.equal(pending[0].options.signal.aborted, true);
  pending[1].resolve(json({ configured: true, username: 'new', events: [event] }));
  await connect;
  pending[0].resolve(json({ configured: true, username: 'old' }));
  await tick();
  assert.equal(states.at(-1).username, 'new');

  const refresh = controller.forceRefresh();
  const active = pending.at(-1);
  controller.dispose();
  assert.equal(active.options.signal.aborted, true);
  active.resolve(json({ configured: true, events: [{ ...event, title: 'Late' }] }));
  await refresh;
  assert.equal(states.at(-1).events[0].title, 'Planning');
});

test('normalizes untrusted event fields before publishing state', async () => {
  let latest;
  const controller = createCalendarController({ onChange: (state) => { latest = state; }, fetchImpl: async (url) => url === '/api/calendar'
    ? json({ configured: true, password: 'not public' })
    : json({ configured: true, events: [{ ...event, uid: 'private', href: '/dav/private.ics', title: ' x '.repeat(200) }, { start: 'invalid', end: 'invalid' }] }) });
  await tick();
  assert.equal(latest.events.length, 1);
  assert.equal(latest.events[0].title.length, 240);
  assert.equal(latest.events[0].uid, undefined);
  assert.equal(latest.events[0].href, undefined);
  assert.equal(latest.password, undefined);
  controller.dispose();
});

test('clears private browser snapshots when CalDAV requires re-authentication', async () => {
  let unauthorized = false;
  let latest;
  const controller = createCalendarController({ onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    if (url === '/api/calendar') return json({ configured: true });
    return unauthorized ? json({ configured: true, needsReauthentication: true, error: 'Calendar needs re-authentication.' }, 401) : json({ configured: true, events: [event] });
  } });
  await tick();
  assert.equal(latest.events.length, 1);
  unauthorized = true;
  await controller.forceRefresh();
  assert.equal(latest.needsReauthentication, true);
  assert.deepEqual(latest.events, []);
  assert.equal(latest.stale, false);
  controller.dispose();

  const timers = scheduler();
  const initial = createCalendarController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: async (url) => url === '/api/calendar' ? json({ configured: true }) : json({ configured: true, error: 'Calendar needs re-authentication.' }, 401) });
  await tick();
  assert.equal(latest.needsReauthentication, true);
  assert.equal(timers.tasks.size, 0);
  initial.dispose();
});

test('stops retries and clears snapshots when Baikal denies calendar access', async () => {
  const timers = scheduler();
  let denied = false;
  let latest;
  const controller = createCalendarController({ ...timers, onChange: (state) => { latest = state; }, fetchImpl: async (url) => {
    if (url === '/api/calendar') return json({ configured: true });
    return denied ? json({ configured: true, accessDenied: true, error: 'Baikal denied calendar access.' }, 403) : json({ configured: true, events: [event] });
  } });
  await tick();
  assert.equal(latest.events.length, 1);
  denied = true;
  await controller.forceRefresh();
  assert.equal(latest.accessDenied, true);
  assert.equal(latest.needsReauthentication, false);
  assert.deepEqual(latest.events, []);
  assert.equal(timers.tasks.size, 0);
  controller.dispose();
});
