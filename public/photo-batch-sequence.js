import { slideshowBytes } from './photo-slideshow-data.js';

// This owner stores filenames only. Metadata is always resolved against the active inventory.
export function createPhotoBatchSequence({ random = Math.random, yieldWork = async () => {}, schedule = setTimeout, cancel = clearTimeout, onChange = () => {}, interval = 5, order = 'random', maxEntries = 32, maxBytes = 65536 } = {}) {
  let inventory = new Map(); let visited = new Set(); let remaining = []; let batch = []; let queued = [];
  let last; let job; let retry; let stopped = false; let generation = 0; let requested = false; let bootstrap = true; let bootstrapCommitted = 0;
  const target = () => Math.max(1, Math.min(maxEntries, Math.ceil(30 / interval)));
  function rebuild() {
    const reserved = new Set([...batch, ...queued]);
    remaining = [...inventory.keys()].filter(name => !visited.has(name) && !reserved.has(name));
    if (order !== 'random') remaining.sort((a, b) => (order === 'date' ? inventory.get(b).lastModified - inventory.get(a).lastModified : 0) || b.localeCompare(a));
  }
  function draw() {
    let index = order === 'random' ? Math.min(remaining.length - 1, Math.floor(random() * remaining.length)) : remaining.length - 1;
    if (order === 'random' && !visited.size && !batch.length && !queued.length && remaining.length > 1 && remaining[index] === last) index = (index + 1) % remaining.length;
    const name = remaining[index];
    if (order === 'random') { remaining[index] = remaining.at(-1); remaining.pop(); } else remaining.splice(index, 1);
    return name;
  }
  function bytes() { return [...batch, ...queued].reduce((sum, name) => sum + slideshowBytes(inventory.get(name)), 0); }
  function fillRows(rows, limit = target()) {
    let used = bytes();
    while (remaining.length && rows.length < limit) {
      const name = draw();
      const size = slideshowBytes(inventory.get(name));
      if (used + size > maxBytes) { remaining.push(name); break; }
      rows.push(name); used += size;
    }
  }
  function prepare() {
    if (job) { requested = true; return job; }
    if (stopped || retry || !inventory.size) return job;
    requested = false;
    const epoch = generation;
    job = Promise.resolve().then(() => { if (!stopped && epoch === generation) return yieldWork(); }).then(() => {
      if (stopped || epoch !== generation) return;
      if (visited.size === inventory.size && !batch.length && !queued.length) { visited.clear(); rebuild(); }
      if (!batch.length) { batch = queued; queued = []; if (!batch.length) bootstrap = true; }
      if (bootstrap) { fillRows(batch, Math.max(0, target() - bootstrapCommitted)); bootstrap = false; bootstrapCommitted = 0; }
      fillRows(queued); onChange();
    }).catch(() => {
      if (!stopped && epoch === generation) retry = schedule(() => { retry = undefined; void prepare(); }, 5000);
    }).finally(() => { job = undefined; if (!stopped && (requested || epoch !== generation)) void prepare(); });
    return job;
  }
  return {
    reconcile(records) {
      inventory = new Map(records.map(photo => [photo.name, photo]));
      visited = new Set([...visited].filter(name => inventory.has(name)));
      batch = batch.filter(name => inventory.has(name)); queued = queued.filter(name => inventory.has(name));
      while (bytes() > maxBytes && (queued.length || batch.length)) { if (queued.length) queued.pop(); else batch.pop(); }
      rebuild(); onChange(); void prepare();
    },
    configure(next) {
      interval = next.interval;
      if (order !== next.order) { order = next.order; generation++; cancel(retry); retry = undefined; visited.clear(); batch = []; queued = []; bootstrap = true; bootstrapCommitted = 0; rebuild(); }
      void prepare();
    },
    commit({ replacement = false } = {}) {
      if (stopped || !inventory.size) return null;
      if (!batch.length) { batch = queued; queued = []; }
      // Bootstrap and replacement of a deleted current file cannot publish an empty selection.
      if (replacement && !batch.length && visited.size === inventory.size) { visited.clear(); rebuild(); bootstrap = true; }
      if (!batch.length && (!visited.size || replacement) && remaining.length) { batch.push(draw()); if (bootstrap) bootstrapCommitted++; }
      const name = batch.shift();
      if (!name) { void prepare(); return null; }
      visited.add(name); last = name; void prepare(); onChange();
      return inventory.get(name);
    },
    peek() { const name = batch[0] ?? queued[0]; return name ? inventory.get(name) ?? null : null; },
    get(name) { return inventory.get(name) ?? null; },
    stats() { return { current: batch.length, queued: queued.length, remaining: remaining.length, visited: visited.size, bytes: bytes(), target: target(), filling: Boolean(job) }; },
    prepare,
    stop() { stopped = true; generation++; cancel(retry); inventory.clear(); visited.clear(); remaining = []; batch = []; queued = []; return Promise.resolve(job).then(() => {}); }
  };
}
