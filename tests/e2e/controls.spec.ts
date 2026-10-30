import { expect, test } from '@playwright/test';

interface Hook {
  snapshot: () => { units: { id: number; owner: number; kind: string; x: number; y: number }[]; buildings: { id: number; owner: number; kind: string; rally: [number, number] | null }[] } | null;
  selected: () => number[];
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  send: (c: unknown) => void;
  modes: () => { placing: boolean; targeting: boolean; amove: boolean };
}

test('CTL-6 CTL-7 CTL-8 CTL-9 CTL-10 CUR-1 CUR-3: Q selects combat units, F2 toggles quality, F then click attack-moves, Ctrl+S is blocked, cursors change', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });

  // CTL-6: Q selects the three riflemen and not the hauler.
  await page.keyboard.press('q');
  const sel = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.selected());
  const snap = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot());
  const riflemen = snap!.units.filter((u) => u.owner === 0 && u.kind === 'hum_rifleman').map((u) => u.id);
  expect(riflemen.length).toBe(3);
  expect([...sel].sort()).toEqual([...riflemen].sort());

  // CTL-7: F2 toggles quality; Q does not.
  await expect(page.getByText(/F2 quality: high/)).toBeVisible();
  await page.keyboard.press('F2');
  await expect(page.getByText(/F2 quality: low/)).toBeVisible();

  // CUR-1 / CUR-3: the canvas cursor is an inline SVG once units are selected and the pointer is over open ground.
  const p = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(30, 14));
  await page.mouse.move(p.x, p.y);
  await expect.poll(() => page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor)).toContain('data:image/svg+xml');
  const moveCursor = await page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor);
  const cursor = (): Promise<string> => page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor);
  const modes = (): Promise<{ placing: boolean; targeting: boolean; amove: boolean }> => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.modes());
  // Panning keys and Ctrl never arm an order or show the attack-move cursor.
  for (const key of ['a', 'd', 'w', 's']) {
    await page.keyboard.down(key);
    await page.waitForTimeout(150);
    expect(await modes()).toEqual({ placing: false, targeting: false, amove: false });
    await page.keyboard.up(key);
  }
  // Panning moved the view by a frame-rate-dependent amount, so put the pointer back over the same open-ground tile.
  const back = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(30, 14));
  await page.mouse.move(back.x, back.y);
  await expect.poll(cursor).toBe(moveCursor);
  await page.keyboard.down('Control');
  await page.waitForTimeout(150);
  expect(await cursor()).toBe(moveCursor);
  await page.keyboard.up('Control');

  // CTL-10: Ctrl+S (S pans the map) must not open the browser's save dialog, so the game cancels that key press.
  await page.evaluate(() => {
    const w = window as unknown as { __prevented?: boolean };
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') w.__prevented = e.defaultPrevented;
    });
  });
  await page.keyboard.press('Control+s');
  expect(await page.evaluate(() => (window as unknown as { __prevented?: boolean }).__prevented)).toBe(true);

  // CTL-8: F arms attack-move (crosshair cursor); Escape disarms it without an order.
  await page.keyboard.press('f');
  await expect.poll(modes).toEqual({ placing: false, targeting: false, amove: true });
  await expect.poll(cursor).not.toBe(moveCursor);
  await page.keyboard.press('Escape');
  await expect.poll(modes).toEqual({ placing: false, targeting: false, amove: false });
  await expect.poll(cursor).toBe(moveCursor);

  // CTL-8: F then a left click sends the selected units attack-moving to the target and disarms the mode.
  const before = snap!.units.find((u) => u.id === riflemen[0])!;
  await page.keyboard.press('f');
  await page.mouse.click(p.x, p.y);
  await expect.poll(modes).toEqual({ placing: false, targeting: false, amove: false });
  await page.waitForTimeout(2500);
  const after = (await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()))!.units.find((u) => u.id === riflemen[0])!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(256);

  // CTL-9: the snapshot exposes the rally point of an own building once one is set.
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

test('PRD-10: right-click cancels one queued item, Ctrl + right-click cancels up to five', async ({ page }) => {
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
  await reactor.click({ button: 'right' });
  await expect.poll(queued).toBe(4);
  await reactor.click({ button: 'right', modifiers: ['Control'] });
  await expect.poll(queued).toBe(0);
  expect(errors).toEqual([]);
});

test('CUR-1 CUR-4: a selected harvester shows the harvest cursor over shards, riflemen do not', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const cursor = (): Promise<string> => page.locator('canvas').first().evaluate((c) => (c as HTMLCanvasElement).style.cursor);
  const hook = (): Promise<{ hauler: number; shard: { x: number; y: number }; ground: { x: number; y: number } }> =>
    page.evaluate(() => {
      const h = (window as unknown as { __shardfall: Hook & { screenPos: (id: number) => { x: number; y: number } | null } }).__shardfall;
      const s = h.snapshot() as unknown as { units: { id: number; owner: number; kind: string }[] };
      const hauler = s.units.find((u) => u.owner === 0 && u.kind === 'hum_hauler')!.id;
      return { hauler, shard: h.tileScreen(22.5, 12.5), ground: h.tileScreen(16.5, 20.5) };
    });
  const { hauler, shard, ground } = await hook();

  // Riflemen (Q): shards are just ground to them.
  await page.keyboard.press('q');
  await page.mouse.move(ground.x, ground.y);
  await expect.poll(cursor).toContain('data:image/svg+xml');
  const walk = await cursor();
  await page.mouse.move(shard.x, shard.y);
  await expect.poll(cursor).toBe(walk);

  // Select just the hauler: the same shard tile now shows a different (harvest) cursor, plain ground still the move cursor.
  await page.evaluate((id) => (window as unknown as { __shardfall: { select: (ids: number[]) => void } }).__shardfall.select([id]), hauler);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.selected().length)).toBe(1);
  await page.mouse.move(ground.x, ground.y);
  await expect.poll(cursor).toBe(walk);
  await page.mouse.move(shard.x, shard.y);
  await expect.poll(cursor).not.toBe(walk);
  expect(errors).toEqual([]);
});
