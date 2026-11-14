import { _electron as electron, expect, test } from '@playwright/test';

// Needs the Electron binary, so it runs only on request: DESKTOP_E2E=1 (SHARDFALL_EXE=<packaged exe> tests a packaged build).
test.skip(!process.env.DESKTOP_E2E, 'desktop smoke test runs with DESKTOP_E2E=1');

interface Hook {
  snapshot: () => { tick: number } | null;
}

test('DSK-4: the desktop app starts, loads the game, runs the simulation and reports no console errors', async () => {
  const exe = process.env.SHARDFALL_EXE;
  // Software rendering, and muted so the test never plays the game's sound on the machine running it.
  const gl = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: gl } : { args: ['desktop/main.cjs', ...gl] }),
    env: { ...process.env, SHARDFALL_QUERY: '?faction=human&scenario=calm&seed=3' },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
    expect(page.url()).toMatch(/^app:\/\/shardfall\//);
    const t0 = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick)).toBeGreaterThan(t0 + 10);
    expect(await page.title()).toContain('Shardfall');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
