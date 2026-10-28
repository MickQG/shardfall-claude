import { expect, test } from '@playwright/test';

test('FND-8: app renders a non-blank isometric map canvas and exposes a PWA manifest', async ({ page, request }) => {
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  const shot = await canvas.screenshot();
  expect(shot.length).toBeGreaterThan(2000);

  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe('Shardfall');
});
