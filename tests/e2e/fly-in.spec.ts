import { expect, test, type Page } from '@playwright/test';

type Cam = { x: number; y: number; zoom: number; rise?: number };
type Hook = {
  snapshot: () => { tick: number; units: { owner: number }[]; buildings: { owner: number }[] } | null;
  camera: () => Cam;
  fly: () => { mode: 'sweep' | 'fade'; flying: boolean; progress: number; cam: Cam; fade: number };
};

// The software GPU builds every model and compiles every shader up front on each page load: allow for it.
test.describe.configure({ timeout: 180_000 });

/** One reading of the page: the fly-in's state, the tick, the HUD and the camera, all at the same instant of the page clock. */
interface Sample {
  mode: 'sweep' | 'fade';
  flying: boolean;
  progress: number;
  drawn: Cam;
  fade: number;
  tick: number;
  hud: number;
  cam: Cam;
  enemyUnits: number;
  enemyBuildings: number;
  own: number;
}
/** Reads the page now; also installed in the page as a per-frame recorder, so every frame of the fly-in is seen however slowly the software GPU draws. */
function readPage(): Sample | null {
  const h = (window as unknown as { __shardfall?: Hook }).__shardfall;
  const hud = document.getElementById('hud');
  const s = h?.snapshot();
  if (!h || !hud || !s) return null;
  const f = h.fly();
  return {
    mode: f.mode,
    flying: f.flying,
    progress: f.progress,
    drawn: { ...f.cam },
    fade: f.fade,
    tick: s.tick,
    hud: Number(getComputedStyle(hud).opacity),
    cam: { ...h.camera() },
    enemyUnits: s.units.filter((u) => u.owner !== 0).length,
    enemyBuildings: s.buildings.filter((b) => b.owner !== 0).length,
    own: s.units.filter((u) => u.owner === 0).length,
  };
}
const sample = async (p: Page): Promise<Sample> => (await p.evaluate(readPage))!;

/** Opens a single-player game with the real fly-in, recording the page on every frame. */
async function open(page: Page, query: string): Promise<void> {
  await page.addInitScript(`(() => {
    window.__flyLog = [];
    const read = ${readPage.toString()};
    const record = () => { const s = read(); if (s) window.__flyLog.push(s); };
    const frame = () => { requestAnimationFrame(frame); setTimeout(record, 0); };
    requestAnimationFrame(frame);
  })()`);
  await page.goto(`/?faction=human&difficulty=easy&seed=3&${query}`);
  await page.waitForSelector('body[data-fly]', { state: 'attached', timeout: 120_000 });
}

/** Waits for the fly-in to end and returns the frames recorded while it played. */
async function watch(page: Page): Promise<Sample[]> {
  await page.waitForSelector('body[data-ready="true"]', { state: 'attached', timeout: 30_000 });
  const log = await page.evaluate(() => (window as unknown as { __flyLog: Sample[] }).__flyLog);
  return log.filter((s) => s.flying);
}

const flyMs = (page: Page): Promise<number> => page.evaluate(() => Number(document.body.dataset.flyMs));
const ready = (page: Page, timeout = 8000): Promise<unknown> => page.waitForSelector('body[data-ready="true"]', { state: 'attached', timeout });

test('CAM-4 CAM-5: the sweep holds the game at its first tick with the HUD hidden for four seconds, then the game starts and the HUD fades in', async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await open(page, 'renderer=3d');
  const all = await watch(page);
  const first = all[0]!;
  expect(first.mode).toBe('sweep');
  // CAM-4: the camera starts high above the middle, well out from where it ends, and comes in on a steeper pitch easing to normal.
  expect(first.drawn.zoom).toBeLessThan(first.cam.zoom * 0.6);
  expect(first.drawn.rise).toBeGreaterThan(1.25);
  const zooms = all.filter((s) => s.flying).map((s) => s.drawn.zoom);
  for (let i = 1; i < zooms.length; i++) expect(zooms[i]!).toBeGreaterThanOrEqual(zooms[i - 1]! - 1e-9);
  // CAM-5: while it plays there are no ticks, no HUD and no change to the player's own camera.
  for (const s of all.filter((x) => x.flying)) {
    expect(s.tick).toBe(0);
    expect(s.hud).toBe(0);
    expect(s.cam).toEqual(first.cam);
  }
  // On CI's software GPU a 3D frame can take hundreds of milliseconds, so the page may answer late even once it is ready.
  await ready(page, 30_000);
  const ms = await flyMs(page);
  expect(ms).toBeGreaterThanOrEqual(4000);
  // After it: the sweep ended exactly on the player's camera, the game runs and the HUD is up.
  await expect.poll(async () => (await sample(page)).tick, { timeout: 5000 }).toBeGreaterThan(0);
  const end = await sample(page);
  expect(end.drawn).toEqual(end.cam);
  await expect.poll(async () => (await sample(page)).hud).toBe(1);
  expect(errors).toEqual([]);
});

