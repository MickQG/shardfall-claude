import { describe, expect, it } from 'vitest';
import { createGame, snapshot, submit, tick } from '../../src/sim';
import { aimFacing, barVisible, buildUp, crystalDepth, damageState, edgeShade, groundTint, idleGlow, muzzleFor, octant, unitDepth, BUILD_MS } from '../../src/render/gfx';
import { defaultSettings, effectsEnabled } from '../../src/ui/settings';

describe('building visuals', () => {
  it('GFX-1: build-up progress is 0 at placement, rises with time and is clamped to 1', () => {
    expect(buildUp(1000, 1000)).toBe(0);
    expect(buildUp(1000 + BUILD_MS / 2, 1000)).toBeCloseTo(0.5, 5);
    expect(buildUp(1000 + BUILD_MS * 4, 1000)).toBe(1);
    expect(buildUp(500, 1000)).toBe(0);
  });
  it('GFX-1: buildings present when the view starts are born finished', () => {
    expect(buildUp(10, -Infinity)).toBe(1);
  });
  it('GFX-2: damage state follows hp fraction with 66% and 33% thresholds', () => {
    expect(damageState(1000, 1000)).toBe('intact');
    expect(damageState(670, 1000)).toBe('intact');
    expect(damageState(660, 1000)).toBe('damaged');
    expect(damageState(340, 1000)).toBe('damaged');
    expect(damageState(330, 1000)).toBe('critical');
    expect(damageState(0, 1000)).toBe('critical');
  });
});

describe('unit visuals', () => {
  it('GFX-3: eight headings cover the compass, each on its own screen direction', () => {
    const dirs = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ] as const;
    expect(dirs.map(([x, y]) => octant(x, y))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(octant(10, 1)).toBe(0);
    expect(octant(0, 0)).toBe(0);
  });
});

describe('terrain visuals', () => {
  it('GFX-4: ground tint is deterministic, smooth between neighbours and varied across the map', () => {
    expect(groundTint(12, 30)).toBe(groundTint(12, 30));
    const samples = new Set<number>();
    for (let i = 0; i < 40; i++) samples.add(Math.round(groundTint(i * 7, i * 3) * 1000));
    expect(samples.size).toBeGreaterThan(8);
    expect(Math.abs(groundTint(20, 20) - groundTint(21, 20))).toBeLessThan(0.08);
    for (let i = 0; i < 50; i++) expect(groundTint(i, i * 2)).toBeGreaterThanOrEqual(0.85);
  });
  it('GFX-4: ground beside rock is shaded on exactly the sides that touch a taller tile', () => {
    const w = 3;
    const h = [0, 1, 0, 0, 0, 0, 0, 0, 0];
    expect(edgeShade(h, w, 1, 1)).toEqual({ n: true, e: false, s: false, w: false });
    expect(edgeShade(h, w, 0, 0)).toEqual({ n: false, e: true, s: false, w: false });
    expect(edgeShade(h, w, 2, 2)).toEqual({ n: false, e: false, s: false, w: false });
  });
});

describe('effects and bars', () => {
  it('GFX-5: every weapon type has its own muzzle flash', () => {
    const flashes = ['pierce', 'rocket', 'blast', 'claw', 'beam'].map((t) => JSON.stringify(muzzleFor(t)));
    expect(new Set(flashes).size).toBe(5);
    expect(muzzleFor('unknown').len).toBeGreaterThan(0);
  });
  it('GFX-6: health bars show only when damaged or selected; production bars only while building something', () => {
    expect(barVisible(100, 100, false)).toBe(false);
    expect(barVisible(60, 100, false)).toBe(true);
    expect(barVisible(100, 100, true)).toBe(true);
  });
  it('GFX-7: humans blink and aliens pulse, each within 0..1 and distinct over time', () => {
    const h = [0, 200, 400, 600, 800].map((t) => idleGlow('human', t));
    const a = [0, 200, 400, 600, 800].map((t) => idleGlow('alien', t));
    for (const v of [...h, ...a]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(new Set(h).size).toBeLessThanOrEqual(2); // on/off beacon
    expect(new Set(a).size).toBeGreaterThan(2); // smooth pulse
  });
  it('GFX-8: low quality turns the decorative work off, keeping the rest; reduced motion alone keeps it', () => {
    expect(effectsEnabled(defaultSettings(false)).decor).toBe(true);
    expect(effectsEnabled({ ...defaultSettings(false), quality: 'low' }).decor).toBe(false);
    expect(effectsEnabled(defaultSettings(true)).decor).toBe(true);
  });
});

describe('air draw order', () => {
  it('GFX-9: air units draw above every ground object, including hill rocks in front of them, and in depth order among themselves', () => {
    const rockInFront = 5000; // screen-y depth of a tall hill tile nearer the camera
    expect(unitDepth(4000, true)).toBeGreaterThan(rockInFront);
    expect(unitDepth(4000, false)).toBe(4000);
    expect(unitDepth(4100, true)).toBeGreaterThan(unitDepth(4000, true));
  });
});

describe('turret tracking and crystal depth', () => {
  it('GFX-10: a weapon keeps pointing at its target between shots; without one it uses the held shot aim, then the heading', () => {
    const from = { x: 10, y: 10 };
    expect(aimFacing(from, { x: 14, y: 10 }, 7, null, 16)).toBe(0); // target along +x
    expect(aimFacing(from, { x: 10, y: 14 }, 7, 2, 16)).toBe(4); // target along +y wins over a held aim
    expect(aimFacing(from, null, 7, 3, 16)).toBe(3);
    expect(aimFacing(from, null, 7, null, 16)).toBe(7);
  });

  it('GFX-11: a unit standing on a shard tile draws over its crystal; a unit behind the tile draws under it', () => {
    const tileCentreY = 400;
    expect(unitDepth(tileCentreY, false)).toBeGreaterThan(crystalDepth(tileCentreY));
    expect(unitDepth(tileCentreY - 16, false)).toBeLessThan(crystalDepth(tileCentreY));
  });
});

describe('snapshot targets', () => {
  it('GFX-10: own units report their attack target in the snapshot', () => {
    const g = createGame({ seed: 1, map: { width: 20, height: 20, heights: new Array<number>(400).fill(0) }, units: [{ owner: 0, kind: 'hum_tank', tx: 5, ty: 5 }, { owner: 1, kind: 'ali_brute', tx: 8, ty: 5 }] });
    const [tank, brute] = g.state.units;
    submit(g, { type: 'attack', player: 0, units: [tank!.id], target: brute!.id });
    tick(g);
    expect(snapshot(g, 0).units.find((u) => u.id === tank!.id)?.target).toBe(brute!.id);
  });
});
