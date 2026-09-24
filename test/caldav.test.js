import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildCalDavReport,
  createCalDavClient,
  extractCalendarData,
  isCalDavClientError,
  normalizeCalDavCredentials,
  parseCalendarEvents
} from '../src/caldav.js';

const rangeStart = Date.parse('2026-03-07T12:00:00.000Z');
const rangeEnd = rangeStart + 14 * 86_400_000;

function calendar(events) {
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

function event(lines) {
  return `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
}

function multiStatus(calendars = []) {
  const responses = calendars.map((value) => `<d:response><d:propstat><d:prop><c:calendar-data>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`).join('');
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`;
}

function xmlResponse(calendars, init = {}) {
  return new Response(multiStatus(calendars), { status: 207, headers: { 'content-type': 'application/xml; charset=utf-8', ...init.headers }, ...init });
}

test('normalizes exact CalDAV collection credentials', () => {
  assert.deepEqual(normalizeCalDavCredentials({ collectionUrl: ' https://baikal.example.test/dav.php/calendars/user/default// ', username: ' user ', password: ' secret value ' }), {
    collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default/',
    username: 'user',
    password: ' secret value '
  });
  assert.deepEqual(normalizeCalDavCredentials(
    { collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default', username: 'user', password: '' },
    { collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default/', username: 'user' }
  ), { collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default/', username: 'user', password: null });
  for (const collectionUrl of ['file:///tmp/calendar', 'https://user@baikal.test/calendar', 'https://baikal.test/calendar?q=1', 'https://baikal.test/calendar#fragment']) {
    assert.throws(() => normalizeCalDavCredentials({ collectionUrl, username: 'user', password: 'secret' }), /collection URL/);
  }
  assert.throws(() => normalizeCalDavCredentials({ collectionUrl: 'https://baikal.test/calendar', username: 'bad:user', password: 'secret' }), /colon/);
  assert.throws(() => normalizeCalDavCredentials({ collectionUrl: 'https://baikal.test/calendar', username: 'user', password: '' }), /password/);
});

test('builds the minimal Baikal-compatible expanded REPORT from RFC 4791', () => {
  const report = buildCalDavReport(rangeStart, rangeEnd);
  assert.equal(report.match(/20260307T120000Z/g).length, 2);
  assert.equal(report.match(/20260321T120000Z/g).length, 2);
  assert.match(report, /calendar-query/);
  assert.match(report, /time-range/);
  assert.match(report, /<c:expand/);
  assert.match(report, /<c:calendar-data>\s*<c:expand[^>]*\/>\s*<\/c:calendar-data>/);
  assert.doesNotMatch(report.match(/<c:calendar-data>([\s\S]*?)<\/c:calendar-data>/)[1], /<c:comp\s/);
});

test('extracts namespaced escaped and CDATA calendar data from bounded XML', () => {
  const xml = '<?xml version="1.0"?><x:multistatus xmlns:x="DAV:" xmlns:z="urn:ietf:params:xml:ns:caldav"><x:response><x:href>/dav/event&amp;one.ics</x:href><x:propstat><x:prop><z:calendar-data>BEGIN:VCALENDAR\r\nSUMMARY:A &amp; B\r\nEND:VCALENDAR</z:calendar-data></x:prop><x:status>HTTP/1.1 200 OK</x:status></x:propstat></x:response><x:response><x:propstat><x:prop><z:calendar-data><![CDATA[BEGIN:VCALENDAR\r\nSUMMARY:<literal>\r\nEND:VCALENDAR]]></z:calendar-data></x:prop><x:status><![CDATA[HTTP/1.1 200 OK]]></x:status></x:propstat></x:response></x:multistatus>';
  assert.deepEqual(extractCalendarData(xml), [
    'BEGIN:VCALENDAR\r\nSUMMARY:A & B\r\nEND:VCALENDAR',
    'BEGIN:VCALENDAR\r\nSUMMARY:<literal>\r\nEND:VCALENDAR'
  ]);
  assert.deepEqual(extractCalendarData('<multistatus xmlns="DAV:"/>'), []);
});

test('honors WebDAV propstat statuses instead of accepting failed resources', () => {
  const failed = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>private data</c:calendar-data></d:prop><d:status>HTTP/1.1 403 Forbidden</d:status></d:propstat></d:response></d:multistatus>';
  assert.throws(() => extractCalendarData(failed), /report failed/);
  const mixed = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:propstat><d:prop><c:calendar-data>ignored</c:calendar-data></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response><d:response><d:propstat><d:prop><c:calendar-data>${calendar([])}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  assert.deepEqual(extractCalendarData(mixed), [calendar([])]);
});

test('rejects malformed, entity-bearing, deeply nested, and oversized XML', () => {
  for (const xml of [
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>',
    '<x><y></x>',
    '<x>&private;</x>',
    '<x></x>trailing',
    `<x>${'<y>'.repeat(65)}${'</y>'.repeat(65)}</x>`,
    `<x>${'a'.repeat(2 * 1024 * 1024)}</x>`
  ]) assert.throws(() => extractCalendarData(xml), (error) => isCalDavClientError(error));
});

test('parses folded text, all-day defaults, UTC, offsets, and TZID wall times', () => {
  const data = calendar([
    event(['UID:all-day', 'DTSTART;VALUE=DATE:20260308', 'SUMMARY:All\\, day', 'LOCATION:Main\\; hall']),
    event(['UID:utc', 'DTSTART:20260308T130000Z', 'DTEND:20260308T140000Z', 'SUMMARY:Folded long', ' title']),
    event(['UID:offset', 'DTSTART:20260308T100000-0500', 'DTEND:20260308T110000-0500', 'SUMMARY:Offset']),
    event(['UID:dst', 'DTSTART;TZID=America/New_York:20260308T033000', 'DTEND;TZID=America/New_York:20260308T043000', 'SUMMARY:DST'])
  ]);
  assert.deepEqual(parseCalendarEvents([data], { rangeStart, rangeEnd }), [
    { title: 'All, day', start: '2026-03-08', end: '2026-03-09', allDay: true, location: 'Main; hall' },
    { title: 'DST', start: '2026-03-08T07:30:00.000Z', end: '2026-03-08T08:30:00.000Z', allDay: false },
    { title: 'Folded longtitle', start: '2026-03-08T13:00:00.000Z', end: '2026-03-08T14:00:00.000Z', allDay: false },
    { title: 'Offset', start: '2026-03-08T15:00:00.000Z', end: '2026-03-08T16:00:00.000Z', allDay: false }
  ]);
});

test('applies bounded RFC durations to timed and all-day events', () => {
  const data = calendar([
    event(['UID:timed-duration', 'DTSTART:20260308T130000Z', 'DURATION:+PT1H30M', 'SUMMARY:Timed duration']),
    event(['UID:day-duration', 'DTSTART;VALUE=DATE:20260309', 'DURATION:P3D', 'SUMMARY:Three days']),
    event(['UID:long-duration', 'DTSTART:20260310T130000Z', 'DURATION:P400D', 'SUMMARY:Long running']),
    event(['UID:invalid-duration', 'DTSTART:20260310T130000Z', 'DURATION:-PT1H', 'SUMMARY:Invalid']),
    event(['UID:conflict', 'DTSTART:20260311T130000Z', 'DTEND:20260311T140000Z', 'DURATION:PT1H', 'SUMMARY:Conflict'])
  ]);
  assert.deepEqual(parseCalendarEvents([data], { rangeStart, rangeEnd }), [
    { title: 'Timed duration', start: '2026-03-08T13:00:00.000Z', end: '2026-03-08T14:30:00.000Z', allDay: false },
    { title: 'Three days', start: '2026-03-09', end: '2026-03-12', allDay: true },
    { title: 'Long running', start: '2026-03-10T13:00:00.000Z', end: '2027-04-14T13:00:00.000Z', allDay: false }
  ]);
});

test('filters malformed, floating, cancelled, ended, and out-of-range events', () => {
  const data = calendar([
    event(['UID:current', 'DTSTART:20260307T110000Z', 'DTEND:20260307T130000Z', 'SUMMARY:Current']),
    event(['UID:ended', 'DTSTART:20260307T100000Z', 'DTEND:20260307T110000Z', 'SUMMARY:Ended']),
    event(['UID:floating', 'DTSTART:20260308T120000', 'SUMMARY:Floating']),
    event(['UID:impossible', 'DTSTART:20260230T120000Z', 'SUMMARY:Impossible']),
    event(['UID:gap', 'DTSTART;TZID=America/New_York:20260308T023000', 'SUMMARY:DST gap']),
    event(['UID:cancelled', 'DTSTART:20260308T120000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled']),
    event(['UID:late', 'DTSTART:20260322T120000Z', 'SUMMARY:Late'])
  ]);
  assert.deepEqual(parseCalendarEvents([data], { rangeStart, rangeEnd }), [
    { title: 'Current', start: '2026-03-07T11:00:00.000Z', end: '2026-03-07T13:00:00.000Z', allDay: false }
  ]);
});

test('deduplicates expanded instances and applies recurrence cancellations and limits', () => {
  const entries = [
    event(['UID:series', 'DTSTART:20260309T120000Z', 'SUMMARY:Original']),
    event(['UID:series', 'RECURRENCE-ID:20260309T120000Z', 'DTSTART:20260309T120000Z', 'SUMMARY:Override']),
    event(['UID:series', 'RECURRENCE-ID:20260310T120000Z', 'STATUS:CANCELLED']),
    event(['UID:series', 'RECURRENCE-ID:20260310T120000Z', 'DTSTART:20260310T120000Z', 'SUMMARY:Removed'])
  ];
  for (let index = 0; index < 15; index += 1) entries.push(event([`UID:item-${index}`, `DTSTART:2026031${index % 10}T1${index % 10}0000Z`, `SUMMARY:Item ${index}`]));
  const events = parseCalendarEvents([calendar(entries)], { rangeStart, rangeEnd });
  assert.equal(events.some(({ title }) => title === 'Removed'), false);
  assert.equal(events.filter(({ start }) => start === '2026-03-09T12:00:00.000Z').length, 1);
  assert.equal(events.find(({ start }) => start === '2026-03-09T12:00:00.000Z').title, 'Override');
  assert.equal(events.length, 10);
});

test('sends an exact authenticated REPORT and parses a safe result', async () => {
  const requests = [];
  const data = calendar([event(['UID:private-id', 'DTSTART:20260308T120000Z', 'SUMMARY:Meeting', 'LOCATION:Office'])]);
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: async (url, options) => {
    requests.push({ url, options });
    return xmlResponse([data]);
  } });
  const settings = { collectionUrl: 'https://baikal.example.test/dav.php/calendars/user/default/', username: 'üser', password: 'päss' };
  assert.deepEqual(await client.listEvents(settings), { events: [{ title: 'Meeting', start: '2026-03-08T12:00:00.000Z', end: '2026-03-08T12:00:00.000Z', allDay: false, location: 'Office' }], stale: false });
  assert.equal(requests[0].url, settings.collectionUrl);
  assert.equal(requests[0].options.method, 'REPORT');
  assert.equal(requests[0].options.headers.Depth, '1');
  assert.equal(requests[0].options.headers.Authorization, `Basic ${Buffer.from('üser:päss').toString('base64')}`);
  assert.match(requests[0].options.body, /20260307T120000Z/);
  assert.equal(JSON.stringify((await client.listEvents(settings)).events).includes('private-id'), false);
});

test('caches, deduplicates, forces refresh, falls back stale, and clears generations', async () => {
  let calls = 0;
  let resolveRequest;
  let fail = false;
  const empty = () => new Response('<d:multistatus xmlns:d="DAV:"/>', { status: 207, headers: { 'content-type': 'text/xml' } });
  const client = createCalDavClient({ now: () => rangeStart, cacheSeconds: 60, fetchImpl: async () => {
    calls += 1;
    if (fail) throw new Error('private upstream detail');
    if (calls === 1) return new Promise((resolve) => { resolveRequest = resolve; });
    return empty();
  } });
  const settings = { collectionUrl: 'https://baikal.test/calendar/', username: 'user', password: 'secret' };
  const first = client.listEvents(settings);
  const concurrent = client.listEvents(settings);
  assert.equal(calls, 1);
  resolveRequest(empty());
  assert.deepEqual(await Promise.all([first, concurrent]), [{ events: [], stale: false }, { events: [], stale: false }]);
  await client.listEvents(settings);
  assert.equal(calls, 1);
  await client.listEvents(settings, { force: true });
  assert.equal(calls, 2);
  fail = true;
  assert.deepEqual(await client.listEvents(settings, { force: true }), { events: [], stale: true });
  client.clearCache();
  await assert.rejects(client.listEvents(settings), (error) => isCalDavClientError(error) && !error.message.includes('private'));
});

test('does not serve stale events after authentication or protocol failures', async () => {
  let status = 207;
  const data = calendar([event(['UID:private', 'DTSTART:20260308T120000Z', 'SUMMARY:Private meeting'])]);
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: async () => status === 207 ? xmlResponse([data]) : new Response('', { status }) });
  const settings = { collectionUrl: 'https://baikal.test/calendar/', username: 'user', password: 'secret' };
  await client.listEvents(settings);
  status = 401;
  await assert.rejects(client.listEvents(settings, { force: true }), /username or password/);
  await assert.rejects(client.listEvents(settings), /username or password/);
  status = 405;
  await assert.rejects(client.listEvents(settings, { force: true }), /does not accept CalDAV REPORT/);
});

test('does not repopulate cache after clearCache during an obsolete request', async () => {
  let resolveRequest;
  let offline = false;
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: () => {
    if (offline) throw new Error('offline');
    return new Promise((resolve) => { resolveRequest = resolve; });
  } });
  const settings = { collectionUrl: 'https://baikal.test/calendar/', username: 'user', password: 'old-secret' };
  const pending = client.listEvents(settings);
  client.clearCache();
  resolveRequest(xmlResponse([]));
  await pending;
  offline = true;
  await assert.rejects(client.listEvents(settings), /currently unavailable/);
});

