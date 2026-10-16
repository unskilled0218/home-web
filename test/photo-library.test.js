import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync, utimesSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPhotoLibrary, createUnavailablePhotoLibrary } from '../src/photo-library.js';
import { SMALL_PNG, photoFixture, populatePhotoFiles, readLibraryPhoto } from './fixtures/large-photo-library.js';

test('returns unavailable state without a configured photo root', async () => {
  const library = createUnavailablePhotoLibrary();
  assert.deepEqual(await library.list(), { available: false, photos: [] });
  assert.equal(await library.open('abcdefghijklmnop'), null);
});

test('discovers bounded regular images recursively and serves opaque snapshot entries', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dashboard-photos-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'nested'));
  writeFileSync(path.join(root, 'z.jpg'), 'jpeg');
  writeFileSync(path.join(root, 'nested', 'a.png'), 'png');
  writeFileSync(path.join(root, 'notes.txt'), 'private');
  writeFileSync(path.join(root, 'large.webp'), '');
  truncateSync(path.join(root, 'large.webp'), 20 * 1024 ** 2 + 1);
  symlinkSync(path.join(root, 'z.jpg'), path.join(root, 'linked.gif'));
  let sequence = 0;
  const library = createPhotoLibrary({ root, token: () => `token00000000000${sequence++}` });
  const result = await library.list();
  assert.equal(result.available, true);
  assert.deepEqual(result.photos.map((photo) => photo.name), ['nested/a.png', 'z.jpg']);
  assert.ok(result.photos.every((photo) => /^\/api\/dashboard\/photos\/token/.test(photo.url)));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const token = result.photos[0].url.split('/').at(-1);
  const opened = await library.open(token);
  assert.equal(opened.mime, 'image/png');
  assert.equal(opened.size, 3);
  let content = '';
  for await (const chunk of opened.stream) content += chunk;
  assert.equal(content, 'png');
  assert.equal(await library.open('../notes.txt'), null);
});

test('rejects replaced snapshot files and retains old tokens safely after rescanning', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dashboard-photos-race-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, 'photo.png');
  writeFileSync(target, 'png');
  let sequence = 0;
  const library = createPhotoLibrary({ root, token: () => `token00000000000${sequence++}` });
  const first = await library.list();
  const firstToken = first.photos[0].url.split('/').at(-1);
  rmSync(target);
  symlinkSync('/etc/passwd', target);
  assert.equal(await library.open(firstToken), null);
  const second = await library.list();
  assert.deepEqual(second.photos, []);
  assert.equal(await library.open(firstToken), null);
});

test('caps a photo snapshot at 100 files', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dashboard-photo-limit-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (let index = 0; index < 105; index++) writeFileSync(path.join(root, `${String(index).padStart(3, '0')}.jpg`), 'x');
  let sequence = 0;
  const result = await createPhotoLibrary({ root, token: () => `token00000000000${sequence++}` }).list();
  assert.equal(result.photos.length, 100);
  assert.equal(result.photos[0].name, '000.jpg');
  assert.equal(result.photos.at(-1).name, '099.jpg');
});

test('keeps earlier manifest tokens valid across another browser scan', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dashboard-photo-generations-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'photo.jpg'), 'image');
  const library = createPhotoLibrary({ root });
  const first = await library.list();
  const second = await library.list();
  assert.equal(first.photos[0].url, second.photos[0].url);
  const opened = await library.open(first.photos[0].url.split('/').at(-1));
  assert.ok(opened);
  opened.stream.destroy();
});

test('applies an overall scan deadline and reserves at most eight streams', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'dashboard-photo-bounds-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'photo.jpg'), 'image');
  let clock = 0;
  const expired = createPhotoLibrary({ root, scanTimeoutMs: 10, now: () => { clock += 20; return clock; } });
  assert.deepEqual(await expired.list(), { available: false, photos: [] });
  const library = createPhotoLibrary({ root });
  const manifest = await library.list();
  const token = manifest.photos[0].url.split('/').at(-1);
  const opened = await Promise.all(Array.from({ length: 9 }, () => library.open(token)));
  assert.equal(opened.filter(Boolean).length, 8);
  for (const photo of opened.filter(Boolean)) photo.stream.destroy();
});

