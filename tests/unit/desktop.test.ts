import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_ORIGIN, isInternalUrl, resolveAppPath } from '../../desktop/paths.cjs';

const root = path.resolve('some', 'dist');
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  main: string;
  scripts: Record<string, string>;
  build: { win: { target: string[] }; files: string[]; productName: string };
};

describe('desktop shell', () => {
  it('DSK-1: serves files inside the build folder and maps / to the game page', () => {
    expect(resolveAppPath(root, '/')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, '')).toBe(path.join(root, 'index.html'));
    expect(resolveAppPath(root, '/assets/app.js')).toBe(path.join(root, 'assets', 'app.js'));
    expect(resolveAppPath(root, '/sw.js?v=3')).toBe(path.join(root, 'sw.js'));
    expect(resolveAppPath(root, '/a%20b.png')).toBe(path.join(root, 'a b.png'));
  });

  it('DSK-1: rejects paths that would leave the build folder', () => {
    for (const bad of ['/../secret.txt', '/assets/../../secret.txt', '/..%2f..%2fsecret', '/..%5c..%5csecret', '/%2e%2e/secret', '/x\0y', '/%E0%A4%A', String.raw`C:\Windows\win.ini`, String.raw`/C:\Windows\win.ini`, '//evil/share']) {
      expect(resolveAppPath(root, bad), bad).toBeNull();
    }
  });

  it('DSK-3: only the game origin counts as internal; everything else opens in the browser', () => {
    expect(isInternalUrl(`${APP_ORIGIN}/index.html`)).toBe(true);
    expect(isInternalUrl(APP_ORIGIN)).toBe(true);
    expect(isInternalUrl('https://example.com/')).toBe(false);
    expect(isInternalUrl('file:///C:/Windows/win.ini')).toBe(false);
    expect(isInternalUrl(`${APP_ORIGIN}.evil.com/`)).toBe(false);
    expect(isInternalUrl('app://shardfallx/')).toBe(false);
  });
});

describe('desktop packaging', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(path.join(dir, f)).isDirectory() ? walk(path.join(dir, f)) : [path.join(dir, f)]));

  it('DSK-2: nothing in the game source imports the desktop shell, and the web build does not run the packager', () => {
    for (const f of walk('src').filter((p) => p.endsWith('.ts'))) expect(readFileSync(f, 'utf8'), f).not.toMatch(/from ['"]electron|require\(['"]electron/);
    expect(pkg.scripts.build).not.toMatch(/electron/);
    expect(pkg.scripts.build).toMatch(/vite build/);
  });

  it('DSK-5: the build config makes a portable executable and an installer from the built game and the shell only', () => {
    expect(pkg.build.win.target).toEqual(expect.arrayContaining(['portable', 'nsis']));
    expect(pkg.build.files).toEqual(expect.arrayContaining(['dist/**', 'desktop/**']));
    expect(pkg.build.files.some((f) => /^(src|tests|node_modules)/.test(f))).toBe(false);
    expect(pkg.main).toBe('desktop/main.cjs');
    expect(readFileSync('desktop/paths.cjs', 'utf8')).toContain('app://shardfall');
    expect(readFileSync(pkg.main, 'utf8')).toContain('APP_ORIGIN');
    expect(pkg.build.productName).toBe('Shardfall');
  });
});
