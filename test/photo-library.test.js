import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, truncateSync, writeFileSync, utimesSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createPhotoLibrary, createUnavailablePhotoLibrary } from '../src/photo-library.js';
import { validatePhotoLibraryStatus } from '../public/photo-slideshow-data.js';
import { SMALL_PNG, photoFixture, populatePhotoFiles, readLibraryPhoto } from './fixtures/large-photo-library.js';
import { slideshowClock } from './fixtures/photo-slideshow.js';
import { deferred, tick } from './fixtures/lifecycle.js';

test('unconfigured library has complete no-work contracts and unknown counts', async () => {
  const library = createUnavailablePhotoLibrary();
  for (const result of [await library.list(), await library.local(), await library.refresh(), library.inventory()]) assert.deepEqual(result, { available: false, photos: [] });
  assert.equal(validatePhotoLibraryStatus(library.status()).counts, null);
  assert.equal(await library.open('abcdefghijklmnop'), null); await library.stop();
});

test('discovers safe regular images, retains legacy names, and streams opaque URLs', async context => {
  const root = photoFixture(context); mkdirSync(path.join(root, 'nested'));
  writeFileSync(path.join(root, 'z.jpg'), 'jpeg'); writeFileSync(path.join(root, 'nested', 'a.png'), SMALL_PNG);
  writeFileSync(path.join(root, 'bad\n.png'), SMALL_PNG); writeFileSync(path.join(root, 'notes.txt'), 'private');
  writeFileSync(path.join(root, 'large.webp'), ''); truncateSync(path.join(root, 'large.webp'), 20 * 1024 ** 2 + 1);
  symlinkSync(path.join(root, 'z.jpg'), path.join(root, 'linked.gif'));
  const library = createPhotoLibrary({ root }); context.after(() => library.stop());
  assert.equal((await library.list()).available, false, 'cached read must not initiate discovery');
  const result = await library.refresh();
  assert.deepEqual(result.photos.map(photo => photo.name), ['nested/a.png', 'z.jpg']);
  assert.equal((await library.list()).photos.length, 3); assert.equal((await library.local()).photos.length, 2);
  assert.deepEqual(library.status().counts, { supported: 3, eligible: 2, filenameExcluded: 1, permissionExcluded: 0, raceExcluded: 0, fileExcluded: 2 });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(root));
  assert.deepEqual(await readLibraryPhoto(library, result.photos[0]), { mime: 'image/png', content: SMALL_PNG });
  assert.equal(await library.open('../notes.txt'), null);
});

for (const count of [105, 5001, 7001]) test(`all ${count} images are discoverable and late tokens remain streamable`, { timeout: 30000 }, async context => {
  const root = photoFixture(context); populatePhotoFiles(root, count); const library = createPhotoLibrary({ root }); context.after(() => library.stop());
  const result = await library.refresh(); assert.equal(result.photos.length, count); assert.equal(library.status().counts.eligible, count);
  assert.equal((await library.list()).photos.length, 100); assert.equal((await library.local()).photos.length, 100);
  for (const index of [0, Math.floor(count / 2), count - 1]) assert.deepEqual(await readLibraryPhoto(library, result.photos[index]), { mime: 'image/png', content: SMALL_PNG });
  assert.equal((await library.refresh()).revision, result.revision); assert.deepEqual(await readLibraryPhoto(library, result.photos[0]), { mime: 'image/png', content: SMALL_PNG });
});

test('full discovery descends beyond eight levels and ignores aggregate source-byte totals', async context => {
  const root = photoFixture(context); const nested = path.join(root, ...Array(12).fill('deep')); mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(nested, 'last.png'), SMALL_PNG);
  for (let i = 0; i < 11; i++) { const file = path.join(root, `${String(i).padStart(2, '0')}.png`); writeFileSync(file, 'x'); truncateSync(file, 20 * 1024 ** 2 - 1024); }
  const library = createPhotoLibrary({ root }); context.after(() => library.stop()); const result = await library.refresh();
  assert.equal(result.photos.length, 12); assert.equal((await library.local()).photos.length, 12);
  const legacy = await library.list(); assert.equal(legacy.photos.length, 11, 'legacy skips the eleventh large file and admits the later small file');
  assert.equal(legacy.photos.at(-1).name, result.photos.at(-1).name);
});

