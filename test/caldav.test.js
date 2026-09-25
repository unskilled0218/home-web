import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDigestAuthorization,
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

function davResponse(properties, href = '') {
  const resource = href ? `<d:href>${href}</d:href>` : '';
  return `<d:response>${resource}<d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function davXml(responses) {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses.join('')}</d:multistatus>`;
}

function davXmlResponse(responses, init = {}) {
  return new Response(davXml(responses), { status: 207, headers: { 'content-type': 'application/xml', ...init.headers }, ...init });
}

function discoveryFetch({ report = () => xmlResponse([]), calendars = ['/dav.php/calendars/user/default/'], onRequest = () => {} } = {}) {
  return async (url, options) => {
    onRequest(url, options);
    if (options.method === 'REPORT') return report(url, options);
    if (options.body.includes('current-user-principal')) return davXmlResponse([davResponse('<d:current-user-principal><d:href>/dav.php/principals/user/</d:href></d:current-user-principal>')]);
    if (options.body.includes('calendar-home-set')) return davXmlResponse([davResponse('<c:calendar-home-set><d:href>/dav.php/calendars/user/</d:href></c:calendar-home-set>')]);
    return davXmlResponse(calendars.map((href) => davResponse('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>', href)));
  };
}

test('normalizes CalDAV server credentials', () => {
  assert.deepEqual(normalizeCalDavCredentials({ serverUrl: ' https://baikal.example.test ', username: ' user ', password: ' secret value ' }), {
    serverUrl: 'https://baikal.example.test/',
    username: 'user',
    password: ' secret value '
  });
  assert.deepEqual(normalizeCalDavCredentials(
    { serverUrl: 'https://baikal.example.test', username: 'user', password: '' },
    { serverUrl: 'https://baikal.example.test/', username: 'user' }
  ), { serverUrl: 'https://baikal.example.test/', username: 'user', password: null });
  for (const serverUrl of ['file:///tmp/calendar', 'https://user@baikal.test/', 'https://baikal.test/?q=1', 'https://baikal.test/#fragment']) {
    assert.throws(() => normalizeCalDavCredentials({ serverUrl, username: 'user', password: 'secret' }), /server URL/);
  }
  for (const serverUrl of ['https://webdav.lan/dav.php/', 'https://webdav.lan/dav.php/calendars/user/default/']) assert.throws(() => normalizeCalDavCredentials({ serverUrl, username: 'user', password: 'secret' }), /without \/dav.php/);
  assert.throws(() => normalizeCalDavCredentials({ serverUrl: 'https://baikal.test/', username: 'bad:user', password: 'secret' }), /colon/);
  assert.throws(() => normalizeCalDavCredentials({ serverUrl: 'https://baikal.test/', username: 'user', password: '' }), /password/);
});

test('builds RFC HTTP Digest authorization for Baikal challenges', () => {
  const challenge = 'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
  const authorization = buildDigestAuthorization(challenge, { username: 'Mufasa', password: 'Circle Of Life' }, 'GET', 'http://www.example.com/dir/index.html', { cnonce: '0a4f113b', nonceCount: 1 });
  assert.match(authorization, /^Digest /);
  assert.match(authorization, /uri="\/dir\/index.html"/);
  assert.match(authorization, /response="6629fae49393a05397450978507c4ef1"/);
  assert.match(authorization, /qop=auth, nc=00000001, cnonce="0a4f113b"/);
  assert.throws(() => buildDigestAuthorization('Digest realm="BaikalDAV", nonce="n", algorithm=SHA-512', { username: 'user', password: 'secret' }, 'REPORT', 'https://baikal.test/calendar/'), /unsupported HTTP Digest/);
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
  const fallback = buildCalDavReport(rangeStart, rangeEnd, { expand: false });
  assert.match(fallback, /<c:calendar-data\/>/);
  assert.doesNotMatch(fallback, /<c:expand/);
  assert.equal(fallback.match(/20260307T120000Z/g).length, 1);
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
  assert.throws(() => extractCalendarData('<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/missing/</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response></d:multistatus>'), /report failed/);
});

