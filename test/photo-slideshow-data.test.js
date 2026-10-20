import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PHOTO_NAME_BYTES, MAX_SLIDESHOW_BYTES, slideshowBytes, validateSlideshowPhoto, validateSlideshowSnapshot } from '../public/photo-slideshow-data.js';
import { photo, slideshowSnapshot } from './fixtures/photo-slideshow.js';

test('shared photo contract counts UTF-8 bytes and preserves accepted names and URLs', () => {
  for (const name of ['é'.repeat(510) + '.png', 'a'.repeat(1020) + '.png', 'folder/日"本.png']) assert.deepEqual(validateSlideshowPhoto(photo(name)), photo(name));
  assert.equal(MAX_PHOTO_NAME_BYTES, 1024); assert.equal(MAX_SLIDESHOW_BYTES, 8192);
  for (const name of ['é'.repeat(511) + '.png', 'a'.repeat(1021) + '.png', '', '/a.png', 'C:/a.png', 'a//b.png', './a.png', '../a.png', 'a/../b.png', 'a\\b.png', 'a\n.png', 'a\u007f.png', '\ud800.png']) assert.throws(() => validateSlideshowPhoto(photo(name)), undefined, JSON.stringify(name));
  for (const extra of [{ url: 'https://evil.test/a' }, { url: '/etc/passwd' }, { lastModified: Infinity }, { absolute: '/secret' }]) assert.throws(() => validateSlideshowPhoto({ ...photo(), ...extra }));
});

test('snapshot schema distinguishes loading, unavailable, stale, empty and disabled states', () => {
  const empty = { count: 0, current: null, nextChangeAt: null };
  for (const extra of [{}, { ...empty }, { ...empty, available: false, loading: true }, { ...empty, available: false }, { ...empty, available: false, enabled: false }, { stale: true }, { count: 2, nextChangeAt: 1_005_000 }]) assert.doesNotThrow(() => validateSlideshowSnapshot(slideshowSnapshot(extra)));
  assert.doesNotThrow(() => validateSlideshowSnapshot(slideshowSnapshot({ count: 7001, nextChangeAt: 1_005_000 })));
  for (const extra of [{ version: 3 }, { instanceId: 'x'.repeat(129) }, { revision: -1 }, { revision: 0.1 }, { serverTime: NaN }, { nextChangeAt: 'soon' }, { count: Number.MAX_SAFE_INTEGER + 1 }, { count: 0 }, { current: null }, { enabled: false }, { available: false }, { count: 2 }, { nextChangeAt: 5 }, { ...empty, available: false, stale: true }, { extra: true }]) assert.throws(() => validateSlideshowSnapshot(slideshowSnapshot(extra)), undefined, JSON.stringify(extra));
  const value = slideshowSnapshot({ current: photo('é".png') });
  assert.equal(slideshowBytes(value), Buffer.byteLength(JSON.stringify(value), 'utf8'));
  assert.ok(slideshowBytes(value) <= MAX_SLIDESHOW_BYTES);
});

test('version 2 has an independent exact schema, nullable preview and bounded worst-case metadata', () => {
  const valid = slideshowSnapshot({ version: 2, count: 2, nextChangeAt: 5, next: photo('b.png'), queueRevision: 3 });
  assert.deepEqual(validateSlideshowSnapshot(valid), valid);
  assert.doesNotThrow(() => validateSlideshowSnapshot({ ...valid, next: null }));
  for (const extra of [{ version: 1 }, { queueRevision: -1 }, { queueRevision: 0.5 }, { queueRevision: Number.MAX_SAFE_INTEGER + 1 }, { next: valid.current }, { next: photo('../bad') }, { count: 1, nextChangeAt: null }, { extra: true }]) assert.throws(() => validateSlideshowSnapshot({ ...valid, ...extra }));
  const missing = { ...valid }; delete missing.next; assert.throws(() => validateSlideshowSnapshot(missing));
  const worst = { ...valid, current: photo('"'.repeat(1024)), next: photo('a' + '"'.repeat(1023)), instanceId: 'x'.repeat(128) };
  assert.ok(slideshowBytes(validateSlideshowSnapshot(worst)) < 8192);
});
