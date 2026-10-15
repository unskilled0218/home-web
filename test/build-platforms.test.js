import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const inspection = platforms => `Name: default\nDriver: docker\n\nNodes:\nName: default\nStatus: running\nPlatforms: ${platforms}\n`;

function fixture(t, output = inspection('linux/amd64')) {
  const directory = mkdtempSync('/tmp/opencode/build-platforms-');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}');
  const log = path.join(directory, 'calls.jsonl');
  const fake = `#!${process.execPath}
const fs = require('node:fs');
const name = require('node:path').basename(process.argv[1]);
let args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify({ name, args }) + '\\n');
if (name === 'docker') {
  if (args.join(' ') === 'context show') { console.log('default'); process.exit(0); }
  if (args.join(' ') === 'buildx version') { console.log('fixture buildx'); process.exit(0); }
  if (args.join(' ') === 'buildx inspect --bootstrap') {
    process.stdout.write(process.env.FIXTURE_INSPECTION);
    process.stderr.write(process.env.FIXTURE_ERROR || '');
    process.exit(Number(process.env.FIXTURE_STATUS || 0));
  }
}
if (name === 'git') {
  if (args[0] === '-C') args = args.slice(2);
  if (args.join(' ') === 'branch --show-current') { console.log('main'); process.exit(0); }
  if (args[0] === 'status') process.exit(0);
  if (args.join(' ') === 'rev-parse HEAD') { console.log('fixture-head'); process.exit(0); }
}
console.error('Forbidden fixture operation: ' + name + ' ' + args.join(' '));
process.exit(99);
`;
  for (const name of ['docker', 'git', 'npm', 'curl']) { const file = path.join(bin, name); writeFileSync(file, fake); chmodSync(file, 0o700); }
  const environment = { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: directory, DOCKER_CONFIG: path.join(directory, 'docker-config'), TMPDIR: directory, FORGEJO_TOKEN: 'unused-fixture-token', FIXTURE_LOG: log, FIXTURE_INSPECTION: output };
  delete environment.FIXTURE_STATUS; delete environment.FIXTURE_ERROR;
  return { directory, environment, calls: () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) };
}

function check(fixture) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/check-build-platforms.js')], { env: fixture.environment, encoding: 'utf8', timeout: 10000 });
}

test('platform preflight explains missing ARM64 on an AMD64-only builder', t => {
  const result = check(fixture(t, inspection('linux/amd64, linux/amd64/v2, linux/amd64/v3')));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /builder "default".*missing.*linux\/arm64/);
  assert.match(result.stderr, /Advertised platforms.*linux\/amd64/);
  assert.match(result.stderr, /administrator.*QEMU\/binfmt/);
  assert.match(result.stderr, /docker buildx inspect --bootstrap/);
});

for (const platforms of ['linux/amd64, linux/arm64', 'linux/amd64, linux/arm64/v8', 'linux/amd64*, linux/arm64*']) test(`platform preflight accepts advertised targets: ${platforms}`, t => {
  const result = check(fixture(t, inspection(platforms)));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /advertises required release platforms/);
});

test('platform preflight combines running native nodes', t => {
  const output = inspection('linux/amd64') + 'Name: arm-node\nStatus: running\nPlatforms: linux/arm64\n';
  const result = check(fixture(t, output));
  assert.equal(result.status, 0, result.stderr);
});

for (const output of ['', 'not builder inspection', inspection(''), inspection('linux/arm64'), inspection('linux/amd64') + 'Name: broken-arm\nStatus: error\nPlatforms: linux/arm64\n', inspection('linux/amd64, linux/arm64').replace('Status: running', 'Status: stopped')]) test(`platform preflight fails closed for unavailable platforms: ${JSON.stringify(output)}`, t => {
  const result = check(fixture(t, output));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing required release platforms/);
});

test('platform preflight preserves builder inspection failure detail', t => {
  const f = fixture(t); f.environment.FIXTURE_STATUS = '1'; f.environment.FIXTURE_ERROR = 'fixture: Docker daemon unavailable';
  const result = check(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unable to inspect.*Buildx/);
  assert.match(result.stderr, /Docker daemon unavailable/);
});

for (const [script, args] of [['release.sh', []], ['release.sh', ['--promote-latest']], ['export_image.sh', ['v0.17.16']]]) test(`${script} ${args.join(' ')} refuses missing ARM64 before builds or publishing`, t => {
  const f = fixture(t);
  const scripts = path.join(f.directory, 'scripts'); mkdirSync(scripts);
  for (const name of ['release.sh', 'export_image.sh', 'check-build-platforms.js']) copyFileSync(path.join(root, 'scripts', name), path.join(scripts, name));
  // Keep export's version fixture independent of the project's next patch bump.
  writeFileSync(path.join(f.directory, 'package.json'), JSON.stringify({ version: '0.17.16', type: 'module' }));
  const result = spawnSync('bash', [path.join(scripts, script), ...args], { cwd: f.directory, env: f.environment, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /missing required release platforms: linux\/arm64/);
  const calls = f.calls();
  assert.ok(calls.some(call => call.name === 'docker' && call.args.join(' ') === 'buildx inspect --bootstrap'));
  assert.equal(calls.some(call => ['npm', 'curl'].includes(call.name)), false, 'no tests or publishing before preflight');
  assert.equal(calls.some(call => call.name === 'git' && call.args.some(arg => ['fetch', 'push', 'tag'].includes(arg))), false, 'no remote Git work before preflight');
  assert.equal(calls.some(call => call.name === 'docker' && call.args.some(arg => ['build', 'login', 'run'].includes(arg))), false, 'no build, login, or emulation installation');
  assert.equal(existsSync(path.join(f.directory, 'dist')), false, 'no partial export artifacts');
});