test('rejects malformed, entity-bearing, deeply nested, and oversized XML', () => {
  for (const xml of [
    '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x/>',
    '<x><y></x>',
    '<x>&private;</x>',
    '<x></x>trailing',
    `<d:multistatus xmlns:d="DAV:"><d:response ${Array.from({ length: 65 }, (_, index) => `a${index}="x"`).join(' ')}/></d:multistatus>`,
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

test('discovers calendars, sends authenticated reports, and parses a safe merged result', async () => {
  const requests = [];
  const data = calendar([event(['UID:private-id', 'DTSTART:20260308T120000Z', 'SUMMARY:Meeting', 'LOCATION:Office'])]);
  const fetchImpl = discoveryFetch({
    calendars: ['/dav.php/calendars/user/work/', '/dav.php/calendars/user/home/'],
    report: (url) => xmlResponse(url.includes('/work/') ? [data] : []),
    onRequest: (url, options) => requests.push({ url, options })
  });
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl });
  const settings = { serverUrl: 'https://baikal.example.test/', username: 'üser', password: 'päss' };
  assert.deepEqual(await client.listEvents(settings), { events: [{ title: 'Meeting', start: '2026-03-08T12:00:00.000Z', end: '2026-03-08T12:00:00.000Z', allDay: false, location: 'Office' }], stale: false });
  assert.deepEqual(requests.map(({ options }) => options.method), ['PROPFIND', 'PROPFIND', 'PROPFIND', 'REPORT', 'REPORT']);
  assert.equal(requests[0].url, 'https://baikal.example.test/.well-known/caldav');
  assert.equal(requests[0].options.headers.Depth, '0');
  assert.equal(requests[2].options.headers.Depth, '1');
  assert.equal(requests[3].options.headers.Depth, '1');
  assert.equal(requests[0].options.headers.Authorization, `Basic ${Buffer.from('üser:päss').toString('base64')}`);
  assert.match(requests[3].options.body, /20260307T120000Z/);
  assert.equal(JSON.stringify((await client.listEvents(settings)).events).includes('private-id'), false);
});

test('retries a Baikal expansion failure with an unexpanded calendar query', async () => {
  const reports = [];
  const data = calendar([event(['UID:fallback', 'DTSTART:20260308T120000Z', 'SUMMARY:Fallback event'])]);
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: discoveryFetch({ report: (_url, options) => {
    reports.push(options.body);
    return reports.length === 1 ? new Response('', { status: 500 }) : xmlResponse([data]);
  } }) });
  assert.deepEqual(await client.test({ serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' }), {
    events: [{ title: 'Fallback event', start: '2026-03-08T12:00:00.000Z', end: '2026-03-08T12:00:00.000Z', allDay: false }],
    stale: false
  });
  assert.equal(reports.length, 2);
  assert.match(reports[0], /<c:expand/);
  assert.match(reports[1], /<c:calendar-data\/>/);
  assert.doesNotMatch(reports[1], /<c:expand/);
});

test('retries a Baikal Digest discovery challenge with the actual request URI', async () => {
  const requests = [];
  const challenge = 'Digest realm="BaikalDAV",qop="auth",nonce="6ab558db803ce",opaque="d66d5f0524036afcb61420e358f990ce"';
  const discovered = discoveryFetch();
  let challenged = false;
  const client = createCalDavClient({ now: () => rangeStart, randomBytesImpl: () => Buffer.alloc(16, 1), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (!challenged) { challenged = true; return new Response('', { status: 401, headers: { 'www-authenticate': challenge } }); }
    return discovered(url, options);
  } });
  const settings = { serverUrl: 'https://webdav.lan/', username: 'user', password: 'private-password' };
  assert.deepEqual(await client.test(settings), { events: [], stale: false });
  assert.equal(requests.length, 5);
  assert.equal(requests[0].options.headers.Authorization, `Basic ${Buffer.from('user:private-password').toString('base64')}`);
  assert.match(requests[1].options.headers.Authorization, /^Digest /);
  assert.match(requests[1].options.headers.Authorization, /realm="BaikalDAV"/);
  assert.match(requests[1].options.headers.Authorization, /uri="\/\.well-known\/caldav"/);
  assert.match(requests[1].options.headers.Authorization, /qop=auth, nc=00000001/);
  assert.equal(requests[1].options.body, requests[0].options.body);
});

