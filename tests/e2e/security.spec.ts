import { expect, test } from '@playwright/test';

// The build is served with the production headers (vite preview reads staticwebapp.config.json), so these pages run
// under the real Content-Security-Policy.
for (const q of ['', '?faction=human&difficulty=easy&map=riverbed', '?faction=alien&difficulty=easy&map=highlands&seed=abc']) {
  test(`SEC-1: ${q || 'the menu'} loads under the strict Content-Security-Policy without violations or page errors`, async ({ page }) => {
    const bad: string[] = [];
    page.on('pageerror', (e) => bad.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') bad.push(m.text());
    });
    // The test server has no game API (the website does, NET-1): answer the menu's same-origin status check as unconfigured
    // rather than with a 404 the browser would log.
    await page.route('**/api/negotiate', (r) => r.fulfill({ json: { available: false } }));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
    const res = await page.goto(`/${q}`);
    const h = res?.headers() ?? {};
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['x-frame-options']).toBe('DENY');
    if (q) await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
    else await expect(page.locator('#menu [data-map]')).toHaveCount(4);
    await page.waitForTimeout(1500);
    expect(bad).toEqual([]);
  });
}

test('MAP-4: the menu remembers the chosen map and starts the game on it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#menu [data-map="highlands"]').click();
  await expect(page.locator('#menu [data-map="highlands"]')).toHaveClass(/sel/);
  await page.reload();
  await expect(page.locator('#menu [data-map="highlands"]')).toHaveClass(/sel/);
  await page.locator('#go').click();
  await page.waitForURL(/map=highlands/);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
});
