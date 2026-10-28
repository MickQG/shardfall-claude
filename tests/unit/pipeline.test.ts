import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pipeline', () => {
  it('FND-9: CI runs all checks and deploy targets Azure Static Web Apps with PR previews', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    for (const step of ['npm run lint', 'npm run typecheck', 'npm test', 'npm run trace', 'npm run e2e']) {
      expect(ci).toContain(step);
    }
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    expect(deploy).toContain('Azure/static-web-apps-deploy@v1');
    expect(deploy).toContain('pull_request');
    expect(deploy).toContain('action: close');
  });
});
