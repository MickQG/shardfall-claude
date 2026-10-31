import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** The website's response headers (Content-Security-Policy and others, SEC-1), as Azure Static Web Apps sends them. */
const headers = (JSON.parse(readFileSync('public/staticwebapp.config.json', 'utf8')) as { globalHeaders: Record<string, string> }).globalHeaders;

export default defineConfig({
  base: './',
  // No source maps in the build: they would publish the full source with the game (SEC-1).
  build: { target: 'es2022', sourcemap: false },
  // The preview (and so every e2e run) serves the build under the same headers as production.
  preview: { headers },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
