import { expect, test, type Dialog, type Page } from '@playwright/test';

type Hook = { snapshot: () => { tick: number } | null; setSpeed: (v: number) => void };
const tick = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.snapshot()!.tick);

test('CTL-19: closing a single-player match asks first, the game is paused behind the dialog and stays paused with its menu open', async ({ page }) => {
  await page.goto('/?faction=human&scenario=calm&seed=3&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  // The browser only shows the dialog after the player has used the page.
  await page.mouse.click(640, 300);
  await expect(page.locator('#pause')).toBeHidden();
  await page.waitForTimeout(500);
  const before = await tick(page);
  const t0 = Date.now();
  expect(before).toBeGreaterThan(0);

  const dialogs: { type: string; ms: number }[] = [];
  page.on('dialog', async (d: Dialog) => {
    const t = Date.now();
    // While the dialog is open the page's thread is blocked; the simulation worker runs on unless it was told to pause.
    await new Promise((r) => setTimeout(r, 2000));
    dialogs.push({ type: d.type(), ms: Date.now() - t });
    await d.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length, { timeout: 10_000 }).toBe(1);
  expect(dialogs[0]!.type).toBe('beforeunload');

  // The player stayed: the page is open, the game is paused with its menu showing, and no game time passed behind the dialog.
  expect(page.isClosed()).toBe(false);
  await expect(page.locator('#pause')).toBeVisible();
  await page.waitForTimeout(300);
  const after = await tick(page);
  const elapsedMs = Date.now() - t0;
  // Unpaused, the game would have run 16 ticks per second (20 at the default speed 0.8) for the whole time; less than a quarter of that passed.
  expect(after - before).toBeLessThan((elapsedMs * 0.016) / 4);
  await page.waitForTimeout(500);
  expect(await tick(page)).toBe(after);
  // Esc resumes.
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toBeHidden();
  await expect.poll(() => tick(page)).toBeGreaterThan(after);
});

test('CTL-19: no confirmation from the pause menu\'s Quit to menu, nor from the result screen and Main menu', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.type());
    void d.dismiss();
  });
  await page.goto('/?faction=human&scenario=calm&seed=3&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.mouse.click(640, 300);
  await page.keyboard.press('Escape');
  await page.locator('#quit').click();
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  expect(dialogs).toEqual([]);

  await page.goto('/?faction=human&scenario=rush&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  await page.mouse.click(640, 300);
  await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.setSpeed(8));
  await expect(page.locator('#result h1')).toHaveText('VICTORY', { timeout: 60_000 });
  // The result screen shows: closing the page is not intercepted any more.
  const intercepted = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(intercepted).toBe(false);
  await page.locator('#result #menu-btn').click();
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  expect(dialogs).toEqual([]);
});

test('CTL-19: a match in play cancels beforeunload; the fly-in is guarded too', async ({ page }) => {
  await page.goto('/?faction=human&scenario=calm&seed=3');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const prevented = await page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
  expect(prevented).toBe(true);
});

test('CTL-20 CTL-21: F11 and the pause menu button toggle full screen, Keyboard Lock is asked for, and the choice is remembered', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __locks: number; __unlocks: number };
    w.__locks = 0;
    w.__unlocks = 0;
    const kb = { lock: () => (w.__locks++, Promise.resolve()), unlock: () => void w.__unlocks++ };
    Object.defineProperty(navigator, 'keyboard', { value: kb, configurable: true });
  });
  await page.goto('/?faction=human&scenario=calm&seed=3&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const full = (): Promise<boolean> => page.evaluate(() => document.fullscreenElement !== null);
  const locks = (): Promise<number> => page.evaluate(() => (window as unknown as { __locks: number }).__locks);

  await page.keyboard.press('F11');
  await expect.poll(full).toBe(true);
  await expect.poll(locks).toBeGreaterThan(0);
  // Ctrl+W is cancelled by the game while full screen holds the keyboard.
  await page.evaluate(() => {
    const w = window as unknown as { __wPrevented?: boolean };
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'w') w.__wPrevented = e.defaultPrevented;
    });
  });
  await page.keyboard.press('Control+w');
  expect(await page.evaluate(() => (window as unknown as { __wPrevented?: boolean }).__wPrevented)).toBe(true);

  await page.keyboard.press('F11');
  await expect.poll(full).toBe(false);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __unlocks: number }).__unlocks)).toBeGreaterThan(0);
  // The player left it themselves: not remembered.
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shardfall.settings.v3') ?? '{}').fullscreen)).toBe(false);

  await page.keyboard.press('Escape');
  const button = page.locator('#fullscreen');
  await expect(button).toHaveText('Full screen (F11)');
  await button.click();
  await expect.poll(full).toBe(true);
  await expect(button).toHaveText('Leave full screen (F11)');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shardfall.settings.v3') ?? '{}').fullscreen)).toBe(true);

  // Leaving by the game's own button drops full screen with the page, and the choice stays: the next match page puts the player back on a key press.
  await page.locator('#quit').click();
  await expect(page.locator('#menu h1 svg[role="img"]')).toHaveAttribute('aria-label', 'Shardfall');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shardfall.settings.v3') ?? '{}').fullscreen)).toBe(true);
  await page.goto('/?faction=human&scenario=calm&seed=3&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  expect(await full()).toBe(false);
  await page.keyboard.press('Shift');
  await expect.poll(full).toBe(true);
});
