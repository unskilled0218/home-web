import { EventEmitter } from 'node:events';

export const tick = () => new Promise(setImmediate);
export function deferred() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
export async function within(promise, timeoutMs = 2000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Fixture wait exceeded its deadline.')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}
export function fakeClock() {
  const timers = new Map(); let id = 0;
  return { timers, schedule(fn, ms) { timers.set(++id, { fn, ms }); return id; }, cancel(key) { timers.delete(key); }, fire(ms) { const entry = [...timers].find(([, timer]) => timer.ms === ms); if (!entry) throw new Error(`No ${ms}ms timer`); timers.delete(entry[0]); entry[1].fn(); } };
}
let pid = 10000;
export class FakeChild extends EventEmitter {
  constructor() { super(); this.pid = ++pid; this.connected = true; this.exitCode = null; this.signalCode = null; this.messages = []; this.kills = []; }
  send(message, callback) { this.messages.push(message); callback?.(this.sendError); }
  disconnect() { this.connected = false; this.emit('disconnect'); }
  kill(signal) { this.kills.push(signal); if (this.killDenied) { this.emit('error', Object.assign(new Error('Denied'), { code: 'EACCES' })); return false; } return true; }
  close(code = 0, signal = null) { this.exitCode = code; this.signalCode = signal; this.connected = false; this.emit('exit', code, signal); this.emit('close', code, signal); }
  ready() { this.emit('message', { type: 'dashboard:control-ready' }); this.emit('message', { type: 'dashboard:ready' }); }
  stopped(cleanupSafe = true, failure = null) { this.emit('message', { type: 'dashboard:stopped', cleanupSafe, failure }); }
}
