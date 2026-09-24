import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { Readable } from 'node:stream';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_XML_DEPTH = 64;
const MAX_XML_ELEMENTS = 20_000;
const MAX_CALENDAR_OBJECTS = 1_000;
const MAX_ICAL_LINE = 64 * 1024;
const MAX_ICAL_PROPERTIES = 5_000;
const MAX_COMPONENT_DEPTH = 16;
const MAX_EVENT_CANDIDATES = 500;
const RANGE_DAYS = 14;
const EVENT_LIMIT = 10;
const CALDAV_NAMESPACE = 'urn:ietf:params:xml:ns:caldav';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TRUST_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED'
]);

class CalDavClientError extends Error {
  constructor(message, { transient = false, kind = 'protocol' } = {}) {
    super(message);
    this.transient = transient;
    this.kind = kind;
  }
}

const clientError = (message, options) => new CalDavClientError(message, options);

export function isCalDavClientError(error) {
  return error instanceof CalDavClientError;
}

export function normalizeCalDavCredentials(input, existing = null) {
  let url;
  try {
    url = new URL(typeof input?.collectionUrl === 'string' ? input.collectionUrl.trim() : '');
  } catch {
    throw new Error('CalDAV collection URL must be an absolute http or https URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('CalDAV collection URL must be an absolute http or https URL without credentials, a query, or a fragment.');
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  if (!username || username.length > 120 || username.includes(':')) {
    throw new Error('CalDAV username is required, must be at most 120 characters, and cannot contain a colon.');
  }
  const password = typeof input?.password === 'string' ? input.password : '';
  const sameIdentity = existing && existing.collectionUrl === url.href && existing.username === username;
  if (!password && !sameIdentity) throw new Error('A CalDAV password is required to connect.');
  if (password.length > 2_000) throw new Error('CalDAV password is too long.');
  return { collectionUrl: url.href, username, password: password || null };
}

function utcBasic(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildCalDavReport(rangeStart, rangeEnd) {
  const start = utcBasic(rangeStart);
  const end = utcBasic(rangeEnd);
  const properties = ['DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION', 'STATUS', 'UID', 'RECURRENCE-ID'].map((name) => `          <c:prop name="${name}"/>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NAMESPACE}">\n  <d:prop>\n    <c:calendar-data>\n      <c:comp name="VCALENDAR">\n        <c:comp name="VEVENT">\n${properties}\n        </c:comp>\n      </c:comp>\n      <c:expand start="${start}" end="${end}"/>\n    </c:calendar-data>\n  </d:prop>\n  <c:filter>\n    <c:comp-filter name="VCALENDAR">\n      <c:comp-filter name="VEVENT">\n        <c:time-range start="${start}" end="${end}"/>\n      </c:comp-filter>\n    </c:comp-filter>\n  </c:filter>\n</c:calendar-query>`;
}

function requestCalDav(url, options, redirects = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const body = Buffer.from(options.body, 'utf8');
  const requestOptions = {
    method: 'REPORT',
    headers: { ...options.headers, 'Content-Length': body.length },
    signal: options.signal,
    ...(parsed.protocol === 'https:' && options.ca && { ca: options.ca })
  };
  return new Promise((resolve, reject) => {
    const request = transport.request(parsed, requestOptions, (response) => {
      try {
        const status = response.statusCode;
        if (!Number.isInteger(status) || status < 200 || status > 599) {
          response.resume();
          reject(clientError('CalDAV returned an invalid HTTP response.'));
          return;
        }
        if (REDIRECT_STATUSES.has(status) && response.headers.location) {
          let target;
          try { target = new URL(response.headers.location, parsed); }
          catch {
            response.resume();
            reject(clientError('CalDAV returned an invalid redirect.'));
            return;
          }
          response.resume();
          if (target.origin !== parsed.origin || target.username || target.password) {
            reject(clientError('CalDAV refused an unsafe cross-origin redirect.'));
            return;
          }
          if (redirects >= 5) {
            reject(clientError('CalDAV returned too many redirects.'));
            return;
          }
          resolve(requestCalDav(target, options, redirects + 1));
          return;
        }
        const responseBody = [204, 205, 304].includes(status) ? null : Readable.toWeb(response);
        if (!responseBody) response.resume();
        resolve(new Response(responseBody, { status, statusText: response.statusMessage, headers: response.headers }));
      } catch (error) {
        response.resume();
        reject(error);
      }
    });
    request.on('error', reject);
    request.on('upgrade', (_response, socket) => {
      socket.destroy();
      reject(clientError('CalDAV returned an unsupported protocol upgrade.'));
    });
    request.end(body);
  });
}

function decodeXmlEntities(value) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(value)) throw clientError('CalDAV returned malformed XML.');
  return value.replace(/&([^;]+);/g, (_match, entity) => {
    if (entity === 'amp') return '&';
    if (entity === 'lt') return '<';
    if (entity === 'gt') return '>';
    if (entity === 'quot') return '"';
    if (entity === 'apos') return "'";
    const numeric = entity.match(/^#(\d+)$|^#x([0-9a-f]+)$/i);
    if (!numeric) throw clientError('CalDAV returned malformed XML.');
    const codePoint = Number.parseInt(numeric[1] ?? numeric[2], numeric[1] ? 10 : 16);
    if (!Number.isInteger(codePoint) || codePoint === 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw clientError('CalDAV returned malformed XML.');
    }
    return String.fromCodePoint(codePoint);
  });
}

function parseXmlTag(source) {
  let position = 0;
  const skipSpace = () => { while (/\s/.test(source[position] ?? '')) position += 1; };
  const readName = () => {
    const match = source.slice(position).match(/^[A-Za-z_][A-Za-z0-9_.:-]*/);
    if (!match) throw clientError('CalDAV returned malformed XML.');
    position += match[0].length;
    return match[0];
  };
  skipSpace();
  const name = readName();
  const attributes = [];
  while (position < source.length) {
    skipSpace();
    if (position === source.length) break;
    const attributeName = readName();
    skipSpace();
    if (source[position] !== '=') throw clientError('CalDAV returned malformed XML.');
    position += 1;
    skipSpace();
    const quote = source[position];
    if (quote !== '"' && quote !== "'") throw clientError('CalDAV returned malformed XML.');
    const end = source.indexOf(quote, position + 1);
    if (end < 0) throw clientError('CalDAV returned malformed XML.');
    const rawValue = source.slice(position + 1, end);
    if (rawValue.includes('<')) throw clientError('CalDAV returned malformed XML.');
    attributes.push([attributeName, decodeXmlEntities(rawValue)]);
    position = end + 1;
  }
  return { name, attributes };
}

function tagEnd(xml, start) {
  let quote = null;
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return index;
  }
  return -1;
}

export function extractCalendarData(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
  const stack = [];
  const calendars = [];
  const statuses = [];
  let position = 0;
  let elements = 0;
  let roots = 0;
  let capture = null;
  let sawDeclaration = false;
  let validRoot = false;
  const append = (text, encoded = true) => {
    if (text.includes(']]>')) throw clientError('CalDAV returned malformed XML.');
    if (!capture) {
      if (!stack.length && text.trim()) throw clientError('CalDAV returned malformed XML.');
      if (stack.length && encoded) decodeXmlEntities(text);
      return;
    }
    capture.text += encoded ? decodeXmlEntities(text) : text;
    if (Buffer.byteLength(capture.text) > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
  };
  while (position < xml.length) {
    const open = xml.indexOf('<', position);
    if (open < 0) {
      append(xml.slice(position));
      position = xml.length;
      break;
    }
    append(xml.slice(position, open));
    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4);
      if (end < 0 || xml.slice(open + 4, end).includes('--')) throw clientError('CalDAV returned malformed XML.');
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', open)) {
      if (!stack.length) throw clientError('CalDAV returned malformed XML.');
      const end = xml.indexOf(']]>', open + 9);
      if (end < 0) throw clientError('CalDAV returned malformed XML.');
      if (capture) append(xml.slice(open + 9, end), false);
      position = end + 3;
      continue;
    }
    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2);
      const declaration = end >= 0 ? xml.slice(open + 2, end).trim() : '';
      if (end < 0 || sawDeclaration || roots || stack.length || !/^xml(?:\s|$)/i.test(declaration)) throw clientError('CalDAV returned unsafe XML.');
      sawDeclaration = true;
      position = end + 2;
      continue;
    }
    if (xml.startsWith('<!', open)) throw clientError('CalDAV returned unsafe XML.');
    const end = tagEnd(xml, open + 1);
    if (end < 0) throw clientError('CalDAV returned malformed XML.');
    let source = xml.slice(open + 1, end).trim();
    if (source.startsWith('/')) {
      const name = source.slice(1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_.:-]*$/.test(name) || !stack.length || stack.at(-1).name !== name) throw clientError('CalDAV returned malformed XML.');
      const frame = stack.pop();
      if (capture?.frame === frame) {
        if (capture.type === 'calendar') {
          calendars.push({ text: capture.text, context: capture.context });
          if (calendars.length > MAX_CALENDAR_OBJECTS) throw clientError('CalDAV returned too many calendar objects.');
        } else {
          const match = capture.text.trim().match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/i);
          if (!match) throw clientError('CalDAV returned malformed XML.');
          capture.context.status = Number(match[1]);
          statuses.push(capture.context.status);
        }
        capture = null;
      }
    } else {
      const selfClosing = source.endsWith('/');
      if (selfClosing) source = source.slice(0, -1).trim();
      const { name, attributes } = parseXmlTag(source);
      elements += 1;
      if (elements > MAX_XML_ELEMENTS || stack.length + 1 > MAX_XML_DEPTH) throw clientError('CalDAV XML exceeds parser limits.');
      if (!stack.length) roots += 1;
      if (roots > 1) throw clientError('CalDAV returned malformed XML.');
      const namespaces = new Map(stack.at(-1)?.namespaces ?? [['xml', 'http://www.w3.org/XML/1998/namespace']]);
      const seenAttributes = new Set();
      for (const [attributeName, value] of attributes) {
        if (seenAttributes.has(attributeName)) throw clientError('CalDAV returned malformed XML.');
        seenAttributes.add(attributeName);
        if (attributeName === 'xmlns') namespaces.set('', value);
        else if (attributeName.startsWith('xmlns:')) namespaces.set(attributeName.slice(6), value);
      }
      const separator = name.indexOf(':');
      const prefix = separator < 0 ? '' : name.slice(0, separator);
      const localName = separator < 0 ? name : name.slice(separator + 1);
      if (separator >= 0 && !namespaces.has(prefix)) throw clientError('CalDAV returned malformed XML.');
      if (elements === 1) validRoot = localName === 'multistatus' && namespaces.get(prefix) === 'DAV:';
      const namespace = namespaces.get(prefix);
      const frame = { name, namespaces, namespace, localName, status: null };
      const context = [...stack].reverse().find((candidate) => candidate.namespace === 'DAV:' && ['propstat', 'response'].includes(candidate.localName));
      const isCalendarData = localName === 'calendar-data' && namespace === CALDAV_NAMESPACE;
      const isStatus = localName === 'status' && namespace === 'DAV:';
      if (isCalendarData) {
        if (capture || !context) throw clientError('CalDAV returned malformed XML.');
        capture = { type: 'calendar', frame, context, text: '' };
      } else if (isStatus) {
        if (capture || !context) throw clientError('CalDAV returned malformed XML.');
        capture = { type: 'status', frame, context, text: '' };
      } else if (capture) {
        throw clientError('CalDAV returned malformed XML.');
      }
      if (selfClosing) {
        if (capture?.frame === frame) {
          if (capture.type === 'calendar') calendars.push({ text: '', context: capture.context });
          else throw clientError('CalDAV returned malformed XML.');
          capture = null;
        }
      } else stack.push(frame);
    }
    position = end + 1;
  }
  if (stack.length || capture || roots !== 1 || !validRoot) throw clientError('CalDAV returned malformed XML.');
  const successful = calendars.filter(({ context }) => context.status >= 200 && context.status < 300).map(({ text }) => text);
  if (!successful.length && (calendars.length || statuses.length)) throw clientError('CalDAV calendar report failed.');
  return successful;
}

