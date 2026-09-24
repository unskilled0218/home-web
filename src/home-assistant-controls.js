import { randomBytes } from 'node:crypto';

export function createHomeAssistantControlStore({ capacity = 10_000, now = Date.now, generateToken = () => randomBytes(24).toString('base64url') } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('Home Assistant control capacity must be a positive integer.');
  const controls = new Map();

  const prune = () => {
    const current = now();
    for (const [token, control] of controls) if (control.expiresAt <= current) controls.delete(token);
  };

  return {
    issue(control) {
      prune();
      while (controls.size >= capacity) controls.delete(controls.keys().next().value);
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const token = generateToken();
        if (!/^[A-Za-z0-9_-]{16,128}$/.test(token) || controls.has(token)) continue;
        controls.set(token, control);
        return token;
      }
      throw new Error('Unable to create a unique Home Assistant control token.');
    },
    resolve(token, fingerprint) {
      const control = controls.get(token);
      if (!control) return undefined;
      if (control.expiresAt <= now()) { controls.delete(token); return undefined; }
      return control.fingerprint === fingerprint ? control : undefined;
    },
    clear() { controls.clear(); },
    get size() { return controls.size; }
  };
}