test('classifies timeout, status, content type, and response-size failures safely', async () => {
  const settings = { collectionUrl: 'https://baikal.test/calendar/', username: 'user', password: 'secret' };
  const cases = [
    [async () => new Response('', { status: 401 }), /username or password/],
    [async () => new Response('', { status: 400 }), /exact CalDAV calendar collection/],
    [async () => new Response('', { status: 405 }), /reverse-proxy method rules/],
    [async () => new Response('', { status: 503 }), /currently unavailable/],
    [async () => new Response('not xml', { status: 207, headers: { 'content-type': 'text/plain' } }), /response type/],
    [async () => new Response('', { status: 207, headers: { 'content-type': 'application/xml', 'content-length': String(2 * 1024 * 1024 + 1) } }), /too large/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }); }, /not trusted/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }); }, /hostname/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'CERT_HAS_EXPIRED' }); }, /expired/]
  ];
  for (const [fetchImpl, expected] of cases) {
    await assert.rejects(createCalDavClient({ fetchImpl, now: () => rangeStart }).test(settings), (error) => isCalDavClientError(error) && expected.test(error.message));
  }
  const timeout = createCalDavClient({ timeoutMs: 2, now: () => rangeStart, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await assert.rejects(timeout.test(settings), /timed out/);
});

test('preserves REPORT method, body, and authorization across same-origin redirects', async (context) => {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ url: request.url, method: request.method, authorization: request.headers.authorization, depth: request.headers.depth, body: Buffer.concat(chunks).toString('utf8') });
      if (request.url === '/calendar/') {
        response.writeHead(302, { location: '/redirected/' });
        response.end();
        return;
      }
      response.writeHead(207, { 'content-type': 'application/xml' });
      response.end('<d:multistatus xmlns:d="DAV:"/>');
    });
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const settings = { collectionUrl: `http://127.0.0.1:${server.address().port}/calendar/`, username: 'user', password: 'secret' };
  assert.deepEqual(await createCalDavClient({ now: () => rangeStart }).test(settings), { events: [], stale: false });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].method, 'REPORT');
  assert.equal(seen[1].method, 'REPORT');
  assert.equal(seen[0].authorization, seen[1].authorization);
  assert.equal(seen[0].depth, '1');
  assert.equal(seen[0].body, seen[1].body);
});

