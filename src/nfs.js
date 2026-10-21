import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const SAFE_OPTIONS = ['ro', 'nosuid', 'nodev', 'noexec', 'soft', 'timeo=20', 'retrans=2'];
const REQUIRED_OPTIONS = ['ro', 'nosuid', 'nodev', 'noexec', 'soft'];

function mountPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, digits) => String.fromCharCode(Number.parseInt(digits, 8)));
}

export function parseMountInfo(content) {
  const mounts = [];
  for (const line of String(content).split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const before = line.slice(0, separator).split(' ');
    const after = line.slice(separator + 3).split(' ');
    if (before.length < 5 || after.length < 2) continue;
    mounts.push({ path: mountPath(before[4]), type: after[0], source: mountPath(after[1]), options: [...new Set(`${before[5] ?? ''},${after[2] ?? ''}`.split(',').filter(Boolean))] });
  }
  return mounts;
}

async function defaultMounts() {
  return parseMountInfo(await readFile('/proc/self/mountinfo', 'utf8'));
}

async function readableDirectory(directory, statImpl = stat) {
  const value = await statImpl(directory);
  if (!value.isDirectory()) throw new Error('not a directory');
}

function safelyMounted(entry, requireNfs) {
  if (!entry || (requireNfs && !['nfs', 'nfs4'].includes(entry.type))) return false;
  const options = new Set(entry.options ?? []);
  const timeo = Number.parseInt([...options].find((value) => value.startsWith('timeo='))?.slice(6), 10);
  const retrans = Number.parseInt([...options].find((value) => value.startsWith('retrans='))?.slice(8), 10);
  return REQUIRED_OPTIONS.every((value) => options.has(value)) && Number.isInteger(timeo) && timeo <= 50 && Number.isInteger(retrans) && retrans <= 2;
}

export async function prepareNfs(config, { mounts = defaultMounts, mkdirImpl = mkdir, statImpl = stat, run = execFile, onChild = () => {} } = {}) {
  if (!config || config.mode === 'off') return { available: false, reason: 'disabled', root: null };
  if (config.error) return { available: false, reason: 'configuration', root: null };
  try {
    if (!config.source) {
      const mounted = (await mounts()).find((entry) => entry.path === config.mountPath);
      if (!safelyMounted(mounted, false)) throw new Error('unsafe existing mount');
      await readableDirectory(config.mountPath, statImpl);
      return { available: true, reason: 'existing', root: config.mountPath };
    }
    const current = await mounts();
    const occupied = current.find((entry) => entry.path === config.mountPath);
    if (occupied) {
      if (!safelyMounted(occupied, true) || occupied.source !== config.source) throw new Error('mount point conflict');
      return { available: true, reason: 'mounted', root: config.mountPath };
    }
    await mkdirImpl(config.mountPath, { recursive: true });
    const options = [...new Set([...config.options, ...SAFE_OPTIONS])].join(',');
    const preparation = run('mount', ['-t', 'nfs', '-o', options, config.source, config.mountPath], { timeout: 5_000, maxBuffer: 8_192, windowsHide: true });
    onChild(preparation.child);
    await preparation;
    const mounted = (await mounts()).find((entry) => entry.path === config.mountPath);
    if (!safelyMounted(mounted, true) || mounted.source !== config.source) throw new Error('mount verification failed');
    return { available: true, reason: 'mounted', root: config.mountPath };
  } catch {
    return { available: false, reason: 'failed', root: null };
  }
}
