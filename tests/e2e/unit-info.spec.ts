import { expect, test } from '@playwright/test';

test('INF-1 INF-2 INF-3 INF-4: the menu info button shows plain-language unit cards for the picked faction', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1')).toHaveText('SHARDFALL');
  const panel = page.locator('#unit-info');
  await expect(panel).toBeHidden();

  await page.locator('#info-btn').click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.u')).toHaveCount(7);
  await expect(panel).toContainText('Aegis Union units');
  await expect(panel.locator('.u', { hasText: 'Rocketeer' })).toContainText('Strong against: Heavy (Gorger, Brute, Lobber, Dreadstrider)');
  await expect(panel.locator('.u', { hasText: 'Shard Hauler' })).toContainText('Cannot attack');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.locator('#menu [data-faction="alien"]').click();
  await page.locator('#info-btn').click();
  await expect(panel).toContainText('Vrax Hive units');
  await expect(panel.locator('.u', { hasText: 'Brute' })).toContainText('Regenerates');
  await panel.locator('[data-close]').click();
  await expect(panel).toBeHidden();
});
