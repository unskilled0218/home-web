import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SMALL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

export function photoFixture(context) {
  const root = mkdtempSync('/tmp/opencode/large-photo-library-');
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

export function populatePhotoFiles(root, count, { prefix = '', extension = 'png', content = SMALL_PNG } = {}) {
  for (let index = 0; index < count; index++) writeFileSync(path.join(root, `${prefix}${String(index).padStart(5, '0')}.${extension}`), content);
}

export async function readLibraryPhoto(library, photo) {
  const opened = await library.open(photo.url.split('/').at(-1));
  if (!opened) throw new Error(`Fixture photo could not be opened: ${photo.name}`);
  const closed = new Promise(resolve => opened.stream.once('close', resolve));
  const chunks = []; try { for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk)); } finally { await closed; }
  return { mime: opened.mime, content: Buffer.concat(chunks) };
}
