import { expect, test, type Page } from '@playwright/test';

type Hook = { snapshot: () => { tick: number } | null };
const tick = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick);

test('MENU-8 MENU-9: the rail title is an inline SVG wordmark with a shard emblem, named Shardfall, in the condensed heading face', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('#menu h1 svg[role="img"]');
  await expect(mark).toHaveAttribute('aria-label', 'Shardfall');
  expect(await mark.locator('polygon').count()).toBeGreaterThanOrEqual(4);
  await expect(mark.locator('linearGradient')).toHaveCount(1);
  expect(await mark.locator('text').evaluate((t) => t.getAttribute('fill'))).toMatch(/^url\(#/);
  const heading = await page.locator('#menu .nav').first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(heading).toBe('Bahnschrift, "DIN Condensed", "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif');
  const body = await page.locator('#menu .note').first().evaluate((el) => getComputedStyle(el).fontFamily);
  expect(body).toBe('Bahnschrift, "Segoe UI", system-ui, sans-serif');
});

test('MENU-11: the menu panel is a translucent column with a maximum width, clear of the right-hand side on wide screens', async ({ page }) => {
  for (const width of [1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    const panel = page.locator('#menu .panel');
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(860);
    expect(await panel.evaluate((el) => getComputedStyle(el).backgroundImage)).toMatch(/rgba\(/);
    if (width >= 1600) expect(box!.x + box!.width).toBeLessThanOrEqual(width - 380);
  }
  // The 3D scene mount is placed behind the panel, over the drifting backdrop.
  await expect(page.locator('#menu .scene')).toBeAttached();
  await expect(page.locator('#menu .bg')).toBeAttached();
});

test('MENU-12: the menu wears the picked faction skin and switches with the pick', async ({ page }) => {
  await page.goto('/');
  const menu = page.locator('#menu');
  await expect(menu).toHaveAttribute('data-faction', 'human');
  const aegis = await page.locator('#go').evaluate((el) => ({ bg: getComputedStyle(el).backgroundImage, clip: getComputedStyle(el).clipPath }));
  expect(aegis.clip).toContain('polygon');
  await page.locator('#menu .card[data-faction="alien"]').click();
  await expect(menu).toHaveAttribute('data-faction', 'alien');
  const vrax = await page.locator('#go').evaluate((el) => ({ bg: getComputedStyle(el).backgroundImage, radius: getComputedStyle(el).borderTopLeftRadius }));
  expect(vrax.bg).not.toBe(aegis.bg);
  expect(vrax.radius).toBe('10px');
  await page.locator('#menu .card[data-faction="human"]').click();
  await expect(menu).toHaveAttribute('data-faction', 'human');
});

test('MENU-13: panels change with a short fade and slide, and START fades the menu out before the game loads', async ({ page }) => {
  await page.goto('/');
  const anim = await page.locator('#menu section.on').evaluate((el) => ({ d: parseFloat(getComputedStyle(el).animationDuration), n: getComputedStyle(el).animationName }));
  expect(anim.n).not.toBe('none');
  expect(anim.d).toBeGreaterThan(0);
  expect(anim.d).toBeLessThanOrEqual(0.25);
  await page.locator('#go').click();
  await expect(page.locator('#menu.leaving')).toBeAttached();
  await page.waitForURL(/faction=human/);
});

test('MENU-13: with reduced motion panels change instantly and START does not fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  expect(await page.locator('#menu section.on').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.getElementById('menu')?.classList.contains('leaving')) sessionStorage.setItem('faded', '1');
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
  });
  await page.reload();
  await page.locator('#go').click();
  await page.waitForURL(/faction=human/);
  expect(await page.evaluate(() => sessionStorage.getItem('faded'))).toBeNull();
});

test('MENU-14: How to play sits between Units and Settings with the Controls table and six Basics, and the rail has no help text', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu .rail .nav')).toHaveText([/Single player/, /Multiplayer/, /Units/, /How to play/, /Settings/]);
  await expect(page.locator('#menu .rail .help')).toHaveCount(0);
  await expect(page.locator('#menu #music-btn')).toHaveCount(0);
  await page.locator('#menu [data-mode="howto"]').click();
  const panel = page.locator('#menu [data-panel="howto"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-howto="controls"] tr', { hasText: 'F, then right-click' })).toContainText('F, then right-click');
  await expect(panel.locator('[data-howto="controls"]')).toContainText('Ctrl + 1-9');
  await expect(panel.locator('[data-howto="basics"] li')).toHaveCount(6);
  // The same table is in the F1 overlay in a match (UI-18).
  const rows = await panel.locator('[data-howto="controls"] td.keys').allTextContents();
  await page.goto('/?faction=human&scenario=duel&seed=5');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await page.keyboard.press('F1');
  expect(await page.locator('#help td.keys').allTextContents()).toEqual(rows);
});

