import assert from 'node:assert/strict';

export function assertTerminalOutcome(mode, result, records) {
  const detail = JSON.stringify({ mode, result, records });
  assert.equal(result.sentCtrlC, true, detail);
  assert.equal(result.timedOut, false, detail);
  assert.equal(result.drained, true, detail);
  assert.equal(result.reaped, true, detail);
  assert.doesNotMatch(result.output, /Assertion failed|Segmentation fault|core dumped/, detail);
  const pids = [...result.output.matchAll(/fixture-pid:(\d+)/g)].map(match => Number(match[1]));
  assert.ok(pids.length >= 2 && pids.every(pid => records.some(record => record.pid === pid)), detail);
  assert.ok(records.every(record => record.fallback === false), detail);
  for (const role of ['dev.js', 'server.js']) {
    const matching = records.filter(record => record.role === role);
    assert.equal(matching.length, 1, detail);
    assert.equal(matching[0].exitCode, 0, detail);
  }
  const server = records.find(record => record.role === 'server.js');
  assert.deepEqual(server.stopped, { code: 0, cleanupSafe: true, forced: false, failure: null }, detail);
  if (mode === 'npm' && result.output.includes('kill EACCES')) {
    const failed = result.code === 1 && result.exitCode === 1 && result.signal === null;
    const interrupted = result.code === -2 && result.exitCode === null && result.signal === 2;
    assert.ok(failed || interrupted, detail);
    return 'permission-limited';
  }
  assert.doesNotMatch(result.output, /EACCES/, detail);
  if (mode === 'npm' && result.signal === 2) {
    assert.equal(result.code, -2, detail);
    assert.equal(result.exitCode, null, detail);
    return 'npm-sigint';
  }
  assert.equal(result.code, 0, detail);
  assert.equal(result.exitCode, 0, detail);
  assert.equal(result.signal, null, detail);
  return 'normal';
}
