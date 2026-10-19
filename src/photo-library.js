import { createHash, createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { setImmediate as yieldImmediate } from 'node:timers/promises';
import path from 'node:path';
import { validateSlideshowPhoto } from '../public/photo-slideshow-data.js';
import { sortPhotoRecords } from './photo-inventory.js';

const TYPES = new Map([['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.gif', 'image/gif']]);
const MAX_FILE_BYTES = 20 * 1024 ** 2;
const LEGACY_BYTES = 200 * 1024 ** 2;
const unavailable = () => ({ available: false, photos: [] });
const counts = () => ({ supported: 0, eligible: 0, filenameExcluded: 0, permissionExcluded: 0, raceExcluded: 0, fileExcluded: 0 });
const inside = (root, value) => value === root || value.startsWith(`${root}${path.sep}`);

export function createPhotoLibrary({ root, available = Boolean(root), token, now = Date.now, fs = filesystem, metadataBudget = 64 * 1024 ** 2, batchSize = 256, yieldWork = yieldImmediate, schedule = setTimeout, cancel = clearTimeout, graceMs = 30_000 } = {}) {
  const secret = randomBytes(32);
  const createToken = token ?? ((relative, _attempt, metadata) => createHmac('sha256', secret).update(JSON.stringify([relative, metadata.mtimeMs, metadata.size])).digest('base64url'));
  let active; let retired = []; let expiryTimer; let scanPromise; let stopPromise; let stopped = false;
  let activeStreams = 0; let stagingBytes = 0; let progress = 0; let loading = false; let error = null;
  const enabled = Boolean(available && root);
  const usedBytes = () => (active?.bytes ?? 0) + retired.reduce((sum, item) => sum + item.generation.bytes, 0) + stagingBytes;
  function expire() {
    cancel(expiryTimer); expiryTimer = undefined;
    retired = retired.filter(item => item.expires > now());
    if (retired.length && !stopped) {
      expiryTimer = schedule(expire, Math.max(1, Math.min(...retired.map(item => item.expires)) - now()));
      expiryTimer?.unref?.();
    }
  }
  function reserve(bytes) {
    if (usedBytes() + bytes > metadataBudget) throw Object.assign(new Error('Photo metadata budget exhausted.'), { code: 'PHOTO_BUDGET' });
    stagingBytes += bytes;
  }
  function inventory() { return active ? { available: true, photos: active.photos, revision: active.revision } : unavailable(); }
  function status() {
    expire();
    return { version: 1, enabled, available: Boolean(active), loading, complete: Boolean(active) && error === null, stale: Boolean(active) && error !== null, error, counts: active ? { ...active.counts } : null, progress };
  }
  async function noSymlinks(realRoot, relative) {
    let current = realRoot;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      if ((await fs.lstat(current)).isSymbolicLink()) throw Object.assign(new Error('Photo path became a symlink.'), { code: 'PHOTO_SYMLINK' });
    }
  }
  async function scan() {
    loading = true; progress = 0; stagingBytes = 0; expire();
    let operations = 0;
    async function checkpoint() {
      if (stopped) throw Object.assign(new Error('Photo library stopped.'), { code: 'PHOTO_STOPPED' });
      if (++operations % batchSize === 0) await yieldWork();
      if (stopped) throw Object.assign(new Error('Photo library stopped.'), { code: 'PHOTO_STOPPED' });
    }
    try {
      const realRoot = await fs.realpath(root); const counters = counts(); const records = []; const tokens = new Map();
      const stack = [{ relative: '', bytes: 256 }]; reserve(256);
      while (stack.length) {
        await checkpoint();
        const directory = stack.pop();
        let directoryHandle;
        try {
          await noSymlinks(realRoot, directory.relative);
          directoryHandle = await fs.open(path.join(realRoot, directory.relative), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          if (!inside(realRoot, await fs.realpath(`/proc/self/fd/${directoryHandle.fd}`))) throw new Error('Directory escaped photo root.');
          const handle = await fs.opendir(`/proc/self/fd/${directoryHandle.fd}`);
          for await (const entry of handle) {
            await checkpoint(); progress++;
            const relative = path.join(directory.relative, entry.name);
            const stablePath = `/proc/self/fd/${directoryHandle.fd}/${entry.name}`;
            if (entry.isDirectory()) {
              const bytes = 256 + Buffer.byteLength(relative) * 8; reserve(bytes); stack.push({ relative, bytes });
            } else if (entry.isFile() && TYPES.has(path.extname(entry.name).toLowerCase())) {
              let fileHandle;
              try {
                fileHandle = await fs.open(stablePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                const metadata = await fileHandle.stat();
                if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_FILE_BYTES) { counters.fileExcluded++; continue; }
                // Charge metadata, token maps, projections, merge buffers and playback indexes before retaining a record.
                reserve(2048 + Buffer.byteLength(relative) * 8);
                const candidate = { relative, size: metadata.size, mtimeMs: metadata.mtimeMs, mime: TYPES.get(path.extname(entry.name).toLowerCase()), root: realRoot };
                let id;
                for (let attempt = 0; attempt < 10; attempt++) {
                  const value = createToken(relative, attempt, candidate);
                  const owner = tokens.get(value) ?? active?.tokens.get(value) ?? retired.map(item => item.generation.tokens.get(value)).find(Boolean);
                  if (/^[A-Za-z0-9_-]{16,128}$/.test(value) && (!owner || owner.relative === relative)) { id = value; break; }
                }
                if (!id) throw new Error('Could not create a photo token.');
                const photo = { name: relative.split(path.sep).join('/'), lastModified: Math.trunc(metadata.mtimeMs), url: `/api/dashboard/photos/${id}` };
                let eligible = true;
                try { validateSlideshowPhoto(photo); } catch { eligible = false; counters.filenameExcluded++; }
                counters.supported++; if (eligible) counters.eligible++;
                tokens.set(id, candidate); records.push({ photo, eligible, size: metadata.size, id });
              } catch (failure) {
                if (['ENOENT', 'ENOTDIR'].includes(failure.code)) counters.raceExcluded++;
                else if (['EACCES', 'EPERM'].includes(failure.code)) counters.permissionExcluded++;
                else if (failure.code === 'ELOOP' && (await fs.lstat(stablePath)).isSymbolicLink()) counters.fileExcluded++;
                else throw failure;
              } finally { await fileHandle?.close(); }
            } else if (entry.isSymbolicLink()) counters.fileExcluded++;
          }
        } finally { await directoryHandle?.close(); stagingBytes -= directory.bytes; }
      }
      const sorted = await sortPhotoRecords(records, checkpoint); const photos = []; const legacy = []; const local = []; let legacyBytes = 0;
      const hash = createHash('sha256');
      for (const record of sorted) {
        await checkpoint();
        hash.update(JSON.stringify([record.photo, record.size]));
        if (record.eligible) { photos.push(record.photo); if (local.length < 100) local.push(record.photo); }
        if (legacy.length < 100 && legacyBytes + record.size <= LEGACY_BYTES) { legacy.push(record.photo); legacyBytes += record.size; }
      }
      await checkpoint();
      const revision = hash.digest('hex');
      if (active?.revision === revision) active.counts = counters;
      else {
        if (active) retired.push({ generation: active, expires: now() + graceMs });
        active = { photos, legacy, local, tokens, counts: counters, revision, bytes: stagingBytes };
      }
      error = null;
      return inventory();
    } catch (failure) {
      if (!stopped) error = failure.code === 'PHOTO_BUDGET' ? 'resource-limit' : 'scan-failed';
      return unavailable();
    } finally { stagingBytes = 0; loading = false; expire(); }
  }
  function refresh() {
    if (!enabled || stopped) return Promise.resolve(unavailable());
    if (!scanPromise) scanPromise = scan().finally(() => { scanPromise = undefined; });
    return scanPromise;
  }
  async function open(id) {
    if (stopped || !/^[A-Za-z0-9_-]{16,128}$/.test(id) || activeStreams >= 8) return null;
    expire();
    const candidate = active?.tokens.get(id) ?? retired.map(item => item.generation.tokens.get(id)).find(Boolean);
    if (!candidate) return null;
    activeStreams++;
    let released = false;
    const release = () => { if (!released) { released = true; activeStreams--; } };
    let handle;
    try {
      await noSymlinks(candidate.root, candidate.relative);
      handle = await fs.open(path.join(candidate.root, candidate.relative), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const resolved = await fs.realpath(`/proc/self/fd/${handle.fd}`);
      if (!inside(candidate.root, resolved)) { await handle.close(); release(); return null; }
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_FILE_BYTES || TYPES.get(path.extname(resolved).toLowerCase()) !== candidate.mime) { await handle.close(); release(); return null; }
      const stream = handle.createReadStream({ autoClose: true, start: 0, end: metadata.size - 1 });
      stream.once('close', release);
      return { stream, mime: candidate.mime, size: metadata.size };
    } catch { try { await handle?.close(); } catch {} release(); return null; }
  }
  return {
    refresh, inventory, status, open,
    list: async () => active ? { available: true, photos: active.legacy } : unavailable(),
    local: async () => active ? { available: true, photos: active.local } : unavailable(),
    stop() {
      if (!stopPromise) {
        stopped = true; cancel(expiryTimer);
        stopPromise = Promise.resolve(scanPromise).then(() => { active = undefined; retired = []; });
      }
      return stopPromise;
    }
  };
}

export function createUnavailablePhotoLibrary() {
  const stopped = Promise.resolve();
  return {
    list: async () => unavailable(), local: async () => unavailable(), refresh: async () => unavailable(), inventory: unavailable, open: async () => null,
    status: () => ({ version: 1, enabled: false, available: false, loading: false, complete: false, stale: false, error: null, counts: null, progress: 0 }),
    stop: () => stopped
  };
}
