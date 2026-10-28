import { expect, test } from '@playwright/test';

interface Hook {
  snapshot: () => { units: { id: number; owner: number; kind: string; x: number; y: number }[]; buildings: { id: number; owner: number; kind: string; rally: [number, number] | null }[] } | null;
  selected: () => number[];
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  send: (c: unknown) => void;
}

test('CTL-1 CTL-2 CTL-3 CTL-4 CUR-1 CUR-3: Q selects combat units, F2 toggles quality, Ctrl+right-click attack-moves, cursors change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });

  // CTL-1: Q selects the three riflemen and not the hauler.
  await page.keyboard.press('q');
  const sel = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.selected());
  const snap = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot());
  const riflemen = snap!.units.filter((u) => u.owner === 0 && u.kind === 'hum_rifleman').map((u) => u.id);
  expect(riflemen.length).toBe(3);
  expect([...sel].sort()).toEqual([...riflemen].sort());

  // CTL-2: F2 toggles quality; Q does not.
  await expect(page.getByText(/F2 quality: high/)).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page.getByText(/F2 quality: low/)).toBeVisible();

  // CUR-1 / CUR-3: the canvas cursor is an inline SVG once units are selected and the pointer is over open ground.
  const p = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(30, 14));
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toContain('data:image/svg+xml');
  const moveCursor = await page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor);
  await page.keyboard.press('a');
  await expect.poll(() => page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor)).not.toBe(moveCursor);

  // CTL-3: Ctrl+right-click sends the selected units walking to the target.
  await page.keyboard.press('Escape');
  const before = snap!.units.find((u) => u.id === riflemen[0])!;
  await page.keyboard.down('Control');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.keyboard.up('Control');
  await page.waitForTimeout(2500);
  const after = (await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()))!.units.find((u) => u.id === riflemen[0])!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(256);

  // CTL-4: the snapshot exposes the rally point of an own building once one is set.
  const hq = snap!.buildings.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
  expect(hq.rally).toBeNull();
  await page.evaluate((id) => (window as unknown as { __shardfall: Hook }).__shardfall.send({ type: 'rally', player: 0, building: id, x: 20 * 256, y: 20 * 256 }), hq.id);
  await expect
    .poll(async () => (await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()))!.buildings.find((b) => b.id === hq.id)!.rally)
    .toEqual([20 * 256, 20 * 256]);
  expect(errors).toEqual([]);
});

test('PRD-9: Ctrl-clicking a build item queues five of it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const queued = (): Promise<number> =>
    page.evaluate(() => {
      const s = (window as unknown as { __shardfall: Hook }).__shardfall.snapshot() as unknown as { buildings: { kind: string; owner: number; queue: unknown[] }[] };
      return s.buildings.find((b) => b.owner === 0 && b.kind === 'hum_hq')!.queue.length;
    });
  const reactor = page.locator('[data-act="build"][data-kind="hum_reactor"]');
  await reactor.click({ modifiers: ['Control'] });
  await expect.poll(queued).toBe(5);
  expect(errors).toEqual([]);
});
