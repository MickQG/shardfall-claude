import { expect, test } from '@playwright/test';

type Hook = {
  snapshot: () => { units: { id: number; owner: number; kind: string; dest: [number, number] | null }[] } | null;
  selected: () => number[];
  screenPos: (id: number) => { x: number; y: number } | null;
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  select: (ids: number[]) => void;
};

// The software GPU in CI builds every model and compiles every shader up front on each page load: allow for it.
test.describe.configure({ timeout: 180_000 });

test('R3D-1 R3D-5 R3D-6 R3D-7: the showcase runs in 3D on both presets; clicking selects and right-clicking moves', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=showcase&seed=1&renderer=3d');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#frametime')).toContainText(/renderer 3d · \d+ fps/);
  expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(30_000);

  // R3D-6/R3D-7: the fight plays out on the low preset too.
  await page.keyboard.press('F2');
  await page.waitForTimeout(2500);
  expect((await page.locator('canvas').first().screenshot()).length).toBeGreaterThan(30_000);
  await page.keyboard.press('F2');

  // R3D-5: in a calm scene (nothing moving), a click on an own unit selects it through the 3D projection.
  await page.goto('/?faction=human&scenario=calm&seed=3&renderer=3d');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const tank = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.units.find((u) => u.owner === 0 && u.kind === 'hum_rifleman')!.id);
  const p = await page.evaluate((id) => (window as unknown as { __shardfall: Hook }).__shardfall.screenPos(id), tank);
  expect(p).not.toBeNull();
  await page.mouse.click(p!.x, p!.y);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.selected())).toContain(tank);
  // A right-click on open ground orders a move there.
  const g = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(14, 18));
  await page.mouse.click(g.x, g.y, { button: 'right' });
  await expect.poll(async () => (await page.evaluate((id) => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.units.find((u) => u.id === id)?.dest ?? null, tank)) !== null).toBe(true);

  // R3D-1: without the switch the classic view is used.
  await page.goto('/?faction=human&scenario=showcase&seed=1');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#frametime')).toContainText('renderer classic');
  expect(errors).toEqual([]);
});

test('R3D-9 R3D-12 R3D-13: a large battle in 3D keeps its draw calls flat and plays without page errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const draws = async (army: number): Promise<number> => {
    await page.goto(`/?faction=human&scenario=showcase&seed=1&renderer=3d&army=${army}`);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
    // Look at the whole army: select it and centre the camera on it.
    await page.evaluate(() => {
      const h = (window as unknown as { __shardfall: Hook & { snapshot: () => { units: { id: number; owner: number }[] } } }).__shardfall;
      h.select(h.snapshot()!.units.filter((u) => u.owner === 0).map((u) => u.id));
    });
    await page.keyboard.press('Space');
    await expect(page.locator('#frametime')).toContainText(/\d+ draws/, { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const text = (await page.locator('#frametime').textContent()) ?? '';
    return Number(/(\d+) draws/.exec(text)?.[1]);
  };
  const few = await draws(0);
  const many = await draws(95);
  expect(few).toBeGreaterThan(0);
  // About 200 units instead of a handful: a few more batches (more kinds in view), not one call per unit.
  expect(many).toBeLessThan(few + 60);
  expect(errors).toEqual([]);
});
