import { randomBytes } from 'node:crypto';

export function createCollectionSelectionStore({ capacity = 1_000, now = Date.now, generateToken = () => randomBytes(24).toString('base64url') } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Collection selection capacity must be a positive integer.');
  const selections = new Map();

  const prune = () => {
    const current = now();
    for (const [token, selection] of selections) if (selection.expiresAt <= current) selections.delete(token);
  };

  return {
    issue(selection) {
      prune();
      while (selections.size >= capacity) selections.delete(selections.keys().next().value);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const token = generateToken();
        if (selections.has(token)) continue;
        selections.set(token, selection);
        return token;
      }
      throw new Error('Unable to create a unique collection selection token.');
    },
    resolve(token, fingerprint) {
      const selection = selections.get(token);
      if (!selection) return undefined;
      if (selection.expiresAt <= now()) { selections.delete(token); return undefined; }
      return selection.fingerprint === fingerprint ? selection : undefined;
    },
    clear() { selections.clear(); },
    get size() { return selections.size; }
  };
}
