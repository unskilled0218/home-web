// Copied into an owned process fixture, never loaded by the application normally.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.TERMINAL_EVIDENCE_DIR) {
  const fields = readFileSync('/proc/self/stat', 'utf8').split(') ').at(-1).split(' ');
  const record = { pid: process.pid, parent: process.ppid, group: Number(fields[2]), session: Number(fields[3]), role: path.basename(process.argv[1] || ''), fallback: false, exitCode: null };
  const file = path.join(process.env.TERMINAL_EVIDENCE_DIR, `${process.pid}.json`);
  const save = () => writeFileSync(file, JSON.stringify(record));
  save(); console.log(`fixture-pid:${process.pid}`);
  if (process.send) {
    const send = process.send;
    process.send = function (...args) {
      const message = args[0];
      if (message?.type === 'dashboard:stopped') {
        record.stopped = Object.fromEntries(['code', 'cleanupSafe', 'forced', 'failure'].map(key => [key, message[key]]));
        save();
      }
      return Reflect.apply(send, this, args);
    };
  }
  const timer = setTimeout(() => {
    record.fallback = true; save();
    if (!process.emit('SIGTERM')) process.exit(1);
  }, 12000);
  process.on('exit', code => { clearTimeout(timer); record.exitCode = code; save(); });
}
