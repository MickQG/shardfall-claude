import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

describe('lint', () => {
  it('FND-7: non-deterministic APIs are rejected inside src/sim', async () => {
    const eslint = new ESLint();
    const code = 'export const a = Math.random() + Date.now() + performance.now();\n';
    const [res] = await eslint.lintText(code, { filePath: 'src/sim/bad.ts' });
    const msgs = (res?.messages ?? []).map((m) => m.ruleId);
    expect(msgs.filter((r) => r === 'no-restricted-syntax').length).toBeGreaterThanOrEqual(3);

    const [ok] = await eslint.lintText('export const a = 1;\n', { filePath: 'src/sim/ok.ts' });
    expect(ok?.messages ?? []).toEqual([]);
  });
});
