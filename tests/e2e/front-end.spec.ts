import { expect, test, type Page } from '@playwright/test';

type Hook = { snapshot: () => { tick: number } | null };
const tick = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick);

test('MENU-8 MENU-9: the rail title is an inline SVG wordmark with a shard emblem, named Shardfall, in the condensed heading face', async ({ page }) => {
  await page.goto('/');
  const mark = page.locator('#menu h1 svg[role="img"]');
  await expect(mark).toHaveAttribute('aria-label', 'Shardfall');
  await expect(mark.locator('polygon')).toHaveCount(2);
  await expect(mark.locator('linearGradient, filter, clipPath, [clip-path]')).toHaveCount(0);
  await expect(mark.locator('text')).toHaveCount(1);
  await expect(mark.locator('polygon').first()).toHaveCSS('fill', 'rgb(159, 252, 255)');
  await expect(mark.locator('polygon').last()).toHaveCSS('fill', 'rgb(47, 199, 176)');
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

test('MENU-12: each faction card keeps its own frame, whichever faction is picked', async ({ page }) => {
  await page.goto('/');
  for (const pick of ['human', 'alien']) {
    await page.locator(`#menu .card[data-faction="${pick}"]`).click();
    await expect(page.locator('#menu')).toHaveAttribute('data-faction', pick);
    const frame = (f: string): Promise<{ clip: string; radius: string }> =>
      page.locator(`#menu .card[data-faction="${f}"]`).evaluate((el) => ({ clip: getComputedStyle(el).clipPath, radius: getComputedStyle(el).borderTopLeftRadius }));
    const aegis = await frame('human');
    expect(aegis.clip).toContain('polygon');
    expect(aegis.radius).toBe('0px');
    const vrax = await frame('alien');
    expect(vrax.clip).toBe('none');
    expect(parseFloat(vrax.radius)).toBeGreaterThan(0);
    const human = page.locator('#menu .card[data-faction="human"]');
    await expect(human.locator('.trim')).toHaveCount(1);
    await expect(human.locator('.tag')).toHaveCount(1);
    // Two brackets (four strokes) in the un-chamfered corners, two chamfers (a six-point polygon), the label, no grid and no tick rule.
    expect(await human.locator('.trim').evaluate((el) => getComputedStyle(el).backgroundImage.match(/linear-gradient/g)?.length)).toBe(4);
    expect(aegis.clip.match(/,/g) ?? []).toHaveLength(5);
    await expect(human.locator('.tag')).toHaveText(/AEG-01 \/\/ COMBINED ARMS/i);
    expect(await human.evaluate((el) => getComputedStyle(el, '::after').display)).toBe('none');
    expect(await human.locator('h3').evaluate((el) => getComputedStyle(el, '::after').content)).toBe('none');
    await expect(page.locator('#menu .card[data-faction="alien"] .trim, #menu .card[data-faction="alien"] .tag')).toHaveCount(0);
  }
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
  await expect(music.getByLabel('Music volume')).toHaveValue('75');
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

test('MENU-10: in the 3D view a live scene canvas sits behind the panel in place of the backdrop, swaps with the faction pick and is gone after START', async ({ page }) => {
  test.slow();
  // CI renders in software, where an animated scene starves the page: there the scene draws once and holds (the
  // reduced-motion rule, MENU-10), which still exercises mounting, the swap and the release on START.
  if (process.env.CI) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => {
    // Recorded as the page unloads for the game: whether the scene had stopped and let go by then.
    window.addEventListener('beforeunload', () => sessionStorage.setItem('menuScene', JSON.stringify({ state: document.body.dataset.menuScene, canvases: document.querySelectorAll('#menu .scene canvas').length })));
  });
  await page.goto('/?renderer=3d');
  await page.waitForFunction(() => document.body.dataset.menuScene === 'on', null, { timeout: 60_000 });
  const canvas = page.locator('#menu .scene canvas');
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toHaveAttribute('data-faction', 'human');
  // The drifting backdrop is retired, and the canvas lies behind the rail and the panel (they take the clicks).
  await expect(page.locator('#menu .bg')).toBeHidden();
  const box = (await canvas.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(1599);
  expect(await page.evaluate(() => document.elementFromPoint(700, 300)?.closest('.panel') !== null)).toBe(true);
  expect(await page.evaluate(() => document.elementFromPoint(100, 300)?.closest('.rail') !== null)).toBe(true);
  // Picking the other faction swaps the scene (one canvas throughout).
  await page.locator('#menu .card[data-faction="alien"]').click();
  // Software GL (CI) builds the other faction's models and shaders slowly, so the swap gets room to finish.
  await expect(canvas).toHaveAttribute('data-faction', 'alien', { timeout: 30_000 });
  await expect(canvas).toHaveCount(1);
  await expect.poll(() => canvas.evaluate((c) => getComputedStyle(c).opacity), { timeout: 30_000 }).toBe('1');
  await page.locator('#go').click();
  await page.waitForURL(/faction=alien/, { timeout: 30_000 });
  const gone = JSON.parse((await page.evaluate(() => sessionStorage.getItem('menuScene'))) ?? '{}') as { state: string; canvases: number };
  expect(gone).toEqual({ state: 'off', canvases: 0 });
});

test('MENU-10: in the classic view the drifting backdrop stays and no scene canvas is made', async ({ page }) => {
  await page.goto('/?renderer=classic');
  await expect(page.locator('#menu .bg')).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.locator('#menu .scene canvas')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.dataset.menuScene)).toBeUndefined();
});

test('UI-17: in the 3D view every build and train button shows a picture of its model; in the classic view they are text only', async ({ page }) => {
  await page.goto('/?faction=human&renderer=3d');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  const buttons = page.locator('#sidebar button.item');
  const n = await buttons.count();
  expect(n).toBeGreaterThan(10);
  const withPicture = await buttons.evaluateAll((els) => els.filter((e) => { const i = e.querySelector<HTMLImageElement>('img.ic'); return !!i && i.src.startsWith('data:image/png') && i.naturalWidth > 0; }).length);
  expect(withPicture).toBe(n);
  // Beside the name and cost, compactly.
  const first = await buttons.first().evaluate((e) => ({ img: e.querySelector('img.ic')!.getBoundingClientRect().width, h: e.getBoundingClientRect().height, name: e.querySelector('.n')!.textContent }));
  expect(first.img).toBeGreaterThanOrEqual(36);
  expect(first.img).toBeLessThanOrEqual(44);
  expect(first.h).toBeLessThanOrEqual(64);
  expect(first.name).toBeTruthy();
  // Nothing is cropped (UI-17): the model keeps a margin, so the picture's outermost rows and columns hold no model. The ring is
  // sampled for the pixels that differ from the corner (the background), and the model never reaches it.
  const touching = await buttons.evaluateAll(async (els) => {
    let bad = 0;
    for (const e of els) {
      const img = e.querySelector<HTMLImageElement>('img.ic')!;
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const at = (x: number, y: number): number[] => [...d.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 4)];
      const ref = at(0, 0);
      let diff = 0;
      for (let i = 0; i < c.width; i++) for (const y of [0, c.height - 1]) diff += at(i, y).some((v, k) => Math.abs(v - ref[k]!) > 40) ? 1 : 0;
      for (let j = 0; j < c.height; j++) for (const x of [0, c.width - 1]) diff += at(x, j).some((v, k) => Math.abs(v - ref[k]!) > 40) ? 1 : 0;
      if (diff > 4) bad++;
    }
    return bad;
  });
  expect(touching).toBe(0);
  await page.goto('/?faction=human&renderer=classic');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 90_000 });
  await expect(page.locator('#sidebar button.item').first()).toBeVisible();
  await expect(page.locator('#sidebar img.ic')).toHaveCount(0);
});

test('MENU-1 MENU-11: #menu cannot be scrolled sideways at 1280 by 720, even after a faction card is clicked and focused', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.locator('#menu .card[data-faction="alien"]').click();
  await page.locator('#menu .card[data-faction="human"]').focus();
  await page.locator('#go').focus();
  const state = await page.evaluate(() => {
    const m = document.getElementById('menu')!;
    m.scrollLeft = 120;
    m.scrollTo({ left: 120 });
    document.querySelector('#menu .card')!.scrollIntoView();
    return { left: m.scrollLeft, overflowX: getComputedStyle(m).overflowX, rail: document.querySelector('#menu .rail')!.getBoundingClientRect().left };
  });
  expect(state).toEqual({ left: 0, overflowX: 'clip', rail: 0 });
});
