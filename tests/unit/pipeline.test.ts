import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pipeline', () => {
  it('FND-9: CI runs all checks and deploy targets Azure Static Web Apps with PR previews', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const step of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run trace', 'npm run harness', 'npm run e2e']) {
      expect(ci).toContain(step);
    }
    // The slow parts run in parallel jobs: the harness one job per map, the browser tests in shards; a newer push
    // cancels a superseded run, and one aggregate job is the required check.
    expect(ci).toContain('map: [crossroads, riverbed, highlands]');
    expect(ci).toContain('shard: [1, 2, 3]');
    expect(ci).toContain('npm run harness -- 2 ${{ matrix.map }}');
    expect(ci).toContain('npm run e2e -- --shard=${{ matrix.shard }}/3');
    expect(ci).toContain('cancel-in-progress: true');
    expect(ci).toContain('needs: [checks, harness, e2e]');
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(deploy).toContain('Azure/static-web-apps-deploy@v1');
    expect(deploy).toContain('pull_request');
    expect(deploy).toContain('action: close');
  });
});
