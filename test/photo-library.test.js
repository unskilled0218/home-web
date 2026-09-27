import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createPhotoLibrary, createUnavailablePhotoLibrary } from '../src/photo-library.js';

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