test('complete projections and revisions are independent of directory enumeration order', async context => {
  const root = photoFixture(context); populatePhotoFiles(root, 105); writeFileSync(path.join(root, '\u0001.png'), SMALL_PNG);
  let reverse = false;
  const adapter = { ...fs, async opendir(...args) {
    const entries = []; for await (const entry of await fs.opendir(...args)) entries.push(entry);
    if (reverse) entries.reverse();
    return { async *[Symbol.asyncIterator]() { yield* entries; } };
  } };
  const library = createPhotoLibrary({ root, fs: adapter }); context.after(() => library.stop());
  const first = await library.refresh(); const local = await library.local(); const legacy = await library.list(); reverse = true;
  assert.equal((await library.refresh()).revision, first.revision); assert.deepEqual(await library.local(), local); assert.deepEqual(await library.list(), legacy);
  assert.equal(local.photos[0].name, '00000.png'); assert.equal(legacy.photos.length, 100);
});

test('tokens survive replacement grace, expire without losing active URLs, and reject symlink replacement', async context => {
  const root = photoFixture(context); const file = path.join(root, 'a.png'); writeFileSync(file, 'first'); const clock = slideshowClock();
  const library = createPhotoLibrary({ root, ...clock }); context.after(() => library.stop()); const first = await library.refresh();
  assert.equal((await library.refresh()).photos[0].url, first.photos[0].url);
  writeFileSync(file, 'second'); utimesSync(file, 100, 100); const second = await library.refresh();
  assert.notEqual(second.photos[0].url, first.photos[0].url);
  assert.equal((await readLibraryPhoto(library, first.photos[0])).content.toString(), 'second');
  await clock.advance(30001); assert.equal(await library.open(first.photos[0].url.split('/').at(-1)), null);
  assert.equal((await readLibraryPhoto(library, second.photos[0])).content.toString(), 'second');
  rmSync(file); symlinkSync('/etc/passwd', file); assert.equal(await library.open(second.photos[0].url.split('/').at(-1)), null);
  assert.equal((await library.refresh()).photos.length, 0); await library.stop(); assert.equal(clock.timers.size, 0);
});

for (const code of ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EIO', 'ESTALE', 'ETIMEDOUT', 'UNKNOWN']) test(`file error ${code} follows the exclusion or incomplete policy`, async context => {
  const root = photoFixture(context); writeFileSync(path.join(root, 'a.png'), SMALL_PNG); writeFileSync(path.join(root, 'b.png'), SMALL_PNG);
  let fail = false;
  const library = createPhotoLibrary({ root, fs: { ...fs, open(file, ...args) { if (fail && String(file).endsWith('/b.png')) return Promise.reject(Object.assign(new Error(code), { code })); return fs.open(file, ...args); } } });
  context.after(() => library.stop()); const first = await library.refresh(); fail = true; const next = await library.refresh(); const status = validatePhotoLibraryStatus(library.status());
  if (['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code)) {
    assert.equal(next.photos.length, 1); assert.equal(status.complete, true);
    assert.equal(status.counts[['EACCES', 'EPERM'].includes(code) ? 'permissionExcluded' : 'raceExcluded'], 1);
  } else {
    assert.equal(next.available, false); assert.equal(status.complete, false); assert.equal(status.stale, true); assert.equal(status.error, 'scan-failed');
    assert.equal(library.inventory().revision, first.revision); assert.equal((await library.list()).photos.length, 2);
  }
});

for (const code of ['ENOENT', 'EACCES', 'EIO']) test(`directory error ${code} cannot publish a partial inventory`, async context => {
  const root = photoFixture(context); mkdirSync(path.join(root, 'nested')); writeFileSync(path.join(root, 'a.png'), SMALL_PNG);
  const library = createPhotoLibrary({ root, fs: { ...fs, open(file, ...args) { if (String(file).endsWith('/nested')) return Promise.reject(Object.assign(new Error(code), { code })); return fs.open(file, ...args); } } });
  context.after(() => library.stop()); assert.equal((await library.refresh()).available, false); assert.equal(library.status().counts, null); assert.equal(library.status().complete, false);
});

