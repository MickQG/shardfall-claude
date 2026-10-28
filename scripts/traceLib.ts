import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQ_DEF = /^\s*-\s+\*\*([A-Z]+-\d+)\*\*/gm;
const REQ_REF = /\b([A-Z]+-\d+)\b/g;

function walk(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** Requirement IDs defined in `specsDir` markdown files. */
export function definedIds(specsDir: string): string[] {
  const ids = new Set<string>();
  for (const f of walk(specsDir, /\.md$/)) {
    for (const m of readFileSync(f, 'utf8').matchAll(REQ_DEF)) ids.add(m[1] as string);
  }
  return [...ids].sort();
}

/** Requirement IDs cited anywhere in test files under `testsDir`. */
export function citedIds(testsDir: string): Set<string> {
  const ids = new Set<string>();
  for (const f of walk(testsDir, /\.(test|spec)\.ts$/)) {
    for (const m of readFileSync(f, 'utf8').matchAll(REQ_REF)) ids.add(m[1] as string);
  }
  return ids;
}

/** IDs defined in specs but never cited by a test. */
export function untested(specsDir: string, testsDir: string): string[] {
  const cited = citedIds(testsDir);
  return definedIds(specsDir).filter((id) => !cited.has(id));
}
