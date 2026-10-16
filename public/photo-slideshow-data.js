export const MAX_PHOTO_NAME_BYTES = 1024;
export const MAX_SLIDESHOW_BYTES = 8192;
const encoder = new TextEncoder();
const PHOTO_FIELDS = ['name', 'lastModified', 'url'];
const SNAPSHOT_FIELDS = ['version', 'instanceId', 'revision', 'serverTime', 'enabled', 'available', 'loading', 'stale', 'count', 'current', 'nextChangeAt'];
const fields = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
const timestamp = (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
export const slideshowBytes = (value) => encoder.encode(JSON.stringify(value)).byteLength;

export function validateSlideshowPhoto(value) {
  if (!fields(value, PHOTO_FIELDS) || typeof value.name !== 'string' || !value.name || !value.name.isWellFormed()) throw new Error('Invalid slideshow photo name.');
  if (encoder.encode(value.name).byteLength > MAX_PHOTO_NAME_BYTES || /[\\\u0000-\u001f\u007f]/u.test(value.name) || /^[A-Za-z]:/.test(value.name)) throw new Error('Unsupported slideshow photo name.');
  if (value.name.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('Invalid relative photo name.');
  if (!timestamp(value.lastModified) || typeof value.url !== 'string' || !/^\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/.test(value.url)) throw new Error('Invalid slideshow photo metadata.');
  return { name: value.name, lastModified: value.lastModified, url: value.url };
}

export function validateSlideshowSnapshot(value) {
  if (!fields(value, SNAPSHOT_FIELDS) || value.version !== 1 || typeof value.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.instanceId)) throw new Error('Invalid slideshow snapshot version or instance.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !timestamp(value.serverTime) || (value.nextChangeAt !== null && !timestamp(value.nextChangeAt))) throw new Error('Invalid slideshow revision or timestamp.');
  if (!['enabled', 'available', 'loading', 'stale'].every((key) => typeof value[key] === 'boolean') || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > 100) throw new Error('Invalid slideshow status.');
  const current = value.current === null ? null : validateSlideshowPhoto(value.current);
  if (!value.enabled && (value.available || value.loading || value.stale)) throw new Error('Disabled slideshow cannot be active.');
  if (!value.available && (value.count !== 0 || current !== null || value.stale)) throw new Error('Unavailable slideshow cannot publish a pool.');
  if ((value.count > 0) !== (current !== null) || (value.count > 1) !== (value.nextChangeAt !== null)) throw new Error('Inconsistent slideshow selection or deadline.');
  if (slideshowBytes(value) > MAX_SLIDESHOW_BYTES) throw new Error('Slideshow snapshot too large.');
  return { ...value, current };
}