test('tracks Digest nonce counts per nonce across discovery and reports', async () => {
  const challenge = (nonce) => `Digest realm="BaikalDAV",qop="auth",nonce="${nonce}"`;
  const discovered = discoveryFetch();
  const requests = [];
  let staleRetried = false;
  const client = createCalDavClient({ now: () => rangeStart, randomBytesImpl: () => Buffer.alloc(16, 2), fetchImpl: async (url, options) => {
    requests.push({ url, options });
    if (options.headers.Authorization.startsWith('Basic ')) return new Response('', { status: 401, headers: { 'www-authenticate': challenge('shared') } });
    if (!staleRetried) { staleRetried = true; return new Response('', { status: 401, headers: { 'www-authenticate': challenge('replacement') } }); }
    return discovered(url, options);
  } });
  await client.test({ serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' });
  const digest = requests.filter(({ options }) => options.headers.Authorization.startsWith('Digest '));
  assert.match(digest[0].options.headers.Authorization, /nonce="shared".*nc=00000001/);
  assert.match(digest[1].options.headers.Authorization, /nonce="replacement".*nc=00000001/);
  assert.match(digest.at(-1).options.headers.Authorization, /nc=00000004/);
  assert.equal(digest.at(-1).options.method, 'REPORT');
  assert.match(digest.at(-1).options.headers.Authorization, /uri="\/dav\.php\/calendars\/user\/default\/"/);
});

test('filters non-event collections, deduplicates hrefs, and bounds discovery', async () => {
  const reports = [];
  const listing = davXmlResponse([
    davResponse('<d:resourcetype><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>', '/tasks/'),
    davResponse('<d:resourcetype><c:calendar/></d:resourcetype>', '/events/'),
    davResponse('<d:resourcetype><c:calendar/></d:resourcetype>', '/events/'),
    davResponse('<d:resourcetype><d:collection/></d:resourcetype>', '/addressbooks/')
  ]);
  const base = discoveryFetch({ report: (url) => { reports.push(url); return xmlResponse([]); } });
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: async (url, options) => options.method === 'PROPFIND' && options.body.includes('supported-calendar-component-set') ? listing : base(url, options) });
  await client.test({ serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' });
  assert.deepEqual(reports, ['https://baikal.test/events/']);
  const tooMany = discoveryFetch({ calendars: Array.from({ length: 21 }, (_, index) => `/calendar-${index}/`) });
  await assert.rejects(createCalDavClient({ now: () => rangeStart, fetchImpl: tooMany }).test({ serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' }), /more than 20/);
});

test('rejects missing calendars and unsafe discovered hrefs', async () => {
  const settings = { serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' };
  await assert.rejects(createCalDavClient({ now: () => rangeStart, fetchImpl: discoveryFetch({ calendars: [] }) }).test(settings), /no event calendars/);
  for (const href of ['https://other.test/calendar/', 'https://user@baikal.test/calendar/', '/calendar/?private=1', '/calendar/#private']) {
    await assert.rejects(createCalDavClient({ now: () => rangeStart, fetchImpl: discoveryFetch({ calendars: [href] }) }).test(settings), /unsafe cross-origin URL/);
  }
  const missingPrincipal = async () => davXmlResponse([davResponse('<d:displayname>User</d:displayname>')]);
  await assert.rejects(createCalDavClient({ now: () => rangeStart, fetchImpl: missingPrincipal }).test(settings), /required account location/);
});

test('limits report concurrency to four requests', async () => {
  let active = 0;
  let maximum = 0;
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: discoveryFetch({
    calendars: Array.from({ length: 9 }, (_, index) => `/calendar-${index}/`),
    report: async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return xmlResponse([]);
    }
  }) });
  await client.test({ serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' });
  assert.equal(maximum, 4);
});

test('caches, deduplicates, forces refresh, falls back stale, and clears generations', async () => {
  let calls = 0;
  let resolveRequest;
  let reportStarted;
  let fail = false;
  const started = new Promise((resolve) => { reportStarted = resolve; });
  const client = createCalDavClient({ now: () => rangeStart, cacheSeconds: 60, fetchImpl: discoveryFetch({ report: async () => {
    calls += 1;
    if (fail) throw new Error('private upstream detail');
    if (calls === 1) return new Promise((resolve) => { resolveRequest = resolve; reportStarted(); });
    return xmlResponse([]);
  } }) });
  const settings = { serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' };
  const first = client.listEvents(settings);
  const concurrent = client.listEvents(settings);
  await started;
  assert.equal(calls, 1);
  resolveRequest(xmlResponse([]));
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
  const available = discoveryFetch({ report: () => xmlResponse([data]) });
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: async (url, options) => status === 207 ? available(url, options) : new Response('', { status }) });
  const settings = { serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' };
  await client.listEvents(settings);
  status = 401;
  await assert.rejects(client.listEvents(settings, { force: true }), /username or password/);
  await assert.rejects(client.listEvents(settings), /username or password/);
  status = 405;
  await assert.rejects(client.listEvents(settings, { force: true }), /required CalDAV discovery/);
});

test('does not repopulate cache after clearCache during an obsolete request', async () => {
  let resolveRequest;
  let offline = false;
  const client = createCalDavClient({ now: () => rangeStart, fetchImpl: discoveryFetch({ report: () => {
    if (offline) throw new Error('offline');
    return new Promise((resolve) => { resolveRequest = resolve; });
  } }) });
  const settings = { serverUrl: 'https://baikal.test/', username: 'user', password: 'old-secret' };
  const pending = client.listEvents(settings);
  while (!resolveRequest) await new Promise((resolve) => setImmediate(resolve));
  client.clearCache();
  resolveRequest(xmlResponse([]));
  await pending;
  offline = true;
  await assert.rejects(client.listEvents(settings), /calendar query failed/);
});

test('classifies timeout, status, content type, and response-size failures safely', async () => {
  const settings = { serverUrl: 'https://baikal.test/', username: 'user', password: 'secret' };
  const cases = [
    [async () => new Response('', { status: 401 }), /username or password/],
    [async () => new Response('', { status: 403 }), /account permissions/],
    [async () => new Response('', { status: 400 }), /CalDAV discovery request/],
    [async () => new Response('', { status: 405 }), /reverse-proxy method rules/],
    [async () => new Response('', { status: 503 }), /HTTP 503 during CalDAV discovery/],
    [async () => new Response('not xml', { status: 207, headers: { 'content-type': 'text/plain' } }), /response type/],
    [async () => new Response('', { status: 207, headers: { 'content-type': 'application/xml', 'content-length': String(2 * 1024 * 1024 + 1) } }), /too large/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }); }, /not trusted/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'ERR_TLS_CERT_ALTNAME_INVALID' }); }, /hostname/],
    [async () => { throw Object.assign(new Error('private TLS detail'), { code: 'CERT_HAS_EXPIRED' }); }, /expired/],
    [async () => { throw Object.assign(new Error('private DNS detail'), { code: 'ENOTFOUND' }); }, /hostname could not be resolved/],
    [async () => { throw Object.assign(new Error('private connection detail'), { code: 'ECONNRESET' }); }, /closed during discovery/]
  ];
  for (const [fetchImpl, expected] of cases) {
    await assert.rejects(createCalDavClient({ fetchImpl, now: () => rangeStart }).test(settings), (error) => isCalDavClientError(error) && expected.test(error.message));
  }
  const timeout = createCalDavClient({ timeoutMs: 2, now: () => rangeStart, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  await assert.rejects(timeout.test(settings), /timed out/);
});

test('preserves PROPFIND method, body, and authorization across same-origin well-known redirects', async (context) => {
  const seen = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ url: request.url, method: request.method, authorization: request.headers.authorization, depth: request.headers.depth, body: Buffer.concat(chunks).toString('utf8') });
      if (request.url === '/.well-known/caldav') {
        response.writeHead(302, { location: '/dav.php/' });
        response.end();
        return;
      }
      response.writeHead(207, { 'content-type': 'application/xml' });
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.method === 'REPORT') response.end('<d:multistatus xmlns:d="DAV:"/>');
      else if (body.includes('current-user-principal')) response.end(davXml([davResponse('<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>')]));
      else if (body.includes('calendar-home-set')) response.end(davXml([davResponse('<c:calendar-home-set xmlns:c="urn:ietf:params:xml:ns:caldav"><d:href>/home/</d:href></c:calendar-home-set>')]));
      else response.end(davXml([davResponse('<d:resourcetype><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>', '/calendar/')]));
    });
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const settings = { serverUrl: `http://127.0.0.1:${server.address().port}/`, username: 'user', password: 'secret' };
  assert.deepEqual(await createCalDavClient({ now: () => rangeStart }).test(settings), { events: [], stale: false });
  assert.equal(seen.length, 5);
  assert.equal(seen[0].method, 'PROPFIND');
  assert.equal(seen[1].method, 'PROPFIND');
  assert.equal(seen[0].authorization, seen[1].authorization);
  assert.equal(seen[0].depth, '0');
  assert.equal(seen[0].body, seen[1].body);
});

