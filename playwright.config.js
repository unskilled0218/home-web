import { defineConfig } from '@playwright/test';

const port = 3210;

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  use: { baseURL: `http://127.0.0.1:${port}` },
  webServer: {
    command: 'node src/server.js',
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_PATH: `/tmp/opencode/home-web-playwright-${process.pid}.db` },
    port,
    reuseExistingServer: false
  }
});
