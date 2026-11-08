import { defineConfig } from 'vitest/config';

/**
 * Full AI-vs-AI match tests (#107): `npm run test:matches`, or one file with `npm run test:matches -- <name>`. Kept out
 * of `npm test` so the fast unit tests stay fast; CI runs these in parallel jobs when the simulation, AI or data change.
 */
export default defineConfig({
  // Each match is a long, CPU-bound simulation: locally run at most 3 at once so the machine stays usable (CI keeps the default).
  test: { include: ['tests/matches/**/*.test.ts'], testTimeout: 900_000, ...(process.env.CI ? {} : { maxWorkers: 3 }) },
});
