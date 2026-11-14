import { defineConfig } from '@playwright/test';

const external = process.env.E2E_BASE_URL;
const PORT = 4179;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  // Shards split by test rather than by file, so CI's shards finish together (#107).
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: external ?? `http://localhost:${PORT}`,
    // Muted: test browsers never play the game's sound on the machine running them (Web Audio itself still runs).
    launchOptions: { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] },
  },
  // Always build and serve fresh output on a dedicated port so a stray server can never test stale files.
  webServer: external ? undefined : { command: `npm run build && npm run preview -- --port ${PORT} --strictPort`, url: `http://localhost:${PORT}`, reuseExistingServer: false, timeout: 180_000 },
});