test('observed replacement metadata changes the opaque URL while unchanged scans remain stable', async (context) => {
  const root = mkdtempSync('/tmp/opencode/photo-token-metadata-'); context.after(() => rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'photo.png'); writeFileSync(file, 'first'); const library = createPhotoLibrary({ root });
  const first = await library.list(); assert.deepEqual(await library.list(), first);
  writeFileSync(file, 'second-image'); utimesSync(file, 100, 100);
  const second = await library.list(); assert.notEqual(second.photos[0].url, first.photos[0].url); assert.deepEqual(await library.list(), second);
  const opened = await library.open(first.photos[0].url.split('/').at(-1)); assert.ok(opened); let content = ''; for await (const chunk of opened.stream) content += chunk; assert.equal(content, 'second-image');
});

for (const count of [4999, 5000, 5001, 7001]) test(`processes admitted images from a ${count}-entry directory without truncating to the first file`, { timeout: 30000 }, async context => {
  const root = photoFixture(context); populatePhotoFiles(root, count);
  const library = createPhotoLibrary({ root, now: () => 1000 }); const result = await library.list();
  assert.equal(result.available, true); assert.equal(result.photos.length, 100);
  const names = result.photos.map(photo => photo.name); assert.equal(new Set(names).size, 100); assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.ok(result.photos.every(photo => /^\/api\/dashboard\/photos\/[A-Za-z0-9_-]{16,128}$/.test(photo.url)));
  for (const photo of [result.photos[0], result.photos.at(-1)]) assert.deepEqual(await readLibraryPhoto(library, photo), { mime: 'image/png', content: SMALL_PNG });
});

test('an unsupported first entry does not discard images in an exactly-full admitted directory', { timeout: 30000 }, async context => {
  const root = photoFixture(context); writeFileSync(path.join(root, '000-note.txt'), 'unsupported'); populatePhotoFiles(root, 4999, { prefix: 'photo-' });
  const result = await createPhotoLibrary({ root, now: () => 1000 }).list(); assert.equal(result.available, true); assert.equal(result.photos.length, 100); assert.ok(result.photos.every(photo => photo.name.startsWith('photo-')));
});

test('nested enumeration exhaustion still processes admitted parent sibling images', { timeout: 30000 }, async context => {
  const root = photoFixture(context); const nested = path.join(root, 'a-nested'); mkdirSync(nested);
  populatePhotoFiles(nested, 4997, { extension: 'txt', content: 'unsupported' });
  writeFileSync(path.join(root, 'z-first.png'), SMALL_PNG); writeFileSync(path.join(root, 'z-last.png'), SMALL_PNG);
  const result = await createPhotoLibrary({ root, now: () => 1000 }).list(); assert.equal(result.available, true); assert.deepEqual(result.photos.map(photo => photo.name), ['z-first.png', 'z-last.png']);
});

test('finishing an admitted root batch does not bypass exhaustion to enumerate a child directory', { timeout: 30000 }, async context => {
  const root = photoFixture(context); const nested = path.join(root, 'a-nested'); mkdirSync(nested); writeFileSync(path.join(nested, 'excluded.png'), SMALL_PNG);
  populatePhotoFiles(root, 4999, { extension: 'txt', content: 'unsupported' });
  assert.deepEqual(await createPhotoLibrary({ root, now: () => 1000 }).list(), { available: true, photos: [] });
});

test('concurrent large-directory readers share the actual scan promise and result', { timeout: 30000 }, async context => {
  const root = photoFixture(context); populatePhotoFiles(root, 7001); const library = createPhotoLibrary({ root, now: () => 1000 });
  const first = library.list(); const second = library.list(); assert.equal(first, second);
  const [a, b] = await Promise.all([first, second]); assert.equal(a, b); assert.equal(a.photos.length, 100);
});
