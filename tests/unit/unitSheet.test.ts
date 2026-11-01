import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UNIT_DEFS } from '../../src/data/defs';
import { CYCLE_MS, fitDistance, MINE_MS, MOVE_MS, PREVIEW_PACE, previewBeat, SETTLE_MS, shotEvery, tilesPerSecond } from '../../src/render3d/preview3d';
import { UNIT_RIGS } from '../../src/render3d/units3d';
import { firepower, statFill, statMax, unitCards, unitStats } from '../../src/ui/unitInfo';
import { factsHtml } from '../../src/ui/unitSheet';

const card = (faction: 'human' | 'alien', name: string) => {
  const c = unitCards(faction).find((x) => x.name === name);
  if (!c) throw new Error(`no card ${name}`);
  return c;
};

describe('unit sheet', () => {
  it('INF-6: every unit kind has an in-game 3D model to show, and the sheet names where it is trained and what it needs', () => {
    for (const kind of Object.keys(UNIT_DEFS).filter((k) => k.startsWith('hum_') || k.startsWith('ali_'))) expect(UNIT_RIGS[kind], kind).toBeDefined();
    expect(card('human', 'Paladin')).toMatchObject({ trainedAt: 'Motor Pool', needs: ['Tech Lab'] });
    expect(card('human', 'Rifleman')).toMatchObject({ trainedAt: 'Garrison', needs: [] });
    expect(card('alien', 'Brute').trainedAt).toBe('Brood Pit');
  });

  it('INF-6: the preview moves along a weaving course, stops, then works: armed units fire, harvesters mine and unload and never fire', () => {
    expect(previewBeat(100, false).act).toBe('move');
    // The course weaves either way, so the hull turns and banks as it does on the map.
    const steers = Array.from({ length: 40 }, (_, i) => previewBeat((i * MOVE_MS) / 40, false).steer);
    expect(Math.max(...steers)).toBeGreaterThan(0.4);
    expect(Math.min(...steers)).toBeLessThan(-0.4);
    expect(previewBeat(MOVE_MS + 10, false).act).toBe('settle');
    expect(previewBeat(MOVE_MS + SETTLE_MS + 50, false)).toEqual({ act: 'fire', into: 50, steer: 0 });
    expect(previewBeat(MOVE_MS + SETTLE_MS + 50, true)).toEqual({ act: 'mine', into: 50, steer: 0 });
    expect(previewBeat(MOVE_MS + SETTLE_MS + MINE_MS + 20, true)).toEqual({ act: 'unload', into: 20, steer: 0 });
    const acts = new Set(Array.from({ length: 400 }, (_, i) => previewBeat((i * CYCLE_MS) / 400, true).act));
    expect([...acts].sort()).toEqual(['mine', 'move', 'settle', 'unload']);
    expect(previewBeat(CYCLE_MS + 100, true)).toEqual(previewBeat(100, true));
  });

  it("INF-6: the preview runs the unit at its match speed and fire rate, through the game's own motion, squad and effects code", () => {
    // Speed is fixed-point units (256 a tile) per tick (20 a second).
    expect(tilesPerSecond(UNIT_DEFS.hum_tank!.speed)).toBeCloseTo((34 * 20) / 256);
    expect(shotEvery(UNIT_DEFS.hum_rifleman!)).toBe(500);
    expect(shotEvery(UNIT_DEFS.hum_artillery!)).toBe(3000);
    // A calm pace: the close-up camera makes match speed look hurried.
    expect(PREVIEW_PACE).toBeGreaterThan(0.25);
    expect(PREVIEW_PACE).toBeLessThan(0.5);
    const src = readFileSync('src/render3d/preview3d.ts', 'utf8');
    // Shots fly out to the weapon's range instead of landing beside the plinth.
    expect(src).toContain('w?.range');
    for (const call of ['follow(', 'stepMotion(', 'bodyPose(', 'stepSquad(', 'readyToFire(', 'recoil(', 'fx.muzzle(', 'fx.shot(', 'fx.harvest(']) expect(src, call).toContain(call);
  });

  it('INF-6: the camera fits the model in any canvas shape', () => {
    // A tall, narrow canvas needs the camera further back than a square one; a wide one no further than square.
    expect(fitDistance(1, 0.6)).toBeGreaterThan(fitDistance(1, 1));
    expect(fitDistance(1, 2)).toBeCloseTo(fitDistance(1, 1));
    expect(fitDistance(2, 1)).toBeCloseTo(2 * fitDistance(1, 1));
  });

  it('INF-7: health, speed, range and firepower come from the definitions; firepower counts squad figures', () => {
    const rifle = UNIT_DEFS.hum_rifleman!;
    expect(firepower(rifle)).toBeCloseTo(((rifle.weapon!.damage * 3 * 20) / rifle.weapon!.cooldown), 1);
    expect(unitStats(UNIT_DEFS.hum_paladin!)).toEqual({ health: 3000, speed: 32, range: 7, firepower: 61.1 });
    expect(card('human', 'Shard Hauler').stats).toMatchObject({ range: 0, firepower: 0 });
  });

  it('INF-7: bars fill by the square root of the share of the largest value across both factions', () => {
    const max = statMax();
    expect(max.health).toBe(3000);
    expect(statFill(3000, 3000)).toBe(1);
    expect(statFill(750, 3000)).toBeCloseTo(0.5);
    expect(statFill(0, 3000)).toBe(0);
    const html = factsHtml(card('human', 'Paladin'), max);
    expect(html).toContain('Paladin');
    expect(html).toContain('width:100.0%');
    expect(html).toContain('61.1/s');
    expect(html).toContain('Trained at:</b> Motor Pool · needs Tech Lab');
    expect(factsHtml(card('human', 'Shard Hauler'), max)).toContain('Cannot attack');
  });

  it('INF-8: the menu loads no 3D code; the sheet imports the preview only on demand', () => {
    for (const f of ['src/ui/menu.ts', 'src/ui/unitSheet.ts', 'src/ui/unitInfo.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from 'three'/);
      expect(src).not.toMatch(/^import [^t].*render3d/m);
    }
    expect(readFileSync('src/ui/unitSheet.ts', 'utf8')).toContain("import('../render3d/preview3d')");
  });
});