test('MENU-15: Settings has Sound (Mute all, Master volume) and Music (Music on, Music volume), saved at once; M toggles Mute all', async ({ page }) => {
  await page.goto('/');
  await page.locator('#menu [data-mode="settings"]').click();
  const sound = page.locator('#menu [data-group="sound"]');
  const music = page.locator('#menu [data-group="music"]');
  await expect(sound.locator('h3')).toHaveText('Sound');
  await expect(sound.getByLabel('Mute all')).toBeVisible();
  await expect(sound.getByLabel('Master volume')).toBeVisible();
  await expect(music.locator('h3')).toHaveText('Music');
  await expect(music.getByLabel('Music on')).toBeChecked();
  await expect(music.getByLabel('Music volume')).toHaveValue('60');
  await music.getByLabel('Music on').uncheck();
  await music.getByLabel('Music volume').fill('30');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shardfall.settings.v3')!));
  expect(saved).toMatchObject({ musicOn: false, musicVolume: 0.3, muted: false });
  // M toggles Mute all in the menu.
  await page.locator('#menu [data-mode="single"]').click();
  await page.locator('#menu .card[data-faction="alien"]').focus();
  await page.keyboard.press('m');
  await page.locator('#menu [data-mode="settings"]').click();
  await expect(sound.getByLabel('Mute all')).toBeChecked();
  await page.reload();
  await page.locator('#menu [data-mode="settings"]').click();
  await expect(sound.getByLabel('Mute all')).toBeChecked();
  await expect(music.getByLabel('Music on')).not.toBeChecked();
  await expect(music.getByLabel('Music volume')).toHaveValue('30');
});

test('UI-16: the match HUD and sidebar wear the player faction skin', async ({ page }) => {
  const radius = (sel: string): Promise<string> => page.locator(sel).first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  await page.goto('/?faction=alien&scenario=duel&seed=5');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#hud')).toHaveAttribute('data-faction', 'alien');
  await expect(page.locator('#sidebar')).toHaveAttribute('data-faction', 'alien');
  for (const sel of ['#topbar', '#minimap-box']) expect(await radius(sel), sel).toBe('10px');
  expect(await radius('#sidebar .box')).toBe('18px');
  expect(await page.locator('#sidebar .box').first().evaluate((el) => getComputedStyle(el).clipPath)).toBe('none');
  await page.goto('/?faction=human&scenario=duel&seed=5');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#hud')).toHaveAttribute('data-faction', 'human');
  for (const sel of ['#topbar', '#minimap-box', '#sidebar .box']) expect(await radius(sel), sel).toBe('0px');
  expect(await page.locator('#sidebar .box').first().evaluate((el) => getComputedStyle(el).clipPath)).toContain('polygon');
});

test('UI-18: the top bar shows F1 Help and the speed only; F1 opens the controls overlay, F1 or Esc closes it, the game keeps running', async ({ page }) => {
  await page.goto('/?faction=human&scenario=duel&seed=5');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  await expect(page.locator('#topbar')).toHaveText(/^F1 Help · ×[\d.]+$/);
  const help = page.locator('#help');
  await expect(help).toBeHidden();
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Attack-move');
  const t0 = await tick(page);
  await expect.poll(() => tick(page)).toBeGreaterThan(t0);
  await page.keyboard.press('F1');
  await expect(help).toBeHidden();
  // Esc closes the overlay first: no pause menu opens.
  await page.keyboard.press('F1');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  await expect(page.locator('#pause')).toBeHidden();
  // With nothing open, Esc does what it did before.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeVisible();
});

test('UI-19: the loading screen wears the player faction skin, shows the wordmark and one tip from the Basics', async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const el = document.getElementById('loading');
      if (el && !sessionStorage.getItem('loading')) sessionStorage.setItem('loading', JSON.stringify({ faction: el.dataset.faction, mark: !!el.querySelector('svg[role="img"][aria-label="Shardfall"]'), tip: el.querySelector('.tip')?.textContent ?? '' }));
    }).observe(document, { subtree: true, childList: true });
  });
  await page.goto('/?faction=alien&difficulty=easy');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
  const seen = JSON.parse((await page.evaluate(() => sessionStorage.getItem('loading'))) ?? '{}') as { faction: string; mark: boolean; tip: string };
  expect(seen.faction).toBe('alien');
  expect(seen.mark).toBe(true);
  expect(seen.tip).toMatch(/^Tip: .{20,}/);
});
