import { expect, test, type Locator, type Page } from '@playwright/test';

test('MENU-1: the menu has a rail of the MENU-14 entries, faction cards naming heroes, map cards with thumbnails, and Enter starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  await expect(page.locator('#menu .rail .nav')).toHaveText([/Single player/, /Multiplayer/, /Units/, /How to play/, /Settings/]);
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
  // Down past Units reaches How to play, then Settings.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu [data-panel="howto"]')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#menu [data-panel="settings"]')).toBeVisible();
  await page.locator('#menu [data-mode="single"]').click();
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

test('MENU-3: settings (quality, sound and music) are saved at once and the next game uses them; Units opens the unit sheet', async ({ page }) => {
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
  // The game started on Low: F2 flips it to High.
  await page.keyboard.press('F2');
  await expect(page.getByText('Graphics quality: high')).toBeVisible();
  await page.goto('/');
  await page.locator('#info-btn').click();
  await expect(page.locator('#unit-info')).toHaveClass(/open/);
});

test('MENU-4: a View units button sits at the right-hand end of the opponent row and opens the sheet for the picked faction', async ({ page }) => {
  // Layout only: without the panel's slide-in (MENU-13), the boxes below are measured at rest.
  await page.emulateMedia({ reducedMotion: 'reduce' });
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

/** True when the heading font stack has a condensed face on this machine: its width differs from plain sans-serif. */
async function hasCondensedFace(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const head = getComputedStyle(document.querySelector('#menu .card .hero')!).fontFamily;
    const width = (family: string): number => {
      const s = document.createElement('span');
      s.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:600 40px ${family};font-stretch:87.5%`;
      s.textContent = 'Paladin, a giant assault walker with cannons and missiles.';
      document.body.appendChild(s);
      const w = s.getBoundingClientRect().width;
      s.remove();
      return w;
    };
    return width(head) !== width('sans-serif');
  });
}

const HERO_LINES = { human: 'Hero: Paladin, a giant assault walker with cannons and missiles.', alien: 'Hero: Dreadstrider, a towering six-legged walker with an acid cannon.' };

async function heroFit(hero: Locator): Promise<{ rows: number; overflow: boolean; right: boolean }> {
  return hero.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    // One row when every fragment's vertical span overlaps the others' (bold and plain text have slightly different tops).
    const rects = [...r.getClientRects()].filter((x) => x.width > 0);
    const one = Math.max(...rects.map((x) => x.top)) < Math.min(...rects.map((x) => x.bottom));
    return { rows: one ? 1 : 2, overflow: el.scrollWidth > el.clientWidth + 1, right: r.getBoundingClientRect().right <= el.closest('.card')!.getBoundingClientRect().right };
  });
}

test('MENU-7: both faction cards show their hero line on one row on a desktop screen, and never clipped on a phone', async ({ page }) => {
  for (const size of [{ width: 1280, height: 800 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('#menu .card .hero').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const condensed = await hasCondensedFace(page);
    for (const [id, line] of Object.entries(HERO_LINES)) {
      const hero = page.locator(`#menu [data-faction="${id}"] .hero`);
      await expect(hero).toHaveText(line);
      const fits = await heroFit(hero);
      // Always one row. With a condensed face on the machine the size stays readable: 11 px at 1280, 12 px at 1920.
      const px = await hero.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      if (condensed && size.width >= 1920) expect(px, `${id} font at ${size.width}px`).toBeGreaterThanOrEqual(12);
      else if (condensed && size.width >= 1280) expect(px, `${id} font at ${size.width}px`).toBeGreaterThanOrEqual(11);
      expect(fits, `${id} at ${size.width}px`).toEqual({ rows: size.width >= 1280 ? 1 : fits.rows, overflow: false, right: true });
    }
  }
});

test('MENU-7: with a wide fallback face (Arial) the hero lines still fit one row at 1280 px, by shrinking', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await expect(page.locator('#menu .card .hero').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '#menu .card .hero { font-family: Arial, Verdana, sans-serif !important; font-stretch: 100% !important; }' });
  // Re-run the fit: a resize does it.
  await page.setViewportSize({ width: 1281, height: 720 });
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const id of Object.keys(HERO_LINES)) {
    const hero = page.locator(`#menu [data-faction="${id}"] .hero`);
    await expect.poll(async () => (await heroFit(hero)).overflow, { message: `${id} overflows` }).toBe(false);
    expect(await heroFit(hero), id).toEqual({ rows: 1, overflow: false, right: true });
  }
});
