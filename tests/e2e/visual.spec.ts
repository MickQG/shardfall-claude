import { expect, test } from '@playwright/test';

const SHOTS = process.env.SHARDFALL_SHOTS;

test('GFX-1 GFX-2 GFX-3 GFX-4 GFX-5 GFX-6 GFX-7 GFX-8: a fight renders richly on both quality presets without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The GFX requirements describe the classic view, now behind its switch (R3D-1).
  await page.goto('/?faction=human&scenario=duel&seed=5&renderer=classic');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.keyboard.press('q'); // select the army so brackets and bars show
  await page.waitForTimeout(3500);
  const high = await page.locator('canvas').first().screenshot(SHOTS ? { path: `${SHOTS}/high.png` } : {});
  expect(high.length).toBeGreaterThan(30_000);

  await page.keyboard.press('F2');
  await expect(page.getByText(/Graphics quality: low/)).toBeVisible();
  await page.waitForTimeout(1500);
  const low = await page.locator('canvas').first().screenshot(SHOTS ? { path: `${SHOTS}/low.png` } : {});
  expect(low.length).toBeGreaterThan(30_000);
  expect(errors).toEqual([]);
});
