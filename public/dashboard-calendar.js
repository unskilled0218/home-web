const REFRESH_MS = 5 * 60 * 1000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function safeText(value, limit = 240) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function validDate(value) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() + 1 === Number(match[2]) && date.getUTCDate() === Number(match[3]) ? date : null;
}

function validZone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return value;
  } catch {
    return 'UTC';
  }
}

function formatter(locale, options) {
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat(undefined, options);
  }
}

function previousDate(value) {
  const date = validDate(value);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatAllDayEvent(event, { locale } = {}) {
  const start = validDate(event?.start);
  const lastDate = previousDate(event?.end);
  const end = lastDate && lastDate >= event.start ? validDate(lastDate) : start;
  if (!start || !end) return null;
  const dateFormat = formatter(locale, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  return {
    date: start.getTime() === end.getTime() ? dateFormat.format(start) : `${dateFormat.format(start)} - ${dateFormat.format(end)}`,
    time: 'All day'
  };
}

export function formatTimedEvent(event, settings = {}, { locale } = {}) {
  const start = new Date(event?.start);
  const end = new Date(event?.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
  const timeZone = validZone(settings.timezone);
  const dateFormat = formatter(locale, { timeZone, weekday: 'short', month: 'short', day: 'numeric' });
  const timeFormat = formatter(locale, { timeZone, hour: 'numeric', minute: '2-digit', hour12: settings.hour12 === true });
  const startDate = dateFormat.format(start);
  const endDate = dateFormat.format(end);
  return {
    date: startDate === endDate ? startDate : `${startDate} - ${endDate}`,
    time: `${timeFormat.format(start)} - ${timeFormat.format(end)}`
  };
}

export function formatCalendarEvent(event, settings = {}, { locale, now = Date.now() } = {}) {
  const formatted = event?.allDay ? formatAllDayEvent(event, { locale }) : formatTimedEvent(event, settings, { locale });
  if (!formatted) return null;
  if (event.allDay) return { ...formatted, timing: 'all-day' };
  const start = Date.parse(event.start);
  const end = Date.parse(event.end);
  return { ...formatted, timing: now >= start && now < end ? 'current' : 'upcoming' };
}

function normalizeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const title = safeText(value.title, 240) || 'Untitled event';
  const location = safeText(value.location, 240);
  if (value.allDay === true) {
    if (!validDate(value.start) || !validDate(value.end)) return null;
    return { title, start: value.start, end: value.end, allDay: true, ...(location && { location }) };
  }
  const start = new Date(value.start);
  const end = new Date(value.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return null;
  return { title, start: start.toISOString(), end: end.toISOString(), allDay: false, ...(location && { location }) };
}

function statusFields(value) {
  const status = value && typeof value === 'object' ? value : {};
  return {
    configured: status.configured === true,
    configurationId: typeof status.configurationId === 'string' ? status.configurationId : null,
    encryptionReady: status.encryptionReady !== false,
    needsReauthentication: status.needsReauthentication === true || status.reauthenticationRequired === true,
    serverUrl: safeText(status.serverUrl, 2048),
    username: safeText(status.username, 120),
    updatedAt: safeText(status.updatedAt, 80)
  };
}

function eventFields(value) {
  const result = value && typeof value === 'object' ? value : {};
  return {
    configured: result.configured === true,
    events: (Array.isArray(result.events) ? result.events : []).slice(0, 10).map(normalizeEvent).filter(Boolean),
    stale: result.stale === true
  };
}

async function responseJson(response) {
  let body = {};
  try { body = await response.json(); } catch { /* A missing error body is handled below. */ }
  if (!response.ok) {
    const error = new Error(safeText(body?.error ?? body?.message, 240) || 'Calendar request failed.');
    error.status = response.status;
    error.code = body?.code;
    throw error;
  }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

export function createCalendarController({
  onChange,
  fetchImpl = fetch,
  schedule = setTimeout,
  cancel = clearTimeout,
  refreshMs = REFRESH_MS,
  timeoutMs = 25000,
  autoStart = true
}) {
  if (typeof onChange !== 'function') throw new TypeError('onChange is required');
  let state = { ...statusFields({}), events: [], stale: false, loading: true, unavailable: false, error: '' };
  let visible = true;
  let enabled = true;
  let disposed = false;
  let statusLoaded = false;
  let hasSnapshot = false;
  let generation = 0;
  let timer;
  let controller;
  let pending;
  let pendingKind;
  let configurationEpoch = 0;

  const active = () => visible && enabled;
  function emit(patch = {}) {
    if (disposed) return;
    state = { ...state, ...patch };
    onChange({ ...state, events: state.events.map((event) => ({ ...event })) });
  }
  function clearTimer() {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  }
  function invalidate() {
    generation++;
    clearTimer();
    controller?.abort();
    controller = undefined;
    pending = undefined;
    pendingKind = undefined;
  }
  function scheduleRefresh() {
    clearTimer();
    if (!disposed && active() && state.configured && !state.needsReauthentication && !state.accessDenied) timer = schedule(() => { timer = undefined; void refresh(); }, refreshMs);
  }
  function begin(kind) {
    invalidate();
    const request = generation;
    controller = new AbortController();
    pendingKind = kind;
    return { request, signal: controller.signal };
  }
  const current = (request) => !disposed && request === generation;
  async function getJson(url, signal, options = {}) {
    const request = new AbortController(); const abort = () => request.abort(); signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const deadline = schedule(() => request.abort(), timeoutMs); let response;
    try {
      const interrupted = new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(Object.assign(new Error('Calendar request outcome could not be confirmed. Checking shared status.'), { code: 'CALENDAR_REQUEST_TIMEOUT' })), { once: true }));
      return await Promise.race([(async () => {
        response = await fetchImpl(url, { ...options, signal: request.signal, credentials: 'same-origin', headers: { Accept: 'application/json', ...options.headers } });
        if (request.signal.aborted) { await response.body?.cancel().catch(() => {}); throw new Error('Calendar request canceled.'); }
        if (response.status === 204) return {};
        return await responseJson(response);
      })(), interrupted]);
    } finally { cancel(deadline); signal?.removeEventListener('abort', abort); if (request.signal.aborted && response?.body && !response.body.locked) await response.body.cancel().catch(() => {}); }
  }
  function finish(request) {
    if (!current(request)) return;
    controller = undefined;
    pending = undefined;
    pendingKind = undefined;
    scheduleRefresh();
  }
  function applyEvents(data) {
    if (data.configurationId !== undefined && data.configurationId !== state.configurationId) throw Object.assign(new Error('Calendar source changed.'), { status: 409 });
    const result = eventFields(data);
    hasSnapshot = true;
    emit({ configured: result.configured, events: result.events, stale: result.stale, loading: false, unavailable: false, needsReauthentication: false, accessDenied: false, error: '' });
  }
  function applyRequestFailure(error) {
    if (error.status === 401 || error.status === 403) {
      configurationEpoch++;
      hasSnapshot = false;
      emit({ events: [], stale: false, loading: false, unavailable: false, needsReauthentication: error.status === 401, accessDenied: error.status === 403, error: safeText(error.message) || (error.status === 401 ? 'Calendar needs re-authentication.' : 'Calendar access was denied.') });
    } else emit({ loading: false, stale: hasSnapshot, unavailable: !hasSnapshot, error: safeText(error.message) || 'Calendar unavailable.' });
  }

  function start() {
    if (disposed) return;
    if (pending) return pending;
    if (statusLoaded) return active() && state.configured ? refresh() : undefined;
    const { request, signal } = begin('status');
    emit({ loading: true, unavailable: false, error: '' });
    pending = (async () => {
      try {
        const status = statusFields(await getJson('/api/calendar', signal));
        if (!current(request)) return;
        statusLoaded = true;
        if (['configurationId', 'configured', 'encryptionReady', 'needsReauthentication', 'serverUrl', 'username'].some((key) => status[key] !== state[key])) configurationEpoch++;
        emit({ ...status, loading: status.configured && active(), unavailable: false, error: '' });
        if (status.configured && active()) {
          pendingKind = 'events';
          applyEvents(await getJson('/api/calendar/events', signal));
        }
        else emit({ loading: false });
      } catch (error) {
        if (!current(request) || signal.aborted) return;
        applyRequestFailure(error);
      } finally {
        finish(request);
      }
    })();
    return pending;
  }

  function refresh() {
    if (disposed || !active()) return;
    if (!statusLoaded) return start();
    if (!state.configured || state.needsReauthentication || state.accessDenied) return;
    if (pending && pendingKind === 'events') return pending;
    const { request, signal } = begin('events');
    emit({ loading: true, error: '' });
    pending = (async () => {
      try {
        applyEvents(await getJson('/api/calendar/events', signal));
      } catch (error) {
        if (!current(request) || signal.aborted) return;
        if (error.status === 409) { configurationEpoch++; invalidate(); statusLoaded = false; hasSnapshot = false; emit({ events: [], loading: false }); void start(); return; }
        applyRequestFailure(error);
      } finally {
        finish(request);
      }
    })();
    return pending;
  }

  function connect(credentials) {
    if (disposed) return;
    if (pending && pendingKind === 'connect') return pending;
    configurationEpoch++;
    const { request, signal } = begin('connect');
    emit({ loading: true, error: '' });
    pending = (async () => {
      try {
        const data = await getJson('/api/calendar', signal, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverUrl: safeText(credentials?.serverUrl, 2048),
            username: safeText(credentials?.username, 120),
            password: typeof credentials?.password === 'string' ? credentials.password.slice(0, 2000) : ''
          })
        });
        if (!current(request)) return;
        statusLoaded = true;
        const status = statusFields({ ...data, configured: true });
        const events = eventFields({ ...data, configured: true });
        hasSnapshot = true;
        emit({ ...status, events: events.events, stale: events.stale, loading: false, unavailable: false, error: '' });
      } catch (error) {
        if (!current(request) || signal.aborted) return;
        emit({ loading: false, error: safeText(error.message) || 'Could not connect calendar.' });
      } finally {
        configurationEpoch++;
        finish(request);
      }
    })();
    return pending;
  }

  function disconnect() {
    if (disposed) return;
    if (pending && pendingKind === 'disconnect') return pending;
    configurationEpoch++;
    const { request, signal } = begin('disconnect');
    emit({ loading: true, error: '' });
    pending = (async () => {
      try {
        await getJson('/api/calendar', signal, { method: 'DELETE' });
        if (!current(request)) return;
        statusLoaded = true;
        hasSnapshot = false;
        emit({ ...statusFields({}), events: [], stale: false, loading: false, unavailable: false, error: '' });
      } catch (error) {
        if (!current(request) || signal.aborted) return;
        emit({ loading: false, error: safeText(error.message) || 'Could not disconnect calendar.' });
      } finally {
        configurationEpoch++;
        finish(request);
      }
    })();
    return pending;
  }

  function pauseEvents() {
    clearTimer();
    if (pendingKind === 'events') invalidate();
    if (state.loading && statusLoaded) emit({ loading: false });
  }

  const api = {
    start,
    configure(next = {}) {
      const nextEnabled = typeof next === 'boolean' ? next : next.calendarVisible ?? next.enabled ?? true;
      const wasActive = active();
      enabled = nextEnabled === true;
      if (['connect', 'disconnect'].includes(pendingKind)) { clearTimer(); return; }
      if (!active()) pauseEvents();
      else if (!wasActive) void (statusLoaded ? refresh() : start());
      else scheduleRefresh();
    },
    setVisible(next) {
      const wasActive = active();
      visible = next === true;
      if (!active()) pauseEvents();
      else if (!wasActive) void (statusLoaded ? refresh() : start());
    },
    refresh,
    connect,
    disconnect,
    dispose() { if (disposed) return; disposed = true; invalidate(); },
    getState() { return { ...state, events: state.events.map((event) => ({ ...event })) }; },
    captureConfigurationObserver() {
      const epoch = configurationEpoch; const mutating = ['connect', 'disconnect'].includes(pendingKind);
      return (metadata, nextEnabled = enabled) => {
        if (disposed || mutating || ['connect', 'disconnect'].includes(pendingKind) || epoch !== configurationEpoch || !metadata.available) return false;
        const next = statusFields(metadata);
        const changed = !statusLoaded || ['configurationId', 'configured', 'encryptionReady', 'serverUrl', 'username'].some((key) => next[key] !== state[key]);
        const eligibilityChanged = enabled !== nextEnabled; enabled = nextEnabled;
        if (!changed) { if (eligibilityChanged) { if (active()) void refresh(); else pauseEvents(); } return true; }
        const sameSource = statusLoaded && next.configurationId === state.configurationId;
        const needsReauthentication = sameSource && state.needsReauthentication;
        const accessDenied = sameSource && state.accessDenied;
        configurationEpoch++; invalidate(); statusLoaded = true;
        if (!sameSource || !next.configured) hasSnapshot = false;
        emit({ ...next, events: hasSnapshot ? state.events : [], loading: false, stale: hasSnapshot && state.stale, unavailable: false, error: sameSource ? state.error : '', needsReauthentication: next.needsReauthentication || Boolean(needsReauthentication), accessDenied: Boolean(accessDenied) });
        if (active()) void refresh();
        return true;
      };
    }
  };
  if (autoStart) void start();
  return api;
}
