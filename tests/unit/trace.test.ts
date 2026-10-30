import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { duplicateIds, untested } from '../../scripts/traceLib';

function fixture(spec: string, test: string): { specs: string; tests: string } {
  const root = mkdtempSync(join(tmpdir(), 'trace-'));
  mkdirSync(join(root, 'specs'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'specs', 'a.md'), spec);
  writeFileSync(join(root, 'tests', 'a.test.ts'), test);
  return { specs: join(root, 'specs'), tests: join(root, 'tests') };
}

describe('trace', () => {
  it('FND-6: flags requirements with no citing test and passes when all are cited', () => {
    const spec = '- **ABC-1**: one\n- **ABC-2**: two\n';
    const bad = fixture(spec, "it('ABC-1: covered', () => {});");
    expect(untested(bad.specs, bad.tests)).toEqual(['ABC-2']);
    const good = fixture(spec, "it('ABC-1 ABC-2: covered', () => {});");
    expect(untested(good.specs, good.tests)).toEqual([]);
  });

  it('FND-10: flags an ID defined twice, even across files', () => {
    const f = fixture('- **ABC-1**: one\n- **ABC-2**: two\n', '');
    expect(duplicateIds(f.specs)).toEqual([]);
    writeFileSync(join(f.specs, 'b.md'), '- **ABC-2**: again\n');
    expect(duplicateIds(f.specs)).toEqual(['ABC-2']);
  });
});