function splitProperty(line) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) escaped = false;
    else if (character === '\\') escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (character === ':' && !quoted) return [line.slice(0, index), line.slice(index + 1)];
  }
  return null;
}

function parseProperty(line) {
  const split = splitProperty(line);
  if (!split) return null;
  const parts = split[0].split(';');
  const name = parts.shift().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return null;
  const parameters = new Map();
  for (const part of parts) {
    const equals = part.indexOf('=');
    if (equals < 1) return null;
    const key = part.slice(0, equals).toUpperCase();
    let value = part.slice(equals + 1);
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    if (!/^[A-Z0-9-]+$/.test(key) || !value || value.length > 255) return null;
    parameters.set(key, value);
  }
  return { name, parameters, value: split[1] };
}

function unfoldCalendar(calendar) {
  if (typeof calendar !== 'string' || Buffer.byteLength(calendar) > MAX_RESPONSE_BYTES || calendar.includes('\0')) throw clientError('CalDAV returned invalid calendar data.');
  if (/\r(?!\n)/.test(calendar)) throw clientError('CalDAV returned invalid calendar data.');
  const physical = calendar.split(/\r?\n/);
  const lines = [];
  for (const line of physical) {
    if (line.length > MAX_ICAL_LINE) throw clientError('CalDAV calendar data exceeds parser limits.');
    if (/^[ \t]/.test(line)) {
      if (!lines.length) throw clientError('CalDAV returned invalid calendar data.');
      lines[lines.length - 1] += line.slice(1);
      if (lines.at(-1).length > MAX_ICAL_LINE) throw clientError('CalDAV calendar data exceeds parser limits.');
    } else lines.push(line);
    if (lines.length > MAX_ICAL_PROPERTIES) throw clientError('CalDAV calendar data exceeds parser limits.');
  }
  return lines;
}