test('rejects credential-bearing cross-origin redirects', async (context) => {
  const target = http.createServer((_request, response) => response.end('must not be reached'));
  await new Promise((resolve, reject) => target.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const source = http.createServer((_request, response) => {
    response.writeHead(307, { location: `http://127.0.0.1:${target.address().port}/stolen` });
    response.end();
  });
  await new Promise((resolve, reject) => source.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  context.after(() => Promise.all([new Promise((resolve) => source.close(resolve)), new Promise((resolve) => target.close(resolve))]));
  const settings = { collectionUrl: `http://127.0.0.1:${source.address().port}/calendar/`, username: 'user', password: 'secret' };
  await assert.rejects(createCalDavClient({ now: () => rangeStart }).test(settings), /cross-origin/);
});

test('uses a scoped private CA while preserving hostname verification', async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dashboard-caldav-tls-'));
  const certificatePath = path.join(directory, 'certificate.pem');
  const keyPath = path.join(directory, 'key.pem');
  try {
    try {
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certificatePath, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
    } catch (error) {
      context.skip(`OpenSSL is required for the private-CA test: ${error.message}`);
      return;
    }
    const server = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (_request, response) => {
      response.writeHead(207, { 'content-type': 'application/xml' });
      response.end('<d:multistatus xmlns:d="DAV:"/>');
    });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const settings = { collectionUrl: `https://127.0.0.1:${server.address().port}/calendar/`, username: 'user', password: 'secret' };
    await assert.rejects(createCalDavClient({ now: () => rangeStart }).test(settings), /not trusted/);
    const trusted = createCalDavClient({ now: () => rangeStart, ca: readFileSync(certificatePath) });
    assert.deepEqual(await trusted.test(settings), { events: [], stale: false });
    await assert.rejects(trusted.test({ ...settings, collectionUrl: `https://localhost:${server.address().port}/calendar/` }), /hostname/);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
