import { expect, test, type Page } from '@playwright/test';

/** Pixels of the live preview canvas that are not transparent. */
const painted = (page: Page): Promise<number> =>
  page.locator('#unit-info .stage canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    if (d) for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++;
    return n;
  });

test('INF-1 INF-2 INF-3 INF-4: the unit sheet lists the picked faction, explains each unit in plain words and switches faction', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  const panel = page.locator('#unit-info');
  await expect(panel).toBeHidden();

  await page.locator('#info-btn').click();
  await expect(panel).toBeVisible();
  await expect(panel.locator('.u')).toHaveCount(7);
  await expect(panel.locator('[data-tab="human"]')).toHaveClass(/sel/);
  await panel.locator('.u', { hasText: 'Rocketeer' }).click();
  await expect(panel.locator('.facts')).toContainText('Strong against: Heavy (Gorger, Brute, Lobber, Dreadstrider)');
  await panel.locator('.u', { hasText: 'Shard Hauler' }).click();
  await expect(panel.locator('.facts')).toContainText('Cannot attack');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  await page.locator('#menu [data-faction="alien"]').click();
  await page.locator('#info-btn').click();
  await expect(panel.locator('[data-tab="alien"]')).toHaveClass(/sel/);
  await panel.locator('.u', { hasText: 'Brute' }).click();
  await expect(panel.locator('.facts')).toContainText('Regenerates');
  await panel.locator('[data-tab="human"]').click();
  await expect(panel.locator('.u').first()).toContainText('Shard Hauler');
  await panel.locator('[data-close]').click();
  await expect(panel).toBeHidden();
});

test('INF-6 INF-7 INF-8: the sheet shows each unit as a moving 3D model with pictures in the list, bars, and loads 3D only when opened', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  const chunks = (): Promise<string[]> => page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /preview3d/.test(n)));
  expect(await chunks()).toEqual([]);

  await page.locator('#info-btn').click();
  const panel = page.locator('#unit-info');
  // A picture of every model in the list, and a live model in the detail pane.
  await expect(panel.locator('.u .pic img')).toHaveCount(7, { timeout: 30_000 });
  expect(await panel.locator('.u .pic img').first().getAttribute('src')).toMatch(/^data:image\/png/);
  expect((await chunks()).length).toBeGreaterThan(0);
  await expect(panel.locator('.noview')).toBeHidden();
  await expect.poll(() => painted(page), { timeout: 15_000 }).toBeGreaterThan(2000);
  // It moves: two frames apart in time differ.
  const a = await page.locator('#unit-info .stage canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.waitForTimeout(600);
  const b = await page.locator('#unit-info .stage canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  expect(a).not.toBe(b);

  // Down chooses the next unit; its facts and bars follow.
  await page.keyboard.press('ArrowDown');
  await expect(panel.locator('.u.sel')).toContainText('Rifleman');
  await expect(panel.locator('.facts h3')).toHaveText('Rifleman');
  await panel.locator('.u', { hasText: 'Paladin' }).click();
  await expect(panel.locator('.facts')).toContainText('4500');
  await expect(panel.locator('.facts')).toContainText('Trained at: Motor Pool · needs Tech Lab');
  await expect(panel.locator('.bars .bar')).toHaveCount(4);
  // Right switches to the other faction.
  await page.keyboard.press('ArrowRight');
  await expect(panel.locator('[data-tab="alien"]')).toHaveClass(/sel/);
  await expect(panel.locator('.u .pic img')).toHaveCount(7);
});
