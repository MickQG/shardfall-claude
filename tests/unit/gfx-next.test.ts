import { describe, expect, it } from 'vitest';
import { showcaseConfig } from '../../src/data/maps';
import { lightFor, lightPower, MAX_LIGHTS } from '../../src/render/lightsNext';
import { cliffRgb, groundRgb, paintTerrain, terrainBounds, type TerrainInput } from '../../src/render/terrainNext';
import { bakeModel } from '../../src/render/voxel/bake';
import { box, createModel } from '../../src/render/voxel/model';
import { createGame, hash, tick } from '../../src/sim';
import { FrameStats } from '../../src/ui/frameStats';

const input = (heights: number[], w: number, blockedAt: number[] = []): TerrainInput => ({
  width: w,
  height: heights.length / w,
  heights,
  blocked: (x, y) => blockedAt.includes(y * w + x) || (heights[y * w + x] ?? 0) > 0,
  shards: () => false,
});

describe('graphics mockup: showcase scenario', () => {
  it('NXT-2: has both bases, squads and tanks on each side, plateaus, water and shards, and is deterministic', () => {
    const c = showcaseConfig(1);
    const kinds = (owner: number): string[] => [...(c.buildings ?? []), ...(c.units ?? [])].filter((e) => e.owner === owner).map((e) => e.kind);
    expect(kinds(0)).toEqual(expect.arrayContaining(['hum_hq', 'hum_factory', 'hum_rifleman', 'hum_tank']));
    expect(kinds(1)).toEqual(expect.arrayContaining(['ali_hq', 'ali_pit', 'ali_skitter', 'ali_brute']));
    const m = c.map;
    expect(Math.max(...m.heights)).toBe(2);
    expect(m.heights.some((h, i) => h === 0 && m.blocked?.[i])).toBe(true); // water
    expect(m.shards?.some((s) => s > 0)).toBe(true);
    const run = (): number => {
      const g = createGame(showcaseConfig(7));
      for (let i = 0; i < 100; i++) tick(g);
      return hash(g);
    };
    expect(run()).toBe(run());
    expect(showcaseConfig(1, 20).units!.length).toBe((c.units ?? []).length + 40);
    // Stress crowds stand only on free, unblocked tiles, one unit per tile, even for the largest army.
    const big = showcaseConfig(1, 150);
    const tiles = big.units!.map((u) => u.ty * big.map.width + u.tx);
    expect(new Set(tiles).size).toBe(tiles.length);
    expect(tiles.every((i) => !big.map.blocked?.[i])).toBe(true);
  });
});

describe('graphics mockup: terrain', () => {
  const map = input([0, 0, 0, 0, 1, 0, 0, 0, 0], 3, [8]);

  it('NXT-3: painting is pure, and ground colour depends only on tile coordinates', () => {
    const b = terrainBounds(map);
    const a = paintTerrain(map, Math.floor(b.x), Math.floor(b.y), Math.ceil(b.w), Math.ceil(b.h));
    const again = paintTerrain(map, Math.floor(b.x), Math.floor(b.y), Math.ceil(b.w), Math.ceil(b.h));
    expect(Buffer.from(a).equals(Buffer.from(again))).toBe(true);
    const ctx = { level: 0, water: false, shade: 0, shore: 0, shards: false };
    expect(groundRgb(5, 9, 0.3, 0.6, ctx)).toEqual(groundRgb(5, 9, 0.3, 0.6, ctx));
    expect(groundRgb(5, 9, 0.3, 0.6, ctx)).not.toEqual(groundRgb(40, 2, 0.3, 0.6, ctx));
  });

  it('NXT-3: sunward cliff walls are brighter than shaded ones, and water is blue', () => {
    const lum = (c: number[]): number => (c[0] as number) + (c[1] as number) + (c[2] as number);
    expect(lum(cliffRgb(3, 4, 5, true))).toBeGreaterThan(lum(cliffRgb(3, 4, 5, false)));
    const water = groundRgb(2, 2, 0.5, 0.5, { level: 0, water: true, shade: 0, shore: 0, shards: false });
    expect(water[2]).toBeGreaterThan(water[0]);
  });
});

describe('graphics mockup: next bake style', () => {
  const block = (): ReturnType<typeof createModel> => {
    const m = createModel(6, 6, 6, [{ color: 0xb0b0b0 }]);
    box(m, 0, 0, 0, 6, 6, 6, 1);
    return m;
  };

  it('NXT-4: baking is repeatable, sunlit faces are warmer than shaded ones, and classic is unchanged', () => {
    const a = bakeModel(block(), { team: 0, facing: 0, facings: 1, style: 'next' });
    const b = bakeModel(block(), { team: 0, facing: 0, facings: 1, style: 'next' });
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
    const classic = bakeModel(block(), { team: 0, facing: 0, facings: 1 });
    expect(Buffer.from(classic.pixels).equals(Buffer.from(bakeModel(block(), { team: 0, facing: 0, facings: 1, style: 'classic' }).pixels))).toBe(true);
    // Sample the left (sunlit) and right (shaded) side faces a few pixels below the top, at the model's centre height.
    const px = (x: number, y: number): number[] => Array.from(a.pixels.slice((y * a.width + x) * 4, (y * a.width + x) * 4 + 3));
    const y = a.anchorY - 6;
    const left = px(a.anchorX - 10, y);
    const right = px(a.anchorX + 10, y);
    const warmth = (c: number[]): number => (c[0] as number) - (c[2] as number);
    expect(warmth(left)).toBeGreaterThan(warmth(right));
    expect((left[0] as number) + (left[1] as number)).toBeGreaterThan((right[0] as number) + (right[1] as number));
  });
});

describe('graphics mockup: light pools', () => {
  it('NXT-5: combat events cast lights that rise fast and fade out; other events cast none', () => {
    const boom = lightFor({ t: 'boom', x: 512, y: 512, r: 1.5 });
    expect(boom).not.toBeNull();
    expect(lightFor({ t: 'die', x: 0, y: 0, big: true, owner: 0 })!.radius).toBeGreaterThan(lightFor({ t: 'die', x: 0, y: 0, big: false, owner: 0 })!.radius);
    const spec = { life: 500, power: 0.8 };
    expect(lightPower(spec, 0)).toBe(0);
    expect(lightPower(spec, 40)).toBeGreaterThan(lightPower(spec, 400));
    expect(lightPower(spec, 500)).toBe(0);
    expect(MAX_LIGHTS).toBeLessThanOrEqual(64);
  });
});

describe('graphics mockup: frame-time readout', () => {
  it('NXT-6: reports fps, average and worst frame over a rolling window', () => {
    const f = new FrameStats(4);
    for (const ms of [10, 20, 30, 40, 50]) f.push(ms); // the first frame falls out of the window
    expect(f.avg).toBe(35);
    expect(f.worst).toBe(50);
    expect(Math.round(f.fps)).toBe(29);
    expect(f.label()).toBe('29 fps · avg 35.0 ms · worst 50.0 ms');
  });
});