function rawEvents(calendar) {
  const components = [];
  const events = [];
  let current = null;
  let sawCalendar = false;
  for (const line of unfoldCalendar(calendar)) {
    if (!line) continue;
    const property = parseProperty(line);
    if (!property) continue;
    if (property.name === 'BEGIN') {
      const component = property.value.toUpperCase();
      if (!/^[A-Z0-9-]+$/.test(component) || components.length >= MAX_COMPONENT_DEPTH) throw clientError('CalDAV returned invalid calendar data.');
      if (!components.length) {
        if (component !== 'VCALENDAR' || sawCalendar) throw clientError('CalDAV returned invalid calendar data.');
        sawCalendar = true;
      }
      components.push(component);
      if (component === 'VEVENT') {
        if (current) throw clientError('CalDAV returned invalid calendar data.');
        current = {};
      }
      continue;
    }
    if (property.name === 'END') {
      const component = property.value.toUpperCase();
      if (!components.length || components.pop() !== component) throw clientError('CalDAV returned invalid calendar data.');
      if (component === 'VEVENT') {
        events.push(current);
        current = null;
      }
      continue;
    }
    if (!current || components.at(-1) !== 'VEVENT') continue;
    if (!['DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION', 'STATUS', 'UID', 'RECURRENCE-ID'].includes(property.name)) continue;
    if (!Object.hasOwn(current, property.name)) current[property.name] = property;
  }
  if (components.length || current || !sawCalendar) throw clientError('CalDAV returned invalid calendar data.');
  return events;
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute && date.getUTCSeconds() === second;
}

