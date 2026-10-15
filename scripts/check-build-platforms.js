import { spawnSync } from 'node:child_process';

const inspection = spawnSync('docker', ['buildx', 'inspect', '--bootstrap'], { encoding: 'utf8', timeout: 120000 });
if (inspection.error || inspection.status !== 0) {
  console.error('Unable to inspect the selected Docker Buildx builder.');
  console.error(inspection.error?.message || inspection.stderr.trim() || inspection.stdout.trim());
  process.exit(1);
}

const lines = inspection.stdout.split(/\r?\n/);
const builder = lines.find(line => /^Name:/.test(line))?.replace(/^Name:\s*/, '').trim() || '(unknown)';
const nodes = [];
let inNodes = false;
let node;
for (const line of lines.map(line => line.trim())) {
  if (line === 'Nodes:') inNodes = true;
  if (!inNodes) continue;
  if (line.startsWith('Name:')) { node = { status: '', platforms: [] }; nodes.push(node); }
  if (node && line.startsWith('Status:')) node.status = line.slice('Status:'.length).trim();
  if (node && line.startsWith('Platforms:')) node.platforms = line.slice('Platforms:'.length).split(',').map(value => value.trim().replace(/\*$/, ''));
}
const platforms = [...new Set(nodes.filter(node => node.status === 'running').flatMap(node => node.platforms).filter(Boolean))];
const required = ['linux/amd64', 'linux/arm64'];
const missing = required.filter(platform => !platforms.some(value => value === platform || value.startsWith(`${platform}/`)));
if (missing.length) {
  console.error(`Buildx builder "${builder}" is missing required release platforms: ${missing.join(', ')}.`);
  console.error(`Advertised platforms on running nodes: ${platforms.join(', ') || '(none; inspect builder status/output)'}.`);
  console.error('Ask the Docker host administrator to configure QEMU/binfmt emulation, or select native AMD64/ARM64 builder nodes.');
  console.error('Verify with: docker buildx inspect --bootstrap');
  process.exit(1);
}
console.log(`Buildx builder "${builder}" advertises required release platforms: ${required.join(', ')}.`);