test('budget failure preserves active tokens and releases staging for a later successful refresh', async context => {
  const root = photoFixture(context); writeFileSync(path.join(root, 'a.png'), SMALL_PNG); const library = createPhotoLibrary({ root, metadataBudget: 8000 }); context.after(() => library.stop());
  const first = await library.refresh(); populatePhotoFiles(root, 10);
  assert.equal((await library.refresh()).available, false); assert.equal(library.status().error, 'resource-limit'); assert.equal(library.inventory().revision, first.revision);
  assert.deepEqual((await readLibraryPhoto(library, first.photos[0])).content, SMALL_PNG);
  for (let i = 0; i < 10; i++) rmSync(path.join(root, `${String(i).padStart(5, '0')}.png`));
  assert.equal((await library.refresh()).revision, first.revision); assert.equal(library.status().error, null);
});

test('expired generations release their budget across many replacements', async context => {
  const root = photoFixture(context); const file = path.join(root, 'a.png'); const clock = slideshowClock();
  const library = createPhotoLibrary({ root, ...clock, metadataBudget: 8000 }); context.after(() => library.stop());
  for (let index = 0; index < 20; index++) {
    writeFileSync(file, `image-${index}`); utimesSync(file, 100 + index, 100 + index);
    const result = await library.refresh(); assert.equal(result.available, true, `generation ${index} fits after grace expiry`);
    assert.equal((await readLibraryPhoto(library, result.photos[0])).content.toString(), `image-${index}`);
    await clock.advance(30001);
  }
  await library.stop(); assert.equal(clock.timers.size, 0);
});

test('unsupported directory entries do not hide later supported files or deeper siblings', async context => {
  const root = photoFixture(context); const nested = path.join(root, 'a-nested'); mkdirSync(nested); populatePhotoFiles(nested, 5001, { extension: 'txt', content: 'unsupported' });
  writeFileSync(path.join(nested, 'z-last.png'), SMALL_PNG); writeFileSync(path.join(root, 'z-parent.png'), SMALL_PNG);
  const library = createPhotoLibrary({ root }); context.after(() => library.stop());
  assert.deepEqual((await library.refresh()).photos.map(photo => photo.name), ['a-nested/z-last.png', 'z-parent.png']);
});

test('scans coalesce, yield, close file descriptors, and stop drains actual pending filesystem work', async context => {
  const root = photoFixture(context); populatePhotoFiles(root, 3); const pending = deferred(); let opened = 0; let closed = 0; let yields = 0;
  const library = createPhotoLibrary({ root, batchSize: 2, yieldWork: async () => { yields++; await tick(); }, fs: { ...fs,
    async realpath(...args) { if (args[0] === root) await pending.promise; return fs.realpath(...args); },
    async open(...args) { const handle = await fs.open(...args); opened++; const close = handle.close.bind(handle); handle.close = async () => { closed++; return close(); }; return handle; }
  } });
  const first = library.refresh(); assert.equal(library.refresh(), first); let drained = false; const stopping = library.stop().then(() => { drained = true; });
  await tick(); assert.equal(drained, false); pending.resolve(); await stopping;
  assert.equal((await first).available, false); assert.equal(opened, closed); assert.equal((await library.refresh()).available, false);
  const working = createPhotoLibrary({ root, batchSize: 2, yieldWork: async () => { yields++; await tick(); } }); context.after(() => working.stop());
  await working.refresh(); assert.ok(yields > 0); assert.equal(working.status().counts.eligible, 3);
});

test('at most eight image streams are admitted', async context => {
  const root = photoFixture(context); writeFileSync(path.join(root, 'a.png'), SMALL_PNG); const library = createPhotoLibrary({ root }); context.after(() => library.stop());
  const result = await library.refresh(); const id = result.photos[0].url.split('/').at(-1); const opened = await Promise.all(Array.from({ length: 9 }, () => library.open(id)));
  assert.equal(opened.filter(Boolean).length, 8); await Promise.all(opened.filter(Boolean).map(item => new Promise(resolve => { item.stream.once('close', resolve); item.stream.destroy(); })));
});
