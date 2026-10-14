import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
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
    writeFileSync(path.join(directory, '.env'), 'HOST=127.0.0.1\nPORT=4555\nDATABASE_PATH=/host/not-container.db\nHOME_ASSISTANT_CA_FILE=./certs/ha.pem\nNFS_MOUNT_MODE=existing\nNFS_MOUNT_PATH=/host/not-photos\nNFS_HOST_MOUNT_PATH=/fixture/wallpaper\nLINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE=\n');
    const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], { cwd: directory, env: { PATH: process.env.PATH, HOME: directory, HOST: '192.0.2.1' }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    const service = JSON.parse(result.stdout).services.dashboard;
    assert.equal(service.environment.HOST, '127.0.0.1', 'shell does not override a literal env-file application value');
    assert.equal(service.environment.PORT, '4555'); assert.equal(service.environment.DATABASE_PATH, '/app/data/wol.db');
    assert.equal(service.environment.NFS_MOUNT_PATH, '/photos'); assert.equal(service.environment.NFS_MOUNT_MODE, 'existing');
    assert.equal(service.environment.LINKWARDEN_CONFIG_ENCRYPTION_KEY_FILE, '/app/data/linkwarden-config-encryption.key');
    assert.equal(service.environment.HOME_ASSISTANT_CA_FILE, './certs/ha.pem'); assert.equal(Object.hasOwn(service.environment, 'NODE_EXTRA_CA_CERTS'), false);
    assert.ok(service.volumes.some(volume => volume.target === '/photos' && volume.source === '/fixture/wallpaper' && volume.read_only));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('release helpers are executable, strict, and publish only latest last', () => {
  for (const name of ['export_image.sh', 'publish_image_release.sh', 'release.sh']) {
    const relative = `scripts/${name}`;
    assert.ok(statSync(path.join(root, relative)).mode & 0o100, `${relative} must be executable`);
    execFileSync('bash', ['-n', relative], { cwd: root });
    assert.doesNotMatch(read(relative), /(?:--insecure|\bcurl\s+-[^\n]*k\b)/);
  }
  const release = read('scripts/release.sh');
  assert.match(release, /FORGEJO_TOKEN/);
  assert.match(release, /git\.lan\/dev\/home-web/);
  assert.match(release, /release_docker_config=\$\(mktemp -d\)/);
  assert.match(release, /export DOCKER_CONFIG=\$release_docker_config/);
  assert.match(release, /'\{"auths":\{\}\}'/);
  assert.doesNotMatch(release, /cp .*config\.json/);
  assert.ok(release.indexOf('publish_image_release.sh') < release.lastIndexOf('publish_latest'));
  assert.match(release, /--platform linux\/amd64,linux\/arm64/);
  assert.match(release, /--tag "\$registry_image:latest"/);
  assert.match(release, /--push/);
  assert.match(release, /verify_manifest "\$registry_image:latest"/);
  assert.doesNotMatch(release, /\$registry_image:\$release_tag/);
  assert.doesNotMatch(release, /platform_image=/);
  assert.match(release, /require\('\$project_root\/package\.json'\)\.version/);
});

test('release helpers reject unsafe invocation before external operations', () => {
  const malformedExport = spawnSync('bash', ['scripts/export_image.sh', 'latest'], { cwd: root, encoding: 'utf8' });
  assert.equal(malformedExport.status, 2);
  assert.match(malformedExport.stderr, /vMAJOR\.MINOR\.PATCH/);

  const malformedPublish = spawnSync('bash', ['scripts/publish_image_release.sh', 'latest'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORGEJO_TOKEN: '' } });
  assert.equal(malformedPublish.status, 2);
  assert.match(malformedPublish.stderr, /vMAJOR\.MINOR\.PATCH/);

  const missingToken = spawnSync('bash', ['scripts/publish_image_release.sh', 'v0.17.0'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORGEJO_TOKEN: '' } });
  assert.notEqual(missingToken.status, 0);
  assert.match(missingToken.stderr, /FORGEJO_TOKEN/);

  const releaseArgument = spawnSync('bash', ['scripts/release.sh', 'patch'], { cwd: root, encoding: 'utf8', env: { ...process.env, FORGEJO_TOKEN: 'unused' } });
  assert.equal(releaseArgument.status, 2);
  assert.match(releaseArgument.stderr, /Usage:/);
});

test('release refuses a wrong branch and dirty main before contacting Forgejo or Docker', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'home-web-release-'));
  try {
    mkdirSync(path.join(directory, 'scripts'));
    copyFileSync(path.join(root, 'scripts/release.sh'), path.join(directory, 'scripts/release.sh'));
    copyFileSync(path.join(root, 'package.json'), path.join(directory, 'package.json'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: directory, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd: directory });
    execFileSync('git', ['-c', 'user.name=Release Test', '-c', 'user.email=release@example.test', 'commit', '-m', 'fixture'], { cwd: directory, stdio: 'ignore' });
    execFileSync('git', ['switch', '-c', 'feature'], { cwd: directory, stdio: 'ignore' });

    const environment = { ...process.env, FORGEJO_TOKEN: 'unused' };
    const wrongBranch = spawnSync('bash', ['scripts/release.sh'], { cwd: directory, encoding: 'utf8', env: environment });
    assert.equal(wrongBranch.status, 1);
    assert.match(wrongBranch.stderr, /Releases must run from main/);

    execFileSync('git', ['switch', 'main'], { cwd: directory, stdio: 'ignore' });
    writeFileSync(path.join(directory, 'dirty.txt'), 'dirty\n');
    const dirtyMain = spawnSync('bash', ['scripts/release.sh'], { cwd: directory, encoding: 'utf8', env: environment });
    assert.equal(dirtyMain.status, 1);
    assert.match(dirtyMain.stderr, /uncommitted changes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
