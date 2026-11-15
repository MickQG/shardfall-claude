import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pipeline', () => {
  it('FND-9: CI runs all checks and deploy targets Azure Static Web Apps with PR previews', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const step of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run trace', 'npm run harness', 'npm run test:matches', 'npm run e2e']) {
      expect(ci).toContain(step);
    }
    // The slow parts run in parallel jobs: full matches one job per map or test file, the browser tests in shards; a
    // newer push cancels a superseded run, and one aggregate job is the required check.
    for (const map of ['crossroads', 'riverbed', 'highlands']) expect(ci).toContain(`npm run harness -- 2 ${map}`);
    expect(ci).toContain('shard: [1, 2, 3, 4]');
    expect(ci).toContain('npm run e2e -- --shard=${{ matrix.shard }}/4');
    expect(ci).toContain('cancel-in-progress: true');
    expect(ci).toContain('needs: [checks, changes, matches, e2e]');
    // Full matches run on main, and on a pull request only when it changes what they test (#107).
    expect(ci).toContain("if: needs.changes.outputs.matches == 'true'");
    expect(ci).toMatch(/src\/\(sim\|ai\|data\)/);
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(deploy).toContain('Azure/static-web-apps-deploy@v1');
    expect(deploy).toContain('pull_request');
    expect(deploy).toContain('action: close');
  });

  it('HAR-6: the Balance workflow plays match tests on demand, in shards, with a read-only token and no pasted inputs', () => {
    const wf = readFileSync('.github/workflows/balance.yml', 'utf8').replace(/\r\n/g, '\n');
    // Started by hand only: never a check of a pull request or a push.
    expect(wf).toContain('workflow_dispatch:');
    expect(wf).not.toMatch(/^\s*(pull_request|push|schedule):/m);
    for (const input of ['test:', 'name:', 'shards:', 'vars:']) expect(wf).toContain(input);
    expect(wf).toMatch(/permissions:\n\s+contents: read/);
    expect(wf).not.toContain('write');
    // One job per shard, each told which share to play.
    expect(wf).toContain('shard: ${{ fromJSON(needs.plan.outputs.shards) }}');
    expect(wf).toContain('MATCH_SHARD=${{ matrix.shard }}/$N');
    expect(wf).toContain('npm run test:matches -- "$TEST"');
    // Inputs reach the shell only as environment variables (never pasted into a script), and are validated.
    const withInputs = wf.split('\n').filter((l) => l.includes('${{ inputs.'));
    expect(withInputs.length).toBeGreaterThan(0);
    for (const line of withInputs) expect(line).toMatch(/^\s+(N|TEST|NAME|VARS): \$\{\{ inputs\.\w+ \}\}$/);
    expect(wf).toContain('shards must be 1 to 20');
    expect(wf).toContain('bad variable');
    expect(wf).toContain('bad test name');
  });
});