function utcFromParts(parts) {
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return date.getTime();
}

function wallParts(timestamp, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, calendar: 'gregory', numberingSystem: 'latn', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function wallTimeToUtc(parts, timeZone) {
  let guess = utcFromParts(parts);
  try {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const shown = wallParts(guess, timeZone);
      const adjustment = utcFromParts(parts) - utcFromParts({ year: shown.year, month: shown.month, day: shown.day, hour: shown.hour, minute: shown.minute, second: shown.second });
      if (!adjustment) break;
      guess += adjustment;
    }
    const matches = [];
    for (let offset = -180; offset <= 180; offset += 1) {
      const candidate = guess + offset * 60_000;
      const shown = wallParts(candidate, timeZone);
      if (shown.year === parts.year && shown.month === parts.month && shown.day === parts.day && shown.hour === parts.hour && shown.minute === parts.minute && shown.second === parts.second) matches.push(candidate);
    }
    return matches.length ? Math.min(...matches) : null;
  } catch {
    return null;
  }
}

function parseDateProperty(property) {
  if (!property) return null;
  const dateMatch = property.value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateMatch) {
    if (property.parameters.has('TZID') || (property.parameters.get('VALUE') && property.parameters.get('VALUE').toUpperCase() !== 'DATE')) return null;
    const [year, month, day] = dateMatch.slice(1).map(Number);
    if (!validDateParts(year, month, day)) return null;
    const timestamp = utcFromParts({ year, month, day, hour: 0, minute: 0, second: 0 });
    return { timestamp, allDay: true, publicValue: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`, identity: property.value };
  }
  if (property.parameters.get('VALUE')?.toUpperCase() === 'DATE') return null;
  const match = property.value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (!validDateParts(year, month, day, hour, minute, second)) return null;
  const parts = { year, month, day, hour, minute, second };
  let timestamp;
  if (match[7] && property.parameters.has('TZID')) return null;
  if (match[7] === 'Z') timestamp = utcFromParts(parts);
  else if (match[7]) {
    const offsetHours = Number(match[7].slice(1, 3));
    const offsetMinutes = Number(match[7].slice(3, 5));
    if (offsetHours > 23 || offsetMinutes > 59) return null;
    const offset = (offsetHours * 60 + offsetMinutes) * 60_000 * (match[7][0] === '+' ? 1 : -1);
    timestamp = utcFromParts(parts) - offset;
  } else {
    const timeZone = property.parameters.get('TZID');
    if (!timeZone) return null;
    timestamp = wallTimeToUtc(parts, timeZone);
  }
  if (!Number.isFinite(timestamp)) return null;
  return { timestamp, allDay: false, publicValue: new Date(timestamp).toISOString(), identity: String(timestamp) };
}

function decodeCalendarText(value) {
  return value.replace(/\\([nN,;\\])/g, (_match, escaped) => escaped === 'n' || escaped === 'N' ? '\n' : escaped);
}

function safeCalendarText(property, limit) {
  if (!property) return undefined;
  const value = decodeCalendarText(property.value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return value ? value.slice(0, limit) : undefined;
}

function parseDuration(property, allDay) {
  if (!property || property.parameters.size) return null;
  const match = property.value.match(/^\+?P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?)$/);
  if (!match) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((value) => Number(value ?? 0));
  if (allDay && (hours || minutes || seconds)) return null;
  const milliseconds = (((weeks * 7 + days) * 24 + hours) * 60 * 60 + minutes * 60 + seconds) * 1_000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) return null;
  return milliseconds;
}

function addDays(dateValue, count) {
  return new Date(Date.parse(`${dateValue}T00:00:00.000Z`) + count * 86_400_000).toISOString().slice(0, 10);
}

export function parseCalendarEvents(calendarData, { rangeStart, rangeEnd, limit = EVENT_LIMIT } = {}) {
  const startRange = new Date(rangeStart).getTime();
  const endRange = new Date(rangeEnd).getTime();
  if (!Number.isFinite(startRange) || !Number.isFinite(endRange) || endRange <= startRange) throw new TypeError('A valid calendar range is required.');
  if (!Array.isArray(calendarData) || calendarData.length > MAX_CALENDAR_OBJECTS) throw clientError('CalDAV returned too many calendar objects.');
  if (calendarData.reduce((total, calendar) => total + (typeof calendar === 'string' ? Buffer.byteLength(calendar) : MAX_RESPONSE_BYTES + 1), 0) > MAX_RESPONSE_BYTES) throw clientError('CalDAV calendar data exceeds parser limits.');
  const records = [];
  for (const calendar of calendarData) {
    for (const event of rawEvents(calendar)) {
      records.push(event);
      if (records.length > MAX_EVENT_CANDIDATES) throw clientError('CalDAV returned too many events.');
    }
  }
  const normalized = new Map();
  const cancelledSeries = new Set();
  const cancelledOccurrences = new Set();
  for (const record of records) {
    const uid = safeCalendarText(record.UID, 512);
    const recurrence = parseDateProperty(record['RECURRENCE-ID']);
    const start = parseDateProperty(record.DTSTART);
    const occurrence = recurrence?.identity ?? start?.identity;
    const identity = uid && occurrence ? `${uid}\0${occurrence}` : null;
    const cancelled = record.STATUS?.value.trim().toUpperCase() === 'CANCELLED';
    if (cancelled) {
      if (uid && recurrence) { cancelledOccurrences.add(identity); normalized.delete(identity); }
      else if (uid) cancelledSeries.add(uid);
      continue;
    }
    if (!start || (uid && (cancelledSeries.has(uid) || cancelledOccurrences.has(identity)))) continue;
    if (record.DTEND && record.DURATION) continue;
    const end = record.DTEND ? parseDateProperty(record.DTEND) : null;
    if (record.DTEND && !end) continue;
    if (end && end.allDay !== start.allDay) continue;
    const duration = record.DURATION ? parseDuration(record.DURATION, start.allDay) : null;
    if (record.DURATION && !duration) continue;
    const defaultDuration = start.allDay ? 86_400_000 : 0;
    const endTimestamp = end?.timestamp ?? start.timestamp + (duration ?? defaultDuration);
    if (!Number.isFinite(endTimestamp) || Math.abs(endTimestamp) > 8.64e15) continue;
    const endValue = end?.publicValue ?? (start.allDay ? addDays(start.publicValue, (duration ?? defaultDuration) / 86_400_000) : new Date(endTimestamp).toISOString());
    if (endTimestamp < start.timestamp || (start.allDay && endTimestamp === start.timestamp)) continue;
    const overlaps = endTimestamp === start.timestamp
      ? start.timestamp >= startRange && start.timestamp < endRange
      : start.timestamp < endRange && endTimestamp > startRange;
    if (!overlaps) continue;
    const title = safeCalendarText(record.SUMMARY, 300) ?? 'Untitled event';
    const location = safeCalendarText(record.LOCATION, 300);
    const event = { title, start: start.publicValue, end: endValue, allDay: start.allDay, ...(location && { location }), _timestamp: start.timestamp };
    const key = identity ?? `${start.identity}\0${endValue}\0${title}\0${location ?? ''}`;
    normalized.set(key, event);
  }
  for (const uid of cancelledSeries) {
    for (const key of normalized.keys()) if (key.startsWith(`${uid}\0`)) normalized.delete(key);
  }
  const events = [...normalized.values()];
  events.sort((left, right) => left._timestamp - right._timestamp || Number(right.allDay) - Number(left.allDay) || left.title.localeCompare(right.title, undefined, { sensitivity: 'base' }));
  return events.slice(0, Math.max(0, Math.min(EVENT_LIMIT, limit))).map(({ _timestamp, ...event }) => event);
}

async function boundedText(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
    return text;
  }
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw clientError('CalDAV response is too large.');
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function statusError(status) {
  if (status === 401 || status === 403) return clientError('CalDAV rejected the username or password.', { kind: 'authentication' });
  if ([400, 405, 415, 422, 501].includes(status)) return clientError('The CalDAV server does not support the required calendar report and expansion.');
  if (status === 429 || status >= 500) return clientError('CalDAV is currently unavailable.', { transient: true });
  return clientError('CalDAV returned an unexpected HTTP response.');
}

function connectionError(error) {
  if (isCalDavClientError(error)) return error;
  const candidates = [error, error?.cause];
  if (candidates.some((candidate) => candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR')) return clientError('CalDAV connection timed out.', { transient: true });
  const code = candidates.map((candidate) => candidate?.code).find((value) => typeof value === 'string');
  if (TRUST_ERROR_CODES.has(code)) return clientError('CalDAV certificate is not trusted. Configure its private CA bundle and restart the dashboard.');
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return clientError('CalDAV certificate does not match the configured hostname.');
  if (code === 'CERT_HAS_EXPIRED' || code === 'CERT_NOT_YET_VALID') return clientError('CalDAV certificate is expired or not yet valid.');
  return clientError('CalDAV is currently unavailable.', { transient: true });
}

export function createCalDavClient({ fetchImpl = requestCalDav, timeoutMs = 8_000, cacheSeconds = 300, ca, now = Date.now } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let generation = 0;
  const keyFor = (settings) => createHash('sha256').update(`${settings.collectionUrl}\0${settings.username}\0${settings.password}`).digest('base64url');
  const refresh = async (settings, requestGeneration) => {
    const rangeStart = Number(now());
    const rangeEnd = rangeStart + RANGE_DAYS * 86_400_000;
    const body = buildCalDavReport(rangeStart, rangeEnd);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(settings.collectionUrl, {
        method: 'REPORT',
        headers: {
          Authorization: `Basic ${Buffer.from(`${settings.username}:${settings.password}`, 'utf8').toString('base64')}`,
          Depth: '1',
          Accept: 'application/xml, text/xml',
          'Content-Type': 'application/xml; charset=utf-8'
        },
        body,
        signal: controller.signal,
        ca
      });
      if (!response || response.status !== 207) throw statusError(response?.status);
      const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/xml' && contentType !== 'text/xml') throw clientError('CalDAV returned an invalid response type.');
      const xml = await boundedText(response);
      const events = parseCalendarEvents(extractCalendarData(xml), { rangeStart, rangeEnd });
      const key = keyFor(settings);
      if (requestGeneration === generation) cache.set(key, { events, fetchedAt: Number(now()) });
      return { events, stale: false };
    } catch (error) {
      throw connectionError(error);
    } finally {
      clearTimeout(timer);
    }
  };
  return {
    clearCache() {
      generation += 1;
      cache.clear();
      inFlight.clear();
    },
    async listEvents(settings, { force = false } = {}) {
      const key = keyFor(settings);
      const cached = cache.get(key);
      if (!force && cached && Number(now()) - cached.fetchedAt < cacheSeconds * 1_000) return { events: cached.events, stale: false };
      const existing = inFlight.get(key);
      if (existing) return existing;
      const requestGeneration = generation;
      const request = refresh(settings, requestGeneration).catch((error) => {
        if (cached && error?.transient === true) return { events: cached.events, stale: true };
        cache.delete(key);
        throw error;
      });
      inFlight.set(key, request);
      try {
        return await request;
      } finally {
        if (inFlight.get(key) === request) inFlight.delete(key);
      }
    },
    test(settings) {
      return refresh(settings, generation);
    }
  };
}
