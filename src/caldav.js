import { createHash, randomBytes } from 'node:crypto';
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
const MAX_CALENDARS = 20;
const REPORT_CONCURRENCY = 4;
const CALDAV_NAMESPACE = 'urn:ietf:params:xml:ns:caldav';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RESPONSE_URL = Symbol('calDavResponseUrl');
const TRUST_ERROR_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_UNTRUSTED'
]);

class CalDavClientError extends Error {
  constructor(message, { transient = false, kind = 'protocol', status = null } = {}) {
    super(message);
    this.transient = transient;
    this.kind = kind;
    this.status = status;
  }
}

const clientError = (message, options) => new CalDavClientError(message, options);

export function isCalDavClientError(error) {
  return error instanceof CalDavClientError;
}

export function normalizeCalDavCredentials(input, existing = null) {
  let url;
  try {
    url = new URL(typeof input?.serverUrl === 'string' ? input.serverUrl.trim() : '');
  } catch {
    throw new Error('CalDAV server URL must be an absolute http or https URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('CalDAV server URL must be an absolute http or https URL without credentials, a query, or a fragment.');
  }
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Enter only the CalDAV server URL without /dav.php/ or a calendar path.');
  url.pathname = '/';
  const username = typeof input?.username === 'string' ? input.username.trim() : '';
  if (!username || username.length > 120 || username.includes(':')) {
    throw new Error('CalDAV username is required, must be at most 120 characters, and cannot contain a colon.');
  }
  const password = typeof input?.password === 'string' ? input.password : '';
  const sameIdentity = existing && existing.serverUrl === url.href && existing.username === username;
  if (!password && !sameIdentity) throw new Error('A CalDAV password is required to connect.');
  if (password.length > 2_000) throw new Error('CalDAV password is too long.');
  return { serverUrl: url.href, username, password: password || null };
}

function utcBasic(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildCalDavReport(rangeStart, rangeEnd, { expand = true } = {}) {
  const start = utcBasic(rangeStart);
  const end = utcBasic(rangeEnd);
  const calendarData = expand ? `<c:calendar-data>\n      <c:expand start="${start}" end="${end}"/>\n    </c:calendar-data>` : '<c:calendar-data/>';
  return `<?xml version="1.0" encoding="utf-8"?>\n<c:calendar-query xmlns:d="DAV:" xmlns:c="${CALDAV_NAMESPACE}">\n  <d:prop>\n    ${calendarData}\n  </d:prop>\n  <c:filter>\n    <c:comp-filter name="VCALENDAR">\n      <c:comp-filter name="VEVENT">\n        <c:time-range start="${start}" end="${end}"/>\n      </c:comp-filter>\n    </c:comp-filter>\n  </c:filter>\n</c:calendar-query>`;
}

const PRINCIPAL_PROPFIND = '<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const HOME_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NAMESPACE}"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`;
const CALENDARS_PROPFIND = `<?xml version="1.0" encoding="utf-8"?>\n<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV_NAMESPACE}"><d:prop><d:resourcetype/><c:supported-calendar-component-set/></d:prop></d:propfind>`;

function parseDigestChallenge(header) {
  if (typeof header !== 'string') return null;
  const digest = header.match(/(?:^|,\s*)Digest\s+(.+)$/i);
  if (!digest || digest[1].length > 4_096) return null;
  const values = new Map();
  const pattern = /([A-Za-z][A-Za-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*"|[^,\s]+)/g;
  let match;
  while ((match = pattern.exec(digest[1]))) {
    const key = match[1].toLowerCase();
    if (values.has(key)) return null;
    let value = match[2];
    if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    values.set(key, value);
  }
  const realm = values.get('realm');
  const nonce = values.get('nonce');
  if (!realm || !nonce || realm.length > 1_000 || nonce.length > 1_000) return null;
  const algorithm = (values.get('algorithm') ?? 'MD5').toUpperCase();
  if (!['MD5', 'MD5-SESS', 'SHA-256', 'SHA-256-SESS'].includes(algorithm)) return null;
  const qopValues = (values.get('qop') ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (qopValues.length && !qopValues.includes('auth')) return null;
  return { realm, nonce, algorithm, qop: qopValues.length ? 'auth' : null, opaque: values.get('opaque') };
}

const quoteDigest = (value) => `"${String(value).replace(/["\\]/g, '\\$&')}"`;

export function buildDigestAuthorization(header, { username, password }, method, url, { cnonce = randomBytes(16).toString('hex'), nonceCount = 1 } = {}) {
  const challenge = parseDigestChallenge(header);
  if (!challenge) throw clientError('Baikal returned an unsupported HTTP Digest authentication challenge.');
  const hashAlgorithm = challenge.algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
  const hash = (value) => createHash(hashAlgorithm).update(value, 'utf8').digest('hex');
  const parsed = new URL(url);
  const uri = `${parsed.pathname}${parsed.search}`;
  const nc = nonceCount.toString(16).padStart(8, '0');
  const baseHa1 = hash(`${username}:${challenge.realm}:${password}`);
  const ha1 = challenge.algorithm.endsWith('-SESS') ? hash(`${baseHa1}:${challenge.nonce}:${cnonce}`) : baseHa1;
  const ha2 = hash(`${method}:${uri}`);
  const response = challenge.qop ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`) : hash(`${ha1}:${challenge.nonce}:${ha2}`);
  const fields = [`username=${quoteDigest(username)}`, `realm=${quoteDigest(challenge.realm)}`, `nonce=${quoteDigest(challenge.nonce)}`, `uri=${quoteDigest(uri)}`, `response=${quoteDigest(response)}`, `algorithm=${challenge.algorithm}`];
  if (challenge.qop) fields.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce=${quoteDigest(cnonce)}`);
  if (challenge.opaque) fields.push(`opaque=${quoteDigest(challenge.opaque)}`);
  return `Digest ${fields.join(', ')}`;
}

function requestCalDav(url, options, redirects = 0) {
  const parsed = new URL(url);
  const transport = parsed.protocol === 'https:' ? https : http;
  const body = Buffer.from(options.body ?? '', 'utf8');
  const requestOptions = {
    method: options.method,
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
          const configuredOrigin = new URL(options.origin);
          if (configuredOrigin.protocol === 'https:' && target.protocol === 'http:' && target.hostname === configuredOrigin.hostname && !target.port) {
            target.protocol = 'https:';
            target.host = configuredOrigin.host;
          }
          if (target.origin !== options.origin || target.username || target.password || target.search || target.hash) {
            reject(clientError('CalDAV refused an unsafe cross-origin redirect.'));
            return;
          }
          if (redirects >= 5) {
            reject(clientError('CalDAV returned too many redirects.'));
            return;
          }
          const headers = { ...options.headers };
          if (/^Digest\s/i.test(headers.Authorization ?? '')) delete headers.Authorization;
          resolve(requestCalDav(target, { ...options, headers }, redirects + 1));
          return;
        }
        const responseBody = [204, 205, 304].includes(status) ? null : Readable.toWeb(response);
        if (!responseBody) response.resume();
        const result = new Response(responseBody, { status, statusText: response.statusMessage, headers: response.headers });
        result[RESPONSE_URL] = parsed.href;
        resolve(result);
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

function parseMultiStatus(xml) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml) > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
  const stack = [];
  let position = 0;
  let elements = 0;
  let roots = 0;
  let root = null;
  let sawDeclaration = false;
  const append = (text, encoded = true) => {
    if (text.includes(']]>')) throw clientError('CalDAV returned malformed XML.');
    if (!stack.length) {
      if (text.trim()) throw clientError('CalDAV returned malformed XML.');
      return;
    }
    const node = stack.at(-1).node;
    node.text += encoded ? decodeXmlEntities(text) : text;
    if (Buffer.byteLength(node.text) > MAX_RESPONSE_BYTES) throw clientError('CalDAV response is too large.');
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
      append(xml.slice(open + 9, end), false);
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
      stack.pop();
    } else {
      const selfClosing = source.endsWith('/');
      if (selfClosing) source = source.slice(0, -1).trim();
      const { name, attributes } = parseXmlTag(source);
      if (attributes.length > 64) throw clientError('CalDAV XML exceeds parser limits.');
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
      const namespace = namespaces.get(prefix);
      const nodeAttributes = new Map(attributes.filter(([attributeName]) => attributeName.toLowerCase() === 'name'));
      const node = { namespace, localName, attributes: nodeAttributes, children: [], text: '' };
      const frame = { name, namespaces, node };
      if (stack.length) stack.at(-1).node.children.push(node);
      else root = node;
      if (!selfClosing) stack.push(frame);
    }
    position = end + 1;
  }
  if (stack.length || roots !== 1 || root?.localName !== 'multistatus' || root.namespace !== 'DAV:') throw clientError('CalDAV returned malformed XML.');
  return root;
}

const directChildren = (node, namespace, localName) => node.children.filter((child) => child.namespace === namespace && child.localName === localName);
const directChild = (node, namespace, localName) => directChildren(node, namespace, localName)[0];

function statusCode(node) {
  const status = directChild(node, 'DAV:', 'status');
  const match = status?.text.trim().match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/i);
  if (!match) throw clientError('CalDAV returned malformed XML.');
  return Number(match[1]);
}

function responseStatusCode(response) {
  return directChild(response, 'DAV:', 'status') ? statusCode(response) : null;
}

function responseProperties(response) {
  const responseStatus = responseStatusCode(response);
  if (responseStatus !== null && (responseStatus < 200 || responseStatus >= 300)) return [];
  const properties = [];
  for (const propstat of directChildren(response, 'DAV:', 'propstat')) {
    const code = statusCode(propstat);
    const prop = directChild(propstat, 'DAV:', 'prop');
    if (!prop) throw clientError('CalDAV returned malformed XML.');
    if (code >= 200 && code < 300) properties.push(...prop.children);
  }
  return properties;
}

function responsesFrom(xml) {
  return directChildren(parseMultiStatus(xml), 'DAV:', 'response');
}

export function extractCalendarData(xml) {
  const responses = responsesFrom(xml);
  const calendars = [];
  let sawPropstat = false;
  for (const response of responses) {
    const propstats = directChildren(response, 'DAV:', 'propstat');
    sawPropstat ||= propstats.length > 0;
    for (const property of responseProperties(response)) {
      if (property.namespace !== CALDAV_NAMESPACE || property.localName !== 'calendar-data') continue;
      if (property.children.length) throw clientError('CalDAV returned malformed XML.');
      calendars.push(property.text);
      if (calendars.length > MAX_CALENDAR_OBJECTS) throw clientError('CalDAV returned too many calendar objects.');
    }
  }
  const failed = responses.some((response) => {
    const responseStatus = responseStatusCode(response);
    return (responseStatus !== null && (responseStatus < 200 || responseStatus >= 300)) || directChildren(response, 'DAV:', 'propstat').some((propstat) => statusCode(propstat) >= 300);
  });
  if (!calendars.length && (failed || sawPropstat && responses.length)) throw clientError('CalDAV calendar report failed.');
  return calendars;
}

function discoveryHref(xml, namespace, localName) {
  for (const response of responsesFrom(xml)) {
    const property = responseProperties(response).find((candidate) => candidate.namespace === namespace && candidate.localName === localName);
    if (!property) continue;
    const href = directChild(property, 'DAV:', 'href');
    if (!href || href.children.length || !href.text.trim()) throw clientError('CalDAV discovery returned a malformed URL.');
    return href.text.trim();
  }
  throw clientError('CalDAV discovery did not return the required account location.');
}

function discoveryCalendars(xml) {
  const calendars = [];
  for (const response of responsesFrom(xml)) {
    const href = directChild(response, 'DAV:', 'href');
    if (!href || href.children.length || !href.text.trim()) continue;
    const properties = responseProperties(response);
    const resourceType = properties.find((property) => property.namespace === 'DAV:' && property.localName === 'resourcetype');
    if (!resourceType || !directChild(resourceType, CALDAV_NAMESPACE, 'calendar')) continue;
    const supported = properties.find((property) => property.namespace === CALDAV_NAMESPACE && property.localName === 'supported-calendar-component-set');
    if (supported) {
      const names = directChildren(supported, CALDAV_NAMESPACE, 'comp').map((component) => [...component.attributes].find(([name]) => name.toLowerCase() === 'name')?.[1]?.toUpperCase()).filter(Boolean);
      if (!names.includes('VEVENT')) continue;
    }
    calendars.push(href.text.trim());
  }
  return calendars;
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

function statusError(status, operation = 'request') {
  if (status === 401) return clientError('CalDAV rejected the username or password.', { kind: 'authentication', status });
  if (status === 403) return clientError('Baikal denied access to the calendar account (HTTP 403). Check the account permissions.', { kind: 'authorization', status });
  if (status === 405) return clientError(`The Baikal server does not accept the required CalDAV ${operation} request (HTTP 405). Check its WebDAV and reverse-proxy method rules.`, { status });
  if ([400, 415, 422, 501].includes(status)) return clientError(`Baikal rejected the CalDAV ${operation} request (HTTP ${status}).`, { status });
  if (status === 429) return clientError(`Baikal rate-limited the CalDAV ${operation} request (HTTP 429).`, { transient: true, status });
  if (status >= 500) return clientError(`Baikal returned HTTP ${status} during CalDAV ${operation}.`, { transient: true, status });
  return clientError('CalDAV returned an unexpected HTTP response.', { status });
}

function connectionError(error, operation = 'request') {
  if (isCalDavClientError(error)) return error;
  const candidates = [error, error?.cause];
  if (candidates.some((candidate) => candidate?.name === 'AbortError' || candidate?.code === 'ABORT_ERR')) return clientError('CalDAV connection timed out.', { transient: true });
  const code = candidates.map((candidate) => candidate?.code).find((value) => typeof value === 'string');
  if (TRUST_ERROR_CODES.has(code)) return clientError('CalDAV certificate is not trusted. Configure its private CA bundle and restart the dashboard.');
  if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return clientError('CalDAV certificate does not match the configured hostname.');
  if (code === 'CERT_HAS_EXPIRED' || code === 'CERT_NOT_YET_VALID') return clientError('CalDAV certificate is expired or not yet valid.');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return clientError('CalDAV server hostname could not be resolved.', { transient: true });
  if (code === 'ECONNREFUSED') return clientError('CalDAV server refused the connection.', { transient: true });
  if (code === 'ECONNRESET' || code === 'EPIPE') return clientError(`CalDAV connection closed during ${operation}.`, { transient: true });
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return clientError('CalDAV server network is unreachable.', { transient: true });
  if (code === 'ETIMEDOUT') return clientError(`CalDAV ${operation} timed out.`, { transient: true });
  return clientError(`CalDAV ${operation} failed before the server returned a usable response.`, { transient: true });
}

export function createCalDavClient({ fetchImpl = requestCalDav, timeoutMs = 8_000, cacheSeconds = 300, ca, now = Date.now, randomBytesImpl = randomBytes } = {}) {
  const cache = new Map();
  const inFlight = new Map();
  let generation = 0;
  const keyFor = (settings) => createHash('sha256').update(`${settings.serverUrl}\0${settings.username}\0${settings.password}`).digest('base64url');
  const responseUrl = (response, fallback) => response?.[RESPONSE_URL] || response?.url || fallback;
  const resolveHref = (value, baseUrl, origin) => {
    let target;
    try { target = new URL(value, baseUrl); }
    catch { throw clientError('CalDAV discovery returned a malformed URL.'); }
    if (target.origin !== origin || target.username || target.password || target.search || target.hash) throw clientError('CalDAV discovery returned an unsafe cross-origin URL.');
    return target.href;
  };
  const refresh = async (settings, requestGeneration) => {
    const rangeStart = Number(now());
    const rangeEnd = rangeStart + RANGE_DAYS * 86_400_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let operation = 'discovery';
    try {
      const origin = new URL(settings.serverUrl).origin;
      const nonceCounts = new Map();
      const requestXml = async (url, { method, depth, body, operation }) => {
        const request = (target, authorization) => fetchImpl(target, {
          method,
          headers: { Authorization: authorization, Depth: depth, Accept: 'application/xml, text/xml', 'Content-Type': 'application/xml; charset=utf-8' },
          body,
          signal: controller.signal,
          ca,
          origin
        });
        let actualUrl = url;
        let authorization = `Basic ${Buffer.from(`${settings.username}:${settings.password}`, 'utf8').toString('base64')}`;
        let response;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await request(actualUrl, authorization);
          actualUrl = responseUrl(response, actualUrl);
          const challenge = response?.status === 401 ? response.headers.get('www-authenticate') : null;
          if (!challenge || !/(?:^|,\s*)Digest\s/i.test(challenge) || attempt === 2) break;
          try { await response.body?.cancel(); } catch { /* The authentication retry does not need the challenge body. */ }
          const nonce = parseDigestChallenge(challenge)?.nonce;
          const nonceCount = (nonceCounts.get(nonce) ?? 0) + 1;
          nonceCounts.set(nonce, nonceCount);
          authorization = buildDigestAuthorization(challenge, settings, method, actualUrl, { cnonce: randomBytesImpl(16).toString('hex'), nonceCount });
        }
        if (!response || response.status !== 207) throw statusError(response?.status, operation);
        const contentType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/xml' && contentType !== 'text/xml') throw clientError('CalDAV returned an invalid response type.');
        return { xml: await boundedText(response), url: actualUrl };
      };
      const wellKnownUrl = new URL('/.well-known/caldav', settings.serverUrl).href;
      const principalResult = await requestXml(wellKnownUrl, { method: 'PROPFIND', depth: '0', body: PRINCIPAL_PROPFIND, operation: 'discovery' });
      const principalUrl = resolveHref(discoveryHref(principalResult.xml, 'DAV:', 'current-user-principal'), principalResult.url, origin);
      const homeResult = await requestXml(principalUrl, { method: 'PROPFIND', depth: '0', body: HOME_PROPFIND, operation: 'discovery' });
      const homeUrl = resolveHref(discoveryHref(homeResult.xml, CALDAV_NAMESPACE, 'calendar-home-set'), homeResult.url, origin);
      const calendarsResult = await requestXml(homeUrl, { method: 'PROPFIND', depth: '1', body: CALENDARS_PROPFIND, operation: 'discovery' });
      const collectionUrls = [...new Set(discoveryCalendars(calendarsResult.xml).map((href) => resolveHref(href, calendarsResult.url, origin)))].sort();
      if (!collectionUrls.length) throw clientError('CalDAV discovery found no event calendars for this account.');
      if (collectionUrls.length > MAX_CALENDARS) throw clientError(`CalDAV discovery found more than ${MAX_CALENDARS} event calendars.`);
      const reportBody = buildCalDavReport(rangeStart, rangeEnd);
      const fallbackReportBody = buildCalDavReport(rangeStart, rangeEnd, { expand: false });
      const calendarData = [];
      operation = 'calendar query';
      const queryCalendar = async (url) => {
        try { return await requestXml(url, { method: 'REPORT', depth: '1', body: reportBody, operation: 'calendar query' }); }
        catch (error) {
          if (error?.status !== 500) throw error;
          return requestXml(url, { method: 'REPORT', depth: '1', body: fallbackReportBody, operation: 'calendar query fallback' });
        }
      };
      for (let offset = 0; offset < collectionUrls.length; offset += REPORT_CONCURRENCY) {
        const results = await Promise.all(collectionUrls.slice(offset, offset + REPORT_CONCURRENCY).map(queryCalendar));
        for (const result of results) calendarData.push(...extractCalendarData(result.xml));
        if (calendarData.length > MAX_CALENDAR_OBJECTS || calendarData.reduce((total, value) => total + Buffer.byteLength(value), 0) > MAX_RESPONSE_BYTES) throw clientError('CalDAV calendar data exceeds parser limits.');
      }
      const events = parseCalendarEvents(calendarData, { rangeStart, rangeEnd });
      const key = keyFor(settings);
      if (requestGeneration === generation) cache.set(key, { events, fetchedAt: Number(now()) });
      return { events, stale: false };
    } catch (error) {
      throw connectionError(error, operation);
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
