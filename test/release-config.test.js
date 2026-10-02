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
  assert.doesNotMatch(dockerfile, /npm (?:ci|install)/);
  assert.deepEqual(dockerignore.trim().split('\n'), ['*', '!Dockerfile', '!.dockerignore', '!package.json', '!package-lock.json', '!src/', '!src/**', '!public/', '!public/**']);
});

test('Compose deploys the Forgejo image as root with data, trust, and optional NFS mounts', () => {
  const compose = read('docker-compose.yml');
  assert.match(compose, /^    image: \$\{HOME_WEB_IMAGE:-git\.lan\/dev\/home-web:latest\}$/m);
  assert.match(compose, /^    network_mode: host$/m);
  assert.match(compose, /^      - \.\/data:\/app\/data$/m);
  assert.match(compose, /^      - \.\/certs:\/app\/certs:ro$/m);
  assert.match(compose, /^      NFS_MOUNT_MODE: \$\{NFS_MOUNT_MODE:-disabled\}$/m);
  assert.match(compose, /^      NFS_MOUNT_PATH: \/photos$/m);
  assert.match(compose, /^      - \$\{NFS_HOST_MOUNT_PATH:-\.\/photos\}:\/photos:ro$/m);
  assert.doesNotMatch(compose, /^    user:/m);
  assert.doesNotMatch(compose, /^    (?:working_dir|command):/m);
  assert.doesNotMatch(compose, /\.\/:\/app/);
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
