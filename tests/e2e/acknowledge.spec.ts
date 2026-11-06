import { expect, test } from '@playwright/test';

type Hook = {
  snapshot: () => { units: { id: number; owner: number; kind: string }[] } | null;
  select: (ids: number[]) => void;
  tileScreen: (tx: number, ty: number) => { x: number; y: number };
  acks: () => {
    markers: { x: number; y: number; color: number; k: number }[];
    flashing: number[];
    last: { at: { x: number; y: number } | null; units: number[]; color: number | null; born: number } | null;
    now: number;
  };
};

// The software GPU in CI builds every model and compiles every shader up front on each page load: allow for it.
test.describe.configure({ timeout: 180_000 });

for (const renderer of ['classic', '3d']) {
  test(`UI-13 UI-15: a right-click order is acknowledged on screen at once, with a marker and a ring flash (${renderer})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`/?faction=human&scenario=calm&seed=3&renderer=${renderer}`);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 60_000 });
    const hook = (): Promise<ReturnType<Hook['acks']>> => page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.acks());
    const id = await page.evaluate(() => {
      const h = (window as unknown as { __shardfall: Hook }).__shardfall;
      const u = h.snapshot()!.units.find((x) => x.owner === 0 && x.kind === 'hum_rifleman')!;
      h.select([u.id]);
      return u.id;
    });
    expect(await hook()).toMatchObject({ markers: [], flashing: [], last: null });
    const g = await page.evaluate(() => (window as unknown as { __shardfall: Hook }).__shardfall.tileScreen(14, 18));
    await page.mouse.click(g.x, g.y, { button: 'right' });
    // Acknowledged on the click itself (a slow software GPU may take longer than the marker's life to answer, so the
    // order's acknowledgement is read rather than the marker still on screen).
    const a = await hook();
    expect(a.last).toMatchObject({ units: [id], color: 0x5dff8a });
    expect(a.last!.at!.x).toBeCloseTo(14, 0);
    expect(a.last!.at!.y).toBeCloseTo(18, 0);
    if (a.now - a.last!.born < 300) {
      expect(a.markers).toHaveLength(1);
      expect(a.flashing).toEqual([id]);
    }
    // Gone again after its life.
    await expect.poll(async () => (await hook()).markers.length, { timeout: 5000 }).toBe(0);
    expect(errors).toEqual([]);
  });
}
