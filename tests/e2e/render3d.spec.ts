import { expect, test } from '@playwright/test';

type Hook = {
  snapshot: () => { units: { id: number; owner: number; kind: string; dest: [number, number] | null }[] } | null;
  selected: () => number[];
  screenPos: (id: number) => { x: number; y: number } | null;
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  select: (ids: number[]) => void;
};

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
