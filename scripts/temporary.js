import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function temporaryParent() {
  const selected = process.env.RELEASE_TEMP_PARENT;
  if (selected) {
    if (!path.isAbsolute(selected)) throw new Error('Temporary parent must be absolute');
    for (let item = selected; ; item = path.dirname(item)) {
      if (lstatSync(item).isSymbolicLink()) throw new Error('Temporary parent contains a symlink');
      if (path.dirname(item) === item) break;
    }
    const stat = lstatSync(selected);
    if (!stat.isDirectory() || stat.uid !== process.getuid()) throw new Error('Temporary parent must be an owned directory');
    const root = path.resolve(import.meta.dirname, '..');
    const relative = path.relative(root, realpathSync(selected));
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Temporary parent must be outside project');
    accessSync(selected, constants.W_OK);
    return selected;
  }
  try { accessSync('/tmp/opencode', constants.W_OK); return '/tmp/opencode'; } catch { return os.tmpdir(); }
}

export const temporaryPrefix = name => path.join(temporaryParent(), name);
