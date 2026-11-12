import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

/** The modules a file loads up front: `import … from`, `export … from` and bare `import '…'`, but not `import type` or `import()`. */
function staticImports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  const re = /^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec);
  for (const p of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(p) && p.endsWith('.ts')) return p;
  return null;
}

/** Every package (non-relative import) reachable from `entry` through static imports only, with one file that reaches it. */
function upFrontPackages(entry: string): Map<string, string> {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of staticImports(file)) {
      const local = resolveLocal(file, spec);
      if (local) walk(local);
      else if (!spec.startsWith('.') && !packages.has(spec)) packages.set(spec, file.slice(ROOT.length + 1));
    }
  };
  walk(join(ROOT, entry));
  return packages;
}

describe('the classic view loads on demand (PERF-6)', () => {
  it('PERF-6: nothing the page loads up front imports the classic view or its graphics library', () => {
    for (const entry of ['src/main.ts', 'src/game.ts']) {
      const packages = upFrontPackages(entry);
      for (const [name, via] of packages) expect(/^pixi/.test(name), `${entry} loads ${name} up front through ${via}`).toBe(false);
    }
  });

  it('PERF-6: the game shell fetches the classic view only when it is chosen, as it does the 3D view', () => {
    const game = readFileSync(join(ROOT, 'src/game.ts'), 'utf8');
    expect(game).toMatch(/await import\('\.\/render\/gameView'\)/);
    expect(game).toMatch(/await import\('\.\/render3d\/view3d'\)/);
    expect(staticImports(join(ROOT, 'src/game.ts'))).not.toContain('./render/gameView');
    // The classic view itself does import the library: the check above is not vacuous.
    expect(staticImports(join(ROOT, 'src/render/gameView.ts')).some((s) => /^pixi/.test(s))).toBe(true);
  });

  it('PERF-6: the menu and the game shell reach three.js only through dynamic imports, so a classic session does not fetch it', () => {
    // The mirror of the rule, which already held: the shell and the menu reach three.js only through dynamic imports.
    for (const entry of ['src/main.ts', 'src/game.ts']) expect([...upFrontPackages(entry).keys()].filter((n) => n === 'three' || n.startsWith('three/'))).toEqual([]);
  });
});
