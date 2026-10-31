import { expect, test } from '@playwright/test';

test('NXT-1 NXT-6 NXT-7: the showcase runs in the next style on both presets with a frame-time readout, and classic stays the default', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=showcase&seed=1&gfx=next');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const readout = page.locator('#frametime');
  await expect(readout).toContainText('gfx next');
  await expect(readout).toContainText(/\d+ fps · avg [\d.]+ ms · worst [\d.]+ ms/);
  expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(30_000);
  await page.keyboard.press('F2'); // low preset
  await page.waitForTimeout(1500);
  expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(30_000);

  await page.goto('/?faction=human&scenario=showcase&seed=1');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#frametime')).toContainText('gfx classic');
  expect(errors).toEqual([]);
});
