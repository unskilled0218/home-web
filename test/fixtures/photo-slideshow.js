import { tick } from './lifecycle.js';

export const photo = (name = 'a.png', extra = {}) => ({ name, lastModified: 1, url: `/api/dashboard/photos/${name.startsWith('b') ? 'b' : 'a'}bcdefghijklmnop`, ...extra });
export const slideshowSnapshot = (extra = {}) => ({ version: 1, instanceId: 'fixture', revision: 1, serverTime: 1_000_000, enabled: true, available: true, loading: false, stale: false, count: 1, current: photo(), nextChangeAt: null, ...(extra.version === 2 ? { queueRevision: 0, next: null } : {}), ...extra });
export const snapshotResponse = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

export function slideshowClock() {
  let time = 1_000_000; let id = 0; const timers = new Map();
  return {
    timers, now: () => time,
    schedule(fn, delay) { timers.set(++id, { fn, due: time + delay }); return id; },
    cancel(key) { timers.delete(key); },
    async advance(ms) {
      const end = time + ms;
      while (true) {
        const entry = [...timers].filter(([, task]) => task.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
        if (!entry) break;
        time = entry[1].due; timers.delete(entry[0]); entry[1].fn(); await tick();
      }
      time = end; await tick();
    },
    async late(ms) { time += ms; const due = [...timers].filter(([, task]) => task.due <= time); for (const [key, task] of due) { timers.delete(key); task.fn(); } await tick(); }
  };
}
