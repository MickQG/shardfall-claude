import { expect, test } from '@playwright/test';

type Hook = { snapshot: () => { tick: number } | null; setSpeed: (v: number) => void };
test('UX-1 UX-2 VIS-3 SCR-3 UI-20: pause stops the game, and finishing the enemy base shows the victory screen', async ({ page }) => {
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

  // SCR-3: the result screen shows both sides' score table and the army graph.
  const score = page.locator('#result .score');
  await expect(score).toContainText('Aegis Union (you)');
  await expect(score).toContainText('Vrax Hive');
  await expect(score).toContainText('Units destroyed');
  await expect(score.locator('polyline')).toHaveCount(2);
  // UI-20: the score screen wears the player's faction skin and the heading typeface.
  await expect(page.locator('#hud')).toHaveAttribute('data-faction', 'human');
  expect(await page.locator('#result h1').evaluate((el) => getComputedStyle(el).fontFamily)).toContain('Bahnschrift');
  expect(await score.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('0px'); // Aegis: angular, no rounding
  await page.screenshot({ path: 'test-results/score-screen.png' });
  expect(errors).toEqual([]);

  // UX-2: the result screen also leads back to the main menu.
  await page.locator('#result #menu-btn').click();
  await expect(page.locator('#menu h1')).toHaveText('SHARDFALL');
});
