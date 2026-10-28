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

test('SIM-2 HST-1: the simulation runs in a worker and a right-click move order moves units', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  type Snap = { tick: number; units: { id: number; owner: number; x: number; y: number }[] } | null;
  const read = (): Promise<Snap> => page.evaluate(() => (window as unknown as { __shardfall: { snapshot: () => Snap } }).__shardfall.snapshot());

  const a = await read();
  await page.waitForTimeout(600);
  const b = await read();
  expect(b!.tick).toBeGreaterThan(a!.tick);

  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { button: 'right' });
  await page.waitForTimeout(1500);
  const c = await read();
  const before = b!.units.find((u) => u.owner === 0)!;
  const after = c!.units.find((u) => u.id === before.id)!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(256);
});
