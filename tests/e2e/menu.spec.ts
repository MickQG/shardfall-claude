import { expect, test } from '@playwright/test';

test('MENU-1: the menu has a rail of four modes, faction cards naming heroes, map cards with thumbnails, and Enter starts', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#menu h1')).toHaveText('SHARDFALL');
  await expect(page.locator('#menu .rail .nav')).toHaveText([/Single player/, /Multiplayer/, /Units/, /Settings/]);
  await expect(page.locator('#menu [data-faction="human"]')).toContainText('Paladin');
  await expect(page.locator('#menu [data-faction="alien"]')).toContainText('Dreadstrider');
  await expect(page.locator('#menu [data-map] canvas')).toHaveCount(3);
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

test('MENU-2: multiplayer is marked in progress and cannot start or join a game', async ({ page }) => {
  await page.goto('/');
  const mp = page.locator('#menu [data-mode="multi"]');
  await expect(mp).toContainText('In progress');
  await mp.click();
  const panel = page.locator('#menu [data-panel="multi"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Work in progress');
  await expect(panel).toContainText('room');
  await expect(panel.locator('button, input, a')).toHaveCount(0);
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
