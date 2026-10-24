import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => readFileSync(path.join(root, name), 'utf8');

test('production image contains only runtime files and retains the root user', () => {
  const dockerfile = read('Dockerfile');
  const dockerignore = read('.dockerignore');
  assert.match(dockerfile, /^FROM node:24-bookworm-slim$/m);
  assert.match(dockerfile, /^WORKDIR \/app$/m);
  assert.match(dockerfile, /^COPY src\/ \.\/src\/$/m);
  assert.match(dockerfile, /^COPY public\/ \.\/public\/$/m);
  assert.match(dockerfile, /^CMD \["node", "src\/server\.js"\]$/m);
  assert.doesNotMatch(dockerfile, /^USER\s/m);
  assert.match(dockerfile, /^RUN npm ci --omit=dev --ignore-scripts/m);
  assert.doesNotMatch(dockerfile, /CMD.*npm (?:ci|install)/);
  assert.deepEqual(dockerignore.trim().split('\n'), ['*', '!Dockerfile', '!.dockerignore', '!package.json', '!package-lock.json', '!src/', '!src/**', '!public/', '!public/**']);
});

test('Compose deploys the Forgejo image as root with data, trust, and optional NFS mounts', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /^    image: \$\{HOME_WEB_IMAGE:-git\.lan\/dev\/home-web:latest\}$/m);
  assert.match(compose, /^    network_mode: host$/m);
  assert.match(compose, /^      - \.\/data:\/app\/data$/m);
  assert.match(compose, /^      - \.\/certs:\/app\/certs:ro$/m);
  assert.match(compose, /^    env_file: \.env$/m);
  assert.doesNotMatch(compose, /NODE_EXTRA_CA_CERTS|^      (?:HOST|PORT|HOME_ASSISTANT_CA_FILE|LINKWARDEN_CONFIG_ENCRYPTION_KEY):/m);
  assert.match(compose, /^      NFS_MOUNT_PATH: \/photos$/m);
  assert.match(compose, /^      - \$\{NFS_HOST_MOUNT_PATH:-\.\/photos\}:\/photos:ro$/m);
  assert.doesNotMatch(compose, /^    user:/m);
  assert.doesNotMatch(compose, /^    (?:working_dir|command):/m);
  assert.doesNotMatch(compose, /\.\/:\/app/);
});

test('Compose parser forwards env-file values and preserves fixed container paths without global HA trust', t => {
  const available = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8', timeout: 10000 });
  if (available.error?.code === 'ENOENT' || available.status !== 0) { t.skip('Docker Compose parser unavailable; static wiring checks remain separate.'); return; }
  const directory = mkdtempSync('/tmp/opencode/compose-env-');
  try {
    copyFileSync(path.join(root, 'docker-compose.yml'), path.join(directory, 'docker-compose.yml'));
    writeFileSync(path.join(directory, '.env'), 'HOST=127.0.0.1\nPORT=4555\nDATABASE_PATH=/host/not-container.db\nHOME_ASSISTANT_CA_FILE=./certs/ha.pem\nNFS_MOUNT_MODE=on\nNFS_SOURCE=\nNFS_MOUNT_PATH=/host/not-photos\nNFS_HOST_MOUNT_PATH=/fixture/wallpaper\nLINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=\n');
    const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], { cwd: directory, env: { PATH: process.env.PATH, HOME: directory, HOST: '192.0.2.1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const service = JSON.parse(result.stdout).services.dashboard;
    assert.equal(service.environment.HOST, '127.0.0.1', 'shell does not override a literal env-file application value');
    assert.equal(service.environment.PORT, '4555'); assert.equal(service.environment.DATABASE_PATH, '/app/data/wol.db');
    assert.equal(service.environment.NFS_MOUNT_PATH, '/photos'); assert.equal(service.environment.NFS_MOUNT_MODE, 'on'); assert.equal(service.environment.NFS_SOURCE, '');
    assert.equal(service.environment.LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE, '/app/data/linkwarden-config-encryption.key');
    assert.equal(service.environment.HOME_ASSISTANT_CA_FILE, './certs/ha.pem'); assert.equal(Object.hasOwn(service.environment, 'NODE_EXTRA_CA_CERTS'), false);
    assert.ok(service.volumes.some(volume => volume.target === '/photos' && volume.source === '/fixture/wallpaper' && volume.read_only));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('release scripts retain strict shell boundaries and safe HTTPS defaults', () => {
  for (const name of ['release-common.sh', 'release.sh']) {
    const relative = `scripts/${name}`;
    execFileSync('bash', ['-n', relative], { cwd: root });
    assert.doesNotMatch(read(relative), /(?:--insecure|\bcurl\s+-[^\n]*k\b)/);
  }
  for (const relative of ['scripts/release.sh', 'scripts/release-data.py']) assert.ok(statSync(path.join(root, relative)).mode & 0o100, `${relative} must be executable`);
  const release = read('scripts/release.sh');
  assert.match(release, /--platform linux\/amd64,linux\/arm64/);
  assert.match(release, /--label "org\.opencontainers\.image\.version=\$version"/);
  assert.match(release, /--label "org\.opencontainers\.image\.revision=\$commit"/);
  assert.match(release, /--label "org\.opencontainers\.image\.source=\$origin\/\$repository"/);
  assert.match(read('Dockerfile'), /ARG SOURCE_URL=https:\/\/git\.lan\/dev\/home-web/);
});

test('VERSION owns npm metadata, release notes, and the home-web release target', () => {
  const version = read('VERSION').trim();
  const manifest = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(manifest.version, version, 'package.json version drift');
  assert.equal(lock.version, version, 'lockfile version drift');
  assert.equal(lock.packages[''].version, version, 'lockfile root package version drift');
  const config = JSON.parse(read('scripts/release.json'));
  assert.deepEqual(config, { schema: 1, gitea: 'https://git.lan', repository: 'dev/home-web', image: 'git.lan/dev/home-web', username: 'dev', token_file: '~/.config/git/token', notes: `docs/releases/${version}.md`, platforms: ['linux/amd64', 'linux/arm64'] });
  assert.ok(read(config.notes).startsWith(`# Release v${version}\n`));
  for (const state of ['.template-operation.lock', '.release-template/', '.template-transaction/']) assert.ok(read('.gitignore').split('\n').includes(state), `${state} must be ignored`);
});

test('publication is disabled and legacy CLI options refuse before external effects', () => {
  for (const args of [[], [''], ['--promote-latest'], ['patch'], ['--validate', 'extra']]) {
    const result = spawnSync('/bin/bash', ['scripts/release.sh', ...args], { cwd: root, encoding: 'utf8', env: { PATH: '/missing', GIT_TOKEN: '/missing/token', RELEASE_LOCK_FD: '999', RELEASE_ENABLED: '1' } });
    const blockedPublication = !args.length || args[0] === '';
    assert.equal(result.status, blockedPublication ? 1 : 2);
    if (blockedPublication) assert.match(result.stderr, /Publication disabled/);
  }
});
