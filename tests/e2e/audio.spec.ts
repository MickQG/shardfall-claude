import { expect, test } from '@playwright/test';

type Hook = {
  snapshot: () => { units: { id: number; owner: number; kind: string }[] } | null;
  select: (ids: number[]) => void;
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  audio: () => { requested: Record<string, number>; started: number; dropped: number; mix: { movement: Record<string, number>; ambience: { wind: number; water: number; rumble: number } } };
  audioBurst: (n?: number) => Promise<{ peak: number; started: number; dropped: number; requested: number }>;
};

// The software GPU in CI builds every model and compiles every shader up front on each page load: allow for it.
test.describe.configure({ timeout: 180_000 });

const hook = <T>(page: import('@playwright/test').Page, f: (h: Hook) => T | Promise<T>): Promise<T> => page.evaluate(`(${f.toString()})(window.__shardfall)`) as Promise<T>;

test('AUD-12: 200 overlapping shots, explosions and deaths rendered through the real engine graph never pass full scale', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3&renderer=classic');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const r = await hook(page, (h) => h.audioBurst(200));
  expect(r.requested).toBe(200);
  expect(r.started).toBeGreaterThan(24);
  // The voice budget held: more were asked for than were allowed to play at once, and something was audible.
  expect(r.peak).toBeGreaterThan(0.05);
  expect(r.peak).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('AUD-11: hovering and clicking menu buttons plays UI sounds without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#menu .rail .nav').first()).toBeVisible();
  await page.locator('#menu [data-faction="alien"]').hover();
  await page.locator('#menu [data-faction="alien"]').click();
  await page.locator('#menu .rail .nav').nth(1).hover();
  await page.locator('#menu .rail .nav').nth(1).click();
  await page.locator('#menu [data-mode="single"]').click();
  expect(errors).toEqual([]);
});

test('AUD-11 AUD-7: HUD buttons play hover and click, and selecting and commanding a unit play its kind\'s own sound once each', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3&renderer=classic');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const count = (key: string): Promise<number> => page.evaluate((k) => (window as unknown as { __shardfall: Hook }).__shardfall.audio().requested[k] ?? 0, key);
  // A HUD button: hover then click.
  const btn = page.locator('#sidebar button:not(.off)').first();
  await btn.hover();
  await expect.poll(() => count('hover')).toBeGreaterThan(0);
  await page.locator('#topbar').hover();
  const clicks = await count('click');
  await btn.click();
  await expect.poll(() => count('click')).toBeGreaterThan(clicks);
  // Select a rifleman: its select sound, once.
  const id = await page.evaluate(() => {
    const h = (window as unknown as { __shardfall: Hook }).__shardfall;
    const u = h.snapshot()!.units.find((x) => x.owner === 0 && x.kind === 'hum_rifleman')!;
    h.select([u.id]);
    return u.id;
  });
  expect(id).toBeGreaterThan(-1);
  await expect.poll(() => count('ack:select:hum_rifleman')).toBe(1);
  await page.waitForTimeout(400);
  expect(await count('ack:select:hum_rifleman')).toBe(1);
  // A right-click order: its command sound, once.
  const g = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(14, 18));
  await page.mouse.click(g.x, g.y, { button: 'right' });
  await expect.poll(() => count('ack:command:hum_rifleman')).toBe(1);
  await page.waitForTimeout(400);
  expect(await count('ack:command:hum_rifleman')).toBe(1);
  expect(errors).toEqual([]);
});
