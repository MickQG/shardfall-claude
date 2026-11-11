import { expect, test } from '@playwright/test';

test('UI-22: dragging over the sidebar with the right or left button never selects text', async ({ page }) => {
  await page.goto('/?faction=human&scenario=rush&flyin=0');
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30_000 });
  const box = await page.locator('#sidebar').boundingBox();
  expect(box).not.toBeNull();
  const { x, y, width, height } = box!;
  for (const button of ['right', 'left'] as const) {
    await page.mouse.move(x + 4, y + 4);
    await page.mouse.down({ button });
    await page.mouse.move(x + width - 4, y + height - 4, { steps: 12 });
    await page.mouse.up({ button });
    expect((await page.evaluate(() => window.getSelection()?.toString() ?? '')).trim(), `${button} drag`).toBe('');
  }
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('sidebar')!).userSelect)).toBe('none');
});
