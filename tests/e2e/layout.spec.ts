import { expect, test } from '@playwright/test';

type Hook = { snapshot: () => { units: { id: number; owner: number; kind: string }[] } | null; screenPos: (id: number) => { x: number; y: number } | null; selected: () => number[] };

test('UI-10: on an ultrawide screen the game frame stays 16:9 and centred, with the console beside the view', async ({ page }) => {
  await page.setViewportSize({ width: 2560, height: 720 });
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const frame = (await page.locator('canvas').first().boundingBox())!;
  expect(Math.abs(frame.width - 1280)).toBeLessThan(2);
  expect(Math.abs(frame.x - 640)).toBeLessThan(2);
  const console = (await page.locator('#sidebar').boundingBox())!;
  expect(console.x + console.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  expect(console.x).toBeGreaterThan(frame.x + frame.width / 2);
  // Clicking a unit inside the centred frame still selects it.
  const id = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.units.find((u) => u.owner === 0 && u.kind === 'hum_rifleman')!.id);
  const p = (await page.evaluate((u) => (window as unknown as { __shardfall: Hook }).__shardfall.screenPos(u), id))!;
  await page.mouse.click(frame.x + p.x, frame.y + p.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.selected())).toEqual([id]);
});
