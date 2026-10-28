import { expect, test, type Page } from '@playwright/test';

interface Snap {
  tick: number;
  fog: number[] | null;
  units: { id: number; owner: number; kind: string; x: number; y: number; hp: number }[];
  buildings: { id: number; owner: number; kind: string; tx: number; ty: number; queue: { kind: string; pct: number; ready: boolean }[] }[];
  players: { credits: number }[];
}
interface Hook {
  snapshot: () => Snap | null;
  selected: () => number[];
  screenPos: (id: number) => { x: number; y: number } | null;
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  setSpeed: (v: number) => void;
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
  const riflemen = await page.evaluate(() => window.__shardfall.snapshot()!.units.filter((u) => u.owner === 0 && u.kind === 'hum_rifleman').map((u) => u.id));
  const [a, b] = [riflemen[0]!, riflemen[1]!];
  const p = await page.evaluate((id) => window.__shardfall.screenPos(id), a);
  expect(p).not.toBeNull();

  await page.mouse.click(box.x + p!.x, box.y + p!.y);
  expect(await page.evaluate(() => window.__shardfall.selected())).toEqual([a]);

  const read = (): Promise<{ id: number; x: number; y: number }[]> => page.evaluate(() => window.__shardfall.snapshot()!.units.map((u) => ({ id: u.id, x: u.x, y: u.y })));
  const before = await read();
  const dest = await page.evaluate(() => window.__shardfall.tileScreen(20, 17)); // on screen, several tiles from the selected unit
  await page.mouse.click(box.x + dest.x, box.y + dest.y, { button: 'right' });
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

test('ECO-2 PRD-1 PRD-2 PRD-3 UI-1: build a structure from the sidebar, then place it with the ghost', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => window.__shardfall.setSpeed(10));

  const item = page.locator('#sb-build button[data-kind="hum_barracks"]');
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.locator('#sb-build button[data-kind="hum_barracks"].ready')).toBeVisible({ timeout: 20_000 });

  await page.locator('#sb-build button[data-kind="hum_barracks"].ready').click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  const at = await page.evaluate(() => window.__shardfall.tileScreen(15, 14)); // centre of a 2x2 footprint at (14,13)
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.click(box.x + at.x, box.y + at.y);
  await page.waitForFunction(() => window.__shardfall.snapshot()!.buildings.some((b) => b.owner === 0 && b.kind === 'hum_barracks'), null, { timeout: 10_000 });
  const barracks = await page.evaluate(() => window.__shardfall.snapshot()!.buildings.find((b) => b.kind === 'hum_barracks')!);
  expect([barracks.tx, barracks.ty]).toEqual([14, 13]);
});

test('DET-1 ECO-5: the sidebar shows credits and power and updates as the economy runs', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#sb-res')).toContainText('Shards');
  await expect(page.locator('#sb-res')).toContainText('Power');
  const read = (): Promise<string> => page.locator('#sb-res .cr').innerText();
  const a = await read();
  await page.evaluate(() => window.__shardfall.setSpeed(10));
  await page.waitForTimeout(4000);
  expect(await read()).not.toBe(a);
});

test('CMB-3 CMB-4 CMB-8: in the browser, opposing squads fight, take damage and die without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?scenario=duel');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.evaluate(() => window.__shardfall.setSpeed(4));
  const count = (): Promise<number> => page.evaluate(() => window.__shardfall.snapshot()!.units.filter((u) => u.kind !== 'hum_hauler').length);
  const start = await count();
  await page.waitForFunction(
    () => window.__shardfall.snapshot()!.units.some((u) => u.hp < (({ ali_skitter: 70, ali_spitter: 80, hum_rifleman: 100 }) as Record<string, number>)[u.kind]!),
    null,
    { timeout: 20_000 },
  );
  await page.waitForTimeout(6000);
  expect(await count()).toBeLessThan(start); // someone died
  expect(errors).toEqual([]);
});
