import test from 'node:test';
import { temporaryPrefix } from '../scripts/temporary.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertTerminalOutcome } from './fixtures/terminal-outcome.js';

const execute = promisify(execFile);
const driver = path.resolve(import.meta.dirname, 'fixtures/terminal-shutdown.py');
function successful() {
  return {
    result: { sentCtrlC: true, code: -2, exitCode: null, signal: 2, drained: true, timedOut: false, reaped: true, output: 'fixture-pid:101\nfixture-pid:102\n' },
    records: [
      { pid: 101, role: 'dev.js', fallback: false, exitCode: 0 },
      { pid: 102, role: 'server.js', fallback: false, exitCode: 0, stopped: { code: 0, cleanupSafe: true, forced: false, failure: null } }
    ]
  };
}

test('npm SIGINT is accepted only with independent successful development cleanup', () => {
  const { result, records } = successful();
  assert.equal(assertTerminalOutcome('npm', result, records), 'npm-sigint');
  assert.throws(() => assertTerminalOutcome('development', result, records), /AssertionError/);
  const normal = { ...result, code: 0, exitCode: 0, signal: null };
  assert.equal(assertTerminalOutcome('development', normal, records), 'normal');
  assert.equal(assertTerminalOutcome('npm', normal, records), 'normal');
});

const invalid = {
  'no intentional Ctrl+C': data => { data.result.sentCtrlC = false; },
  'unrelated wrapper signal': data => { data.result.signal = 15; data.result.code = -15; },
  'unproven conventional numeric exit': data => { data.result.signal = null; data.result.code = 130; data.result.exitCode = 130; },
  'deadline expiry': data => { data.result.timedOut = true; },
  'incomplete output': data => { data.result.drained = false; },
  'unreaped wrapper': data => { data.result.reaped = false; },
  'missing process record': data => { data.records.pop(); },
  'missing PID evidence': data => { data.result.output = ''; },
  'unexpected replacement supervisor': data => { data.records.push({ ...data.records[0], pid: 103 }); },
  'missing supervisor exit': data => { data.records[0].exitCode = null; },
  'failed supervisor': data => { data.records[0].exitCode = 1; },
  'failed server exit': data => { data.records[1].exitCode = 1; },
  'missing lifecycle result': data => { delete data.records[1].stopped; },
  'unsafe cleanup': data => { data.records[1].stopped.cleanupSafe = false; },
  'forced cleanup': data => { data.records[1].stopped.forced = true; },
  'application failure under wrapper SIGINT': data => { data.records[1].stopped.code = 1; data.records[1].stopped.failure = 'application'; },
  'fallback stopped an application': data => { data.records[0].fallback = true; },
  'native crash': data => { data.result.output += 'Assertion failed'; },
  'unclassified permission error': data => { data.result.output += 'EACCES'; }
};
for (const [scenario, change] of Object.entries(invalid)) test(`terminal outcome rejects ${scenario}`, () => {
  const data = successful(); change(data);
  assert.throws(() => assertTerminalOutcome('npm', data.result, data.records), /AssertionError/, scenario);
});

test('npm kill EACCES remains an explicit limitation requiring safe application cleanup', () => {
  const { result, records } = successful(); result.output += 'npm error Error: kill EACCES';
  assert.equal(assertTerminalOutcome('npm', result, records), 'permission-limited');
  assert.throws(() => assertTerminalOutcome('npm', { ...result, signal: 15, code: -15 }, records), /AssertionError/);
  records[1].stopped.cleanupSafe = false;
  assert.throws(() => assertTerminalOutcome('npm', result, records), /AssertionError/);
});

async function runDriver(t, source, options = {}, wrapper) {
  const root = await mkdtemp(temporaryPrefix('terminal-driver-'));
  let safe = false;
  t.after(async () => { assert.equal(safe, true, `Owned process exit unconfirmed; retained ${root}.`); await rm(root, { recursive: true, force: true }); });
  const settings = { cwd: root, environment: { PATH: process.env.PATH }, command: ['python3', '-c', source], sendCtrlC: false, timeoutMs: 2500, ...options };
  const args = wrapper ? ['-c', wrapper, driver, JSON.stringify(settings)] : [driver, JSON.stringify(settings)];
  const { stdout } = await execute('python3', args, { timeout: 10000, maxBuffer: 128000 });
  const result = JSON.parse(stdout);
  assert.equal(result.reaped, true, stdout);
  await assert.rejects(stat(`/proc/${result.pid}`), { code: 'ENOENT' });
  safe = true;
  return result;
}

test('PTY driver reports normal exit separately from a terminating signal', async t => {
  const result = await runDriver(t, "print('ordinary exit', flush=True)");
  assert.equal(result.code, 0); assert.equal(result.exitCode, 0); assert.equal(result.signal, null);
  assert.equal(result.drained, true); assert.equal(result.timedOut, false); assert.equal(result.sentCtrlC, false);
  assert.match(result.output, /ordinary exit/);
});

test('PTY driver sends real Ctrl+C after readiness and captures cooperative completion', async t => {
  const source = "import signal,time,sys\nsignal.signal(signal.SIGINT, lambda *_: sys.exit(0))\nprint('dashboard listening at fixture', flush=True)\ntime.sleep(1)\nsys.exit(1)";
  const result = await runDriver(t, source, { sendCtrlC: true });
  assert.equal(result.sentCtrlC, true); assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.equal(result.drained, true); assert.equal(result.timedOut, false);
});

test('PTY driver preserves SIGINT termination instead of converting it to exit zero', async t => {
  const source = "import signal,time\nsignal.signal(signal.SIGINT, signal.SIG_DFL)\nprint('dashboard listening at fixture', flush=True)\ntime.sleep(1)";
  const result = await runDriver(t, source, { sendCtrlC: true });
  assert.equal(result.sentCtrlC, true); assert.equal(result.code, -2); assert.equal(result.exitCode, null);
  assert.equal(result.signal, 2); assert.equal(result.drained, true); assert.equal(result.timedOut, false);
});

test('PTY driver drains late descendant output after the immediate wrapper exits', async t => {
  // This test-only outer owner adopts/reaps the short-lived orphan, not PID 1.
  const wrapper = `import ctypes,json,os,subprocess,sys
assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0
run = subprocess.run([sys.executable, sys.argv[1], sys.argv[2]], capture_output=True, text=True, timeout=8)
assert run.returncode == 0, run.stderr
pid, status = os.waitpid(-1, 0)
assert os.waitstatus_to_exitcode(status) == 0
print(run.stdout, end='')`;
  const source = `import os,signal,time
read,write = os.pipe()
pid = os.fork()
if pid == 0:
  os.close(read)
  signal.signal(signal.SIGHUP, signal.SIG_IGN)
  os.write(write,b'ready')
  os.close(write)
  time.sleep(0.15)
  print('late descendant completed', flush=True)
  os._exit(0)
os.close(write)
os.read(read,5)
os.close(read)
os._exit(0)`;
  const result = await runDriver(t, source, {}, wrapper);
  assert.equal(result.code, 0); assert.equal(result.drained, true); assert.equal(result.timedOut, false);
  assert.match(result.output, /late descendant completed/);
});

test('PTY deadline stays a failure even when its owned command subsequently exits', async t => {
  const result = await runDriver(t, 'import signal,time\nsignal.signal(signal.SIGHUP, signal.SIG_IGN)\ntime.sleep(0.4)', { timeoutMs: 200 });
  assert.equal(result.timedOut, true); assert.equal(result.drained, false); assert.equal(result.reaped, true);
});
