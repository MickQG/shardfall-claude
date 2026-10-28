import { expect, test } from '@playwright/test';

type Hook = { snapshot: () => { tick: number } | null; setSpeed: (v: number) => void };
test('UX-1 UX-2 VIS-3: pause stops the game, and finishing the enemy base shows the victory screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=rush');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const frame = await page.locator('canvas').first().screenshot();
  expect(frame.length).toBeGreaterThan(30_000); // a rich, detailed frame, not a flat one

  await page.keyboard.press('p');
  await expect(page.locator('#pause')).toBeVisible();
  const t0 = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick)).toBe(t0);
  await page.locator('#resume').click();
  await expect(page.locator('#pause')).toBeHidden();

  await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.setSpeed(8));
  await expect(page.locator('#result h1')).toHaveText('VICTORY', { timeout: 60_000 });
  await expect(page.locator('#result #again')).toBeVisible();
  expect(errors).toEqual([]);
});
