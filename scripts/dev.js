import path from 'node:path';
import { createDevSupervisor } from './dev-supervisor.js';

const supervisor = createDevSupervisor({ root: path.resolve(import.meta.dirname, '..') });
const stop = () => { void supervisor.stop(); };
const message = (value) => { if (value?.type === 'dashboard:shutdown') stop(); };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, stop);
if (process.channel) { process.on('message', message); process.on('disconnect', stop); }
void supervisor.start();
const result = await supervisor.done;
for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
process.removeListener('message', message); process.removeListener('disconnect', stop);
if (process.connected) process.disconnect();
process.exit(result.code);
