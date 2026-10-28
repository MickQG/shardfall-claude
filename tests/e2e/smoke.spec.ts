import { expect, test, type Page } from '@playwright/test';

interface Hook {
  snapshot: () => { tick: number; fog: number[] | null; units: { id: number; owner: number; x: number; y: number }[] } | null;
  selected: () => number[];
  screenPos: (id: number) => { x: number; y: number } | null;
}
declare global {
  interface Window {
    __shardfall: Hook;
  }
}

async function ready(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
}

test('FND-8: app renders a non-blank isometric map canvas and exposes a PWA manifest', async ({ page, request }) => {
  await ready(page);
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const shot = await canvas.screenshot();
  expect(shot.length).toBeGreaterThan(2000);

  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe('Shardfall');
});

test('HST-1: the simulation runs in a worker and keeps ticking', async ({ page }) => {
  await ready(page);
  const a = await page.evaluate(() => window.__shardfall.snapshot()!.tick);
  await page.waitForTimeout(600);
  const b = await page.evaluate(() => window.__shardfall.snapshot()!.tick);
  expect(b).toBeGreaterThan(a);
});

test('CTL-5 SIM-2: click selects a unit and a right-click moves only the selection', async ({ page }) => {
  await ready(page);
  const box = (await page.locator('canvas').first().boundingBox())!;
  const own = await page.evaluate(() => window.__shardfall.snapshot()!.units.filter((u) => u.owner === 0).map((u) => u.id));
  const [a, b] = [own[0]!, own[1]!];
  const p = await page.evaluate((id) => window.__shardfall.screenPos(id), a);
  expect(p).not.toBeNull();

  await page.mouse.click(box.x + p!.x, box.y + p!.y);
  expect(await page.evaluate(() => window.__shardfall.selected())).toEqual([a]);

  const read = (): Promise<{ id: number; x: number; y: number }[]> => page.evaluate(() => window.__shardfall.snapshot()!.units.map((u) => ({ id: u.id, x: u.x, y: u.y })));
  const before = await read();
  await page.mouse.click(box.x + box.width / 2 + 160, box.y + box.height / 2 + 60, { button: 'right' });
  await page.waitForTimeout(1500);
  const after = await read();
  const moved = (id: number): number => {
    const s = before.find((u) => u.id === id)!;
    const e = after.find((u) => u.id === id)!;
    return Math.hypot(e.x - s.x, e.y - s.y);
  };
  expect(moved(a)).toBeGreaterThan(256);
  expect(moved(b)).toBeLessThan(40); // the unselected unit never travels
});

test('FOG-1: the player view starts mostly hidden', async ({ page }) => {
  await ready(page);
  const frac = await page.evaluate(() => {
    const f = window.__shardfall.snapshot()!.fog!;
    return f.filter((v) => v !== 0).length / f.length;
  });
  expect(frac).toBeGreaterThan(0);
  expect(frac).toBeLessThan(0.25);
});

test('MAP-1: exactly one minimap is drawn and clicking it recentres the camera', async ({ page }) => {
  await ready(page);
  await page.waitForTimeout(500);
  const mm = page.locator('#minimap-box canvas');
  await expect(mm).toHaveCount(1);
  const box = (await mm.boundingBox())!;
  const before = await page.evaluate(() => (window.__shardfall as unknown as { camera: () => { x: number; y: number } }).camera());
  await page.mouse.click(box.x + box.width * 0.75, box.y + box.height * 0.5);
  const after = await page.evaluate(() => (window.__shardfall as unknown as { camera: () => { x: number; y: number } }).camera());
  expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(100);
});
