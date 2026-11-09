import { expect, test } from '@playwright/test';

type Stats = { fps: number; cpuMs: number; draws: number; tris: number; particles: { smoke: number; glow: number }; debris: number };
type Hook = { renderStats: () => Stats; snapshot: () => { units: unknown[] } | null };

// The software GPU in CI is slow: the brawl needs a long time to produce deaths.
test.describe.configure({ timeout: 240_000 });

test('R3D-26 R3D-27 R3D-29: the 200-unit brawl emits particles and debris within their budgets', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=brawl&seed=1&renderer=3d&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 120_000 });
  await expect(page.locator('#frametime')).toContainText(/renderer 3d · \d+ fps/);
  // The fight is already under way on load (the 200-unit roster itself is checked in the unit tests).
  // Particles are emitted at once (muzzle flashes, impacts); debris needs a death, so poll for it.
  let peak: Stats | null = null;
  let seenParticles = 0;
  let seenDebris = 0;
  await expect
    .poll(
      async () => {
        const s = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.renderStats());
        seenParticles = Math.max(seenParticles, s.particles.smoke + s.particles.glow);
        seenDebris = Math.max(seenDebris, s.debris);
        peak = s;
        return seenParticles > 0 && seenDebris > 0;
      },
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(true);
  expect(peak!.draws).toBeGreaterThan(0);
  // Counts stay inside the High budgets.
  expect(peak!.particles.smoke).toBeLessThanOrEqual(8192);
  expect(peak!.particles.glow).toBeLessThanOrEqual(4096);
  expect(peak!.debris).toBeLessThanOrEqual(96);
  expect(errors).toEqual([]);
});
