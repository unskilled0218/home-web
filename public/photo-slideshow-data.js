export const MAX_PHOTO_NAME_BYTES = 1024;
export const MAX_SLIDESHOW_BYTES = 8192;
export const MAX_LOCAL_PHOTO_MANIFEST_BYTES = 262144;
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
  if (!fields(value, value?.version === 2 ? [...SNAPSHOT_FIELDS, 'next', 'queueRevision'] : SNAPSHOT_FIELDS) || ![1, 2].includes(value.version) || typeof value.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.instanceId)) throw new Error('Invalid slideshow snapshot version or instance.');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !timestamp(value.serverTime) || (value.nextChangeAt !== null && !timestamp(value.nextChangeAt))) throw new Error('Invalid slideshow revision or timestamp.');
  if (!['enabled', 'available', 'loading', 'stale'].every((key) => typeof value[key] === 'boolean') || !Number.isSafeInteger(value.count) || value.count < 0) throw new Error('Invalid slideshow status.');
  const current = value.current === null ? null : validateSlideshowPhoto(value.current);
  if (value.version === 2) {
    if (!Number.isSafeInteger(value.queueRevision) || value.queueRevision < 0) throw new Error('Invalid queue revision.');
    const next = value.next === null ? null : validateSlideshowPhoto(value.next);
    if (next && (!value.enabled || !value.available || value.count < 2 || next.name === current?.name)) throw new Error('Invalid upcoming photo.');
  }
  if (!value.enabled && (value.available || value.loading || value.stale)) throw new Error('Disabled slideshow cannot be active.');
  if (!value.available && (value.count !== 0 || current !== null || value.stale)) throw new Error('Unavailable slideshow cannot publish a pool.');
  if ((value.count > 0) !== (current !== null) || (value.count > 1) !== (value.nextChangeAt !== null)) throw new Error('Inconsistent slideshow selection or deadline.');
  if (slideshowBytes(value) > MAX_SLIDESHOW_BYTES) throw new Error('Slideshow snapshot too large.');
  return { ...value, current };
}

export function validateLocalPhotoManifest(value) {
  if (!fields(value, ['version', 'enabled', 'available', 'count', 'photos']) || value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.available !== 'boolean' || !Array.isArray(value.photos) || value.photos.length > 100 || value.count !== value.photos.length) throw new Error('Invalid Local photo manifest.');
  if ((!value.enabled && value.available) || (!value.available && value.photos.length)) throw new Error('Inconsistent Local photo source.');
  const photos = value.photos.map(validateSlideshowPhoto);
  if (slideshowBytes(value) > MAX_LOCAL_PHOTO_MANIFEST_BYTES) throw new Error('Local photo manifest exceeds limits.');
  return { ...value, photos };
}

export function validatePhotoLibraryStatus(value) {
  const names = ['supported', 'eligible', 'filenameExcluded', 'permissionExcluded', 'raceExcluded', 'fileExcluded'];
  const count = number => Number.isSafeInteger(number) && number >= 0;
  if (!fields(value, ['version', 'enabled', 'available', 'loading', 'complete', 'stale', 'error', 'counts', 'progress']) || value.version !== 1) throw new Error('Invalid photo inventory status.');
  if (!['enabled', 'available', 'loading', 'complete', 'stale'].every(key => typeof value[key] === 'boolean') || !count(value.progress) || ![null, 'resource-limit', 'scan-failed'].includes(value.error)) throw new Error('Invalid photo inventory state.');
  if (value.counts !== null && (!fields(value.counts, names) || !names.every(key => count(value.counts[key])) || value.counts.eligible + value.counts.filenameExcluded !== value.counts.supported)) throw new Error('Invalid photo inventory counts.');
  if (value.available !== (value.counts !== null) || value.complete !== (value.available && value.error === null) || value.stale !== (value.available && value.error !== null)) throw new Error('Inconsistent photo inventory state.');
  if (!value.enabled && (value.available || value.loading || value.error !== null || value.progress !== 0)) throw new Error('Disabled photo inventory cannot be active.');
  if (slideshowBytes(value) > MAX_SLIDESHOW_BYTES) throw new Error('Photo inventory status too large.');
  return { ...value, counts: value.counts ? { ...value.counts } : null };
}