test('hashes the redirected URI when Baikal challenges for Digest authentication', async (context) => {
  let redirectedAuthorization = '';
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (request.url === '/.well-known/caldav') {
        response.writeHead(302, { location: '/dav.php/' });
        response.end();
      } else if (request.url === '/dav.php/' && !request.headers.authorization?.startsWith('Digest ')) {
        response.writeHead(401, { 'www-authenticate': 'Digest realm="BaikalDAV", qop="auth", nonce="redirect-nonce"' });
        response.end();
      } else {
        if (request.url === '/dav.php/') redirectedAuthorization = request.headers.authorization;
        response.writeHead(207, { 'content-type': 'application/xml' });
        if (request.method === 'REPORT') response.end('<d:multistatus xmlns:d="DAV:"/>');
        else if (body.includes('current-user-principal')) response.end(davXml([davResponse('<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>')]));
        else if (body.includes('calendar-home-set')) response.end(davXml([davResponse('<c:calendar-home-set xmlns:c="urn:ietf:params:xml:ns:caldav"><d:href>/home/</d:href></c:calendar-home-set>')]));
        else response.end(davXml([davResponse('<d:resourcetype><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>', '/calendar/')]));
      }
    });
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const settings = { serverUrl: `http://127.0.0.1:${server.address().port}/`, username: 'user', password: 'secret' };
  await createCalDavClient({ now: () => rangeStart, randomBytesImpl: () => Buffer.alloc(16, 1) }).test(settings);
  assert.match(redirectedAuthorization, /^Digest /);
  assert.match(redirectedAuthorization, /uri="\/dav\.php\/"/);
  assert.doesNotMatch(redirectedAuthorization, /uri="\/\.well-known\/caldav"/);
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
  const settings = { serverUrl: `http://127.0.0.1:${source.address().port}/`, username: 'user', password: 'secret' };
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
    const server = https.createServer({ cert: readFileSync(certificatePath), key: readFileSync(keyPath) }, (request, response) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (request.url === '/.well-known/caldav') {
          response.writeHead(302, { location: 'http://127.0.0.1/dav.php/' });
          response.end();
          return;
        }
        response.writeHead(207, { 'content-type': 'application/xml' });
        if (request.method === 'REPORT') response.end('<d:multistatus xmlns:d="DAV:"/>');
        else if (body.includes('current-user-principal')) response.end(davXml([davResponse('<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>')]));
        else if (body.includes('calendar-home-set')) response.end(davXml([davResponse('<c:calendar-home-set xmlns:c="urn:ietf:params:xml:ns:caldav"><d:href>/home/</d:href></c:calendar-home-set>')]));
        else response.end(davXml([davResponse('<d:resourcetype><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype>', '/calendar/')]));
      });
    });
    await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    context.after(() => new Promise((resolve) => server.close(resolve)));
    const settings = { serverUrl: `https://127.0.0.1:${server.address().port}/`, username: 'user', password: 'secret' };
    await assert.rejects(createCalDavClient({ now: () => rangeStart }).test(settings), /not trusted/);
    const trusted = createCalDavClient({ now: () => rangeStart, ca: readFileSync(certificatePath) });
    assert.deepEqual(await trusted.test(settings), { events: [], stale: false });
    await assert.rejects(trusted.test({ ...settings, serverUrl: `https://localhost:${server.address().port}/` }), /hostname/);
    assert.notEqual(process.env.NODE_TLS_REJECT_UNAUTHORIZED, '0');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
