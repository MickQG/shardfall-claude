import { expect, test } from '@playwright/test';

test('MENU-1: the menu has a rail of four modes, faction cards naming heroes, map cards with thumbnails, and Enter starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1')).toHaveText('SHARDFALL');
  await expect(page.locator('#menu .rail .nav')).toHaveText([/Single player/, /Multiplayer/, /Units/, /Settings/]);
  await expect(page.locator('#menu [data-faction="human"]')).toContainText('Paladin');
  await expect(page.locator('#menu [data-faction="alien"]')).toContainText('Dreadstrider');
  await expect(page.locator('#menu [data-map] canvas')).toHaveCount(4);
  await expect(page.locator('#menu [data-diff]')).toHaveCount(3);
  // Up and Down move through the rail.
  await page.locator('#menu [data-mode="single"]').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu [data-panel="multi"]')).toBeVisible();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#menu [data-panel="single"]')).toBeVisible();
  // Enter starts the chosen game.
  await page.locator('#menu [data-faction="alien"]').click();
  await page.locator('#menu [data-map="riverbed"]').click();
  await page.keyboard.press('Enter');
  await page.waitForURL(/faction=alien.*map=riverbed/);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
});

test('MENU-2 NET-1: where the website has no game server, Multiplayer says online play is unavailable and offers no controls', async ({ page }) => {
  await page.goto('/');
  const mp = page.locator('#menu [data-mode="multi"]');
  await expect(mp.locator('.badge')).toHaveText('Unavailable');
  await mp.click();
  const panel = page.locator('#menu [data-panel="multi"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.mp-off')).toContainText('not available');
  await expect(panel.locator('#mp-host')).toBeHidden();
  await expect(panel.locator('#mp-join')).toBeHidden();
  await expect(page.locator('#menu [data-panel="single"]')).toBeHidden();
});

test('MENU-3: settings are saved at once and the next game uses them; Units opens the unit sheet', async ({ page }) => {
  await page.goto('/');
  await page.locator('#menu [data-mode="settings"]').click();
  await page.locator('#menu [data-quality="low"]').click();
  await page.locator('#menu #set-mute').check();
  await page.reload();
  await page.locator('#menu [data-mode="settings"]').click();
  await expect(page.locator('#menu [data-quality="low"]')).toHaveClass(/sel/);
  await expect(page.locator('#menu #set-mute')).toBeChecked();
  await page.locator('#menu [data-mode="single"]').click();
  await page.locator('#menu #go').click();
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#topbar')).toContainText('quality: low');
  await page.goto('/');
  await page.locator('#info-btn').click();
  await expect(page.locator('#unit-info')).toHaveClass(/open/);
});

test('MENU-4: a View units button sits at the right-hand end of the opponent row and opens the sheet for the picked faction', async ({ page }) => {
  await page.goto('/');
  const btn = page.locator('#menu [data-panel="single"] #units-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toContainText('View units');
  const seg = await page.locator('#menu [data-panel="single"] .seg[aria-label="Personality"]').boundingBox();
  const b = await btn.boundingBox();
  const row = await page.locator('#menu [data-panel="single"] .row').boundingBox();
  if (!seg || !b || !row) throw new Error('missing layout');
  // Same row: the button's vertical centre lies within the selector; right end: it ends where the row ends.
  expect(Math.abs(b.y + b.height / 2 - (seg.y + seg.height / 2))).toBeLessThan(4);
  expect(b.x).toBeGreaterThan(seg.x + seg.width);
  expect(Math.abs(b.x + b.width - (row.x + row.width))).toBeLessThan(2);
  await page.locator('#menu [data-faction="alien"]').click();
  await btn.click();
  await expect(page.locator('#unit-info')).toHaveClass(/open/);
  await expect(page.locator('#unit-info [data-tab="alien"]')).toHaveClass(/sel/);
});

test('MENU-5: a Personality control beside the opponent difficulty, Random by default, remembered, and passed to the game', async ({ page }) => {
  await page.goto('/');
  const pers = page.locator('#menu [data-panel="single"] .row .seg[aria-label="Personality"] [data-pers]');
  await expect(pers).toHaveText(['Random', 'Raider', 'Balanced', 'Doomsday']);
  await expect(page.locator('#menu [data-pers="random"]')).toHaveClass(/sel/);
  await page.locator('#menu [data-pers="doomsday"]').click();
  await page.reload();
  await expect(page.locator('#menu [data-pers="doomsday"]')).toHaveClass(/sel/);
  await page.locator('#menu #go').click();
  await page.waitForURL(/personality=doomsday/);
});

test('MENU-6: a Generated map card with a thumbnail, reroll and an editable seed, remembered and passed to the game', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('#menu [data-map="generated"]');
  await expect(card).toContainText('Generated');
  await expect(card.locator('canvas')).toHaveCount(1);
  const seed = card.locator('#map-seed');
  const before = await card.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL());
  // Typing a seed selects the card and redraws its thumbnail.
  await seed.fill('4242');
  await seed.press('Tab');
  await expect(card).toHaveClass(/sel/);
  await expect(seed).toHaveValue(/^\d+$/);
  const typed = await seed.inputValue();
  expect(await card.locator('canvas').evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(before);
  // Reroll draws another seed.
  await card.locator('#reroll').click();
  await expect(seed).not.toHaveValue(typed);
  const rolled = await seed.inputValue();
  // Remembered on the device.
  await page.reload();
  await expect(page.locator('#menu [data-map="generated"]')).toHaveClass(/sel/);
  await expect(page.locator('#map-seed')).toHaveValue(rolled);
  await page.locator('#menu #go').click();
  await page.waitForURL(new RegExp(`map=generated&mapseed=${rolled}`));
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
});

test('MENU-7: both faction cards show their short hero line on one row, on desktop and on a phone', async ({ page }) => {
  const lines = { human: 'Hero: Paladin, a giant assault walker with cannons and missiles.', alien: 'Hero: Dreadstrider, a towering six-legged walker with an acid cannon.' };
  for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    for (const [id, line] of Object.entries(lines)) {
      const hero = page.locator(`#menu [data-faction="${id}"] .hero`);
      await expect(hero).toHaveText(line);
      const fits = await hero.evaluate((el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
        return { rows: tops.size, overflow: el.scrollWidth > el.clientWidth + 1, right: r.getBoundingClientRect().right <= el.closest('.card')!.getBoundingClientRect().right };
      });
      expect(fits, `${id} at ${size.width}px`).toEqual({ rows: 1, overflow: false, right: true });
    }
  }
});
