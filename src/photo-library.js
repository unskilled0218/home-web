import { createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open as openFile, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

const TYPES = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif']]);
const MAX_FILES = 100;
const MAX_FILE_BYTES = 20 * 1024 ** 2;
const MAX_TOTAL_BYTES = 200 * 1024 ** 2;
const MAX_ENTRIES = 5_000;
const MAX_DEPTH = 8;
const MAX_SNAPSHOT_ENTRIES = 1_000;
const MAX_OPEN_STREAMS = 8;

const unavailable = () => ({ available: false, photos: [] });

export function createPhotoLibrary({ root, available = Boolean(root), token, now = Date.now, scanTimeoutMs = 10_000 } = {}) {
  const snapshot = new Map();
  const tokenSecret = randomBytes(32);
  const createToken = token ?? ((relative) => createHmac('sha256', tokenSecret).update(relative).digest('base64url'));
  let scanPromise;
  let activeStreams = 0;

  async function scan() {
    if (!available || !root) return unavailable();
    const deadline = now() + scanTimeoutMs;
    const checkDeadline = () => { if (now() > deadline) throw new Error('Photo scan timed out.'); };
    let realRoot;
    try { realRoot = await realpath(root); } catch { return unavailable(); }
    const candidates = [];
    let entries = 0;
    async function visit(directory, relativeDirectory, depth) {
      if (depth > MAX_DEPTH || entries >= MAX_ENTRIES) return;
      checkDeadline();
      let directoryHandle;
      try {
        directoryHandle = await openFile(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        const resolvedDirectory = await realpath(`/proc/self/fd/${directoryHandle.fd}`);
        if (resolvedDirectory !== realRoot && !resolvedDirectory.startsWith(`${realRoot}${path.sep}`)) throw new Error('Directory escaped photo root.');
        const children = [];
        const handle = await opendir(`/proc/self/fd/${directoryHandle.fd}`);
        for await (const entry of handle) {
          checkDeadline(); entries++;
          if (entries > MAX_ENTRIES) break;
          children.push(entry);
        }
        children.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of children) {
          checkDeadline();
          const relative = path.join(relativeDirectory, entry.name);
          const stablePath = `/proc/self/fd/${directoryHandle.fd}/${entry.name}`;
          if (entry.isDirectory()) await visit(stablePath, relative, depth + 1);
          else if (entry.isFile() && TYPES.has(path.extname(entry.name).toLowerCase())) {
            let fileHandle;
            try {
              fileHandle = await openFile(stablePath, constants.O_RDONLY | constants.O_NOFOLLOW);
              const metadata = await fileHandle.stat();
              if (metadata.isFile() && metadata.size > 0 && metadata.size <= MAX_FILE_BYTES) candidates.push({ absolute: path.join(realRoot, relative), relative, size: metadata.size, mtimeMs: metadata.mtimeMs, mime: TYPES.get(path.extname(entry.name).toLowerCase()) });
            } finally { await fileHandle?.close(); }
          }
          if (entries >= MAX_ENTRIES) break;
        }
      } finally { await directoryHandle?.close(); }
    }
    try { await visit(realRoot, '', 0); } catch { return unavailable(); }
    candidates.sort((left, right) => left.relative.localeCompare(right.relative));
    const photos = [];
    let total = 0;
    for (const candidate of candidates) {
      if (photos.length >= MAX_FILES || total + candidate.size > MAX_TOTAL_BYTES) continue;
      total += candidate.size;
      let id = null;
      for (let attempt = 0; attempt < 10 && (!id || snapshot.has(id)); attempt++) {
        const value = createToken(candidate.relative, attempt);
        if (/^[A-Za-z0-9_-]{16,128}$/.test(value)) id = value;
        if (id && snapshot.get(id)?.relative === candidate.relative) break;
      }
      if (!id || (snapshot.has(id) && snapshot.get(id).relative !== candidate.relative)) throw new Error('Could not create a photo token.');
      snapshot.delete(id);
      snapshot.set(id, { ...candidate, root: realRoot });
      photos.push({ name: candidate.relative.split(path.sep).join('/'), lastModified: Math.trunc(candidate.mtimeMs), url: `/api/dashboard/photos/${id}` });
    }
    while (snapshot.size > MAX_SNAPSHOT_ENTRIES) snapshot.delete(snapshot.keys().next().value);
    return { available: true, photos };
  }

  function collect() {
    if (!scanPromise) scanPromise = scan().finally(() => { scanPromise = undefined; });
    return scanPromise;
  }

  async function open(id) {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(id) || activeStreams >= MAX_OPEN_STREAMS) return null;
    const candidate = snapshot.get(id);
    if (!candidate) return null;
    activeStreams++;
    let released = false;
    const release = () => { if (!released) { released = true; activeStreams--; } };
    let handle;
    try {
      let current = candidate.root;
      const segments = candidate.relative.split(path.sep);
      for (const segment of segments) {
        current = path.join(current, segment);
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) { release(); return null; }
      }
      handle = await openFile(candidate.absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
      const resolved = await realpath(`/proc/self/fd/${handle.fd}`);
      if (resolved !== candidate.root && !resolved.startsWith(`${candidate.root}${path.sep}`)) { await handle.close(); release(); return null; }
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_FILE_BYTES || TYPES.get(path.extname(resolved).toLowerCase()) !== candidate.mime) { await handle.close(); release(); return null; }
      const stream = handle.createReadStream({ autoClose: true, start: 0, end: metadata.size - 1 });
      stream.once('close', release);
      return { stream, mime: candidate.mime, size: metadata.size };
    } catch { try { await handle?.close(); } catch {} release(); return null; }
  }

  return { list: collect, open };
}

export function createUnavailablePhotoLibrary() {
  return { list: async () => unavailable(), open: async () => null };
}