// The skip tests use the classic view, and skip from inside the page in one step: on CI's software GPU a frame can take
// hundreds of milliseconds, so a key press sent from the test could otherwise land after the fly-in had ended by itself.
/** Sends a key press or a click to the page while the fly-in plays, and reports whether it was playing and whether it ended. */
const skipNow = (page: Page, input: 'key' | 'click'): Promise<{ before: string | undefined; after: string | undefined; flyMs: number }> =>
  page.evaluate((input) => {
    const before = document.body.dataset.ready;
    if (input === 'key') window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    else document.elementFromPoint(300, 300)?.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 300, clientY: 300, bubbles: true }));
    return { before, after: document.body.dataset.ready, flyMs: Number(document.body.dataset.flyMs) };
  }, input);
test('CAM-6 CAM-5: in single-player a key press skips the fly-in and the game starts at once', async ({ page }) => {
  await open(page, 'renderer=classic');
  expect((await sample(page)).tick).toBe(0);
  const r = await skipNow(page, 'key');
  expect(r.before).not.toBe('true');
  expect(r.after).toBe('true');
  expect(r.flyMs).toBeLessThan(4000);
  const s = await sample(page);
  expect(s.flying).toBe(false);
  expect(s.drawn).toEqual(s.cam);
  await expect.poll(async () => (await sample(page)).tick, { timeout: 3000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await sample(page)).hud).toBe(1);
});

test('CAM-6: in single-player a click skips the fly-in too', async ({ page }) => {
  await open(page, 'renderer=classic');
  const r = await skipNow(page, 'click');
  expect(r.before).not.toBe('true');
  expect(r.after).toBe('true');
  expect(r.flyMs).toBeLessThan(4000);
  await expect.poll(async () => (await sample(page)).tick, { timeout: 3000 }).toBeGreaterThan(0);
});

test('CAM-7: nothing of the enemy is drawn during the sweep, which is built from the fog-limited snapshot', async ({ page }) => {
  await open(page, 'renderer=3d');
  const all = await watch(page);
  for (const s of all) {
    expect(s.enemyUnits).toBe(0);
    expect(s.enemyBuildings).toBe(0);
    expect(s.own).toBeGreaterThan(0);
  }
});

for (const [name, query, emulate] of [
  ['reduced motion', 'renderer=3d', true],
  ['the classic view', 'renderer=classic', false],
] as const) {
  test(`CAM-8 CAM-5: with ${name} there is no sweep: the base fades in from black over four seconds, the game waits, and the HUD comes at the end`, async ({ page }) => {
    if (emulate) await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page, query);
    const all = await watch(page);
    const playing = all.filter((s) => s.flying);
    expect(playing.length).toBeGreaterThan(2);
    for (const s of playing) {
      expect(s.mode).toBe('fade');
      expect(s.drawn).toEqual(s.cam); // the camera never moves
      expect(s.tick).toBe(0);
      expect(s.hud).toBe(0);
    }
    // The fade only ever lifts, from black.
    expect(playing[0]!.fade).toBeGreaterThan(0.9);
    for (let i = 1; i < playing.length; i++) expect(playing[i]!.fade).toBeLessThanOrEqual(playing[i - 1]!.fade + 1e-9);
    expect(playing.at(-1)!.fade).toBeLessThan(0.3);
    await ready(page);
    expect(await flyMs(page)).toBeGreaterThanOrEqual(4000);
    await expect.poll(async () => (await sample(page)).tick, { timeout: 5000 }).toBeGreaterThan(0);
  });
}

test('CAM-8 CAM-6: with reduced motion a single-player key press skips the fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'renderer=classic');
  const r = await skipNow(page, 'key');
  expect(r.before).not.toBe('true');
  expect(r.after).toBe('true');
  expect(r.flyMs).toBeLessThan(4000);
});
