import { describe, expect, it } from 'vitest';
import { unitDef } from '../../src/data/defs';
import { facingYaw } from '../../src/render/interp';
import { createGame, FP, hash, snapshot, submit, tick, type Game, type SimEvent, type UnitSpawn } from '../../src/sim';
import { dirDiff, dirOf, DIRS, FIRE_ARC, MOVE_ARC } from '../../src/sim/facing';

const W = 40;
const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: { width: W, height: W, heights: new Array<number>(W * W).fill(0) }, units });
const unit = (g: Game, kind: string, owner = 0) => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;
const at = (t: number): number => t * FP + FP / 2;

describe('heroes turn slowly', () => {
  it('HERO-5: facing is integer steps; directions and differences come out right', () => {
    expect(dirOf(1, 0)).toBe(0);
    expect(dirOf(0, 1)).toBe(DIRS / 4);
    expect(dirOf(-1, 0)).toBe(DIRS / 2);
    expect(dirOf(0, -1)).toBe((3 * DIRS) / 4);
    expect(dirOf(1, 1)).toBe(DIRS / 8);
    expect(dirOf(0, 0)).toBe(-1);
    expect(dirDiff(250, 4)).toBe(10);
    expect(dirDiff(4, 250)).toBe(-10);
    expect(Math.abs(dirDiff(0, 128))).toBe(128);
    for (const k of ['hum_paladin', 'ali_strider']) expect(unitDef(k).turnRate).toBe(2);
    expect(unitDef('hum_tank').turnRate).toBeUndefined();
    // The view turns the short way between two snapshots.
    expect(facingYaw(250, 2, 0.5)).toBeCloseTo((254 * Math.PI * 2) / 256);
  });

  it('HERO-5: a hero ordered behind it turns in place, at most 2 steps a tick, before it walks', () => {
    const g = game([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }]);
    const p = unit(g, 'hum_paladin');
    p.facing = 0; // facing +x
    const x0 = p.x;
    const y0 = p.y;
    submit(g, { type: 'move', player: 0, units: [p.id], x: at(8), y: at(20) }); // straight behind it
    let turned = -1;
    let prev = p.facing;
    for (let t = 0; t < 200; t++) {
      tick(g);
      expect(Math.abs(dirDiff(prev, p.facing))).toBeLessThanOrEqual(2);
      prev = p.facing;
      const moved = Math.hypot(p.x - x0, p.y - y0);
      if (Math.abs(dirDiff(p.facing, DIRS / 2)) > MOVE_ARC) expect(moved).toBeLessThan(FP / 8); // still turning on the spot
      else if (turned < 0) turned = t;
    }
    // A half turn takes over 3 s (60 ticks), and then it walks.
    expect(turned).toBeGreaterThanOrEqual((DIRS / 2 - MOVE_ARC) / 2 - 2);
    expect(p.x).toBeLessThan(x0 - 2 * FP);
    expect(snapshot(g, 0).units.find((u) => u.id === p.id)!.facing).toBe(p.facing);
  });

  it('HERO-5: a hero fires only at what it faces: a target behind it is shot only after the hero has turned round', () => {
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 },
      { owner: 1, kind: 'ali_brute', tx: 15, ty: 20 }, // behind, in range
    ]);
    const p = unit(g, 'hum_paladin');
    p.facing = 0;
    const firstShot: number[] = [];
    for (let t = 0; t < 200 && firstShot.length === 0; t++) {
      tick(g);
      if (g.state.events.some((e: SimEvent) => e.t === 'shot' && e.owner === 0 && e.weapon !== 'missile')) firstShot.push(t); // the pods have a wider arc (HERO-8)
    }
    expect(firstShot).toHaveLength(1);
    // It had to turn about half a circle first, at 2 steps a tick.
    expect(firstShot[0]!).toBeGreaterThanOrEqual((DIRS / 2 - FIRE_ARC) / 2 - 2);
    expect(Math.abs(dirDiff(p.facing, DIRS / 2))).toBeLessThanOrEqual(FIRE_ARC);
    // A tank, which does not turn slowly, fires at once.
    const t2 = game([
      { owner: 0, kind: 'hum_tank', tx: 20, ty: 20 },
      { owner: 1, kind: 'ali_brute', tx: 15, ty: 20 },
    ]);
    let tankShot = -1;
    for (let t = 0; t < 60 && tankShot < 0; t++) {
      tick(t2);
      if (t2.state.events.some((e) => e.t === 'shot' && e.owner === 0)) tankShot = t;
    }
    expect(tankShot).toBeGreaterThanOrEqual(0);
    expect(tankShot).toBeLessThan(firstShot[0]!);
  });

  it('HERO-5: smaller units never shove a hero along, and a hero does not step aside for allies', () => {
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 },
      { owner: 0, kind: 'hum_tank', tx: 14, ty: 20 },
      { owner: 1, kind: 'ali_gorger', tx: 21, ty: 20 },
    ]);
    const p = unit(g, 'hum_paladin');
    const x0 = p.x;
    const y0 = p.y;
    // An ally drives through it, and an enemy harvester sits pressed against it.
    submit(g, { type: 'move', player: 0, units: [unit(g, 'hum_tank').id], x: at(28), y: at(20) });
    for (let t = 0; t < 120; t++) tick(g);
    expect(Math.hypot(p.x - x0, p.y - y0)).toBeLessThan(FP / 16);
  });

  it('HERO-5: turning is deterministic and part of the state hash', () => {
    const play = (f: number): number => {
      const g = game([{ owner: 0, kind: 'ali_strider', tx: 20, ty: 20 }]);
      unit(g, 'ali_strider').facing = f;
      submit(g, { type: 'move', player: 0, units: [unit(g, 'ali_strider').id], x: at(5), y: at(30) });
      for (let t = 0; t < 100; t++) tick(g);
      return hash(g);
    };
    expect(play(0)).toBe(play(0));
    expect(play(0)).not.toBe(play(64));
  });
});
