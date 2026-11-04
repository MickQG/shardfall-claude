import { describe, expect, it } from 'vitest';
import { hpFraction, squadOffsets } from '../../src/render/gfx';
import { createGame, hash, maxHpOf, rankFor, snapshot, squadAlive, submit, tick, unitDamage, type Game, type MapDef, type UnitSpawn } from '../../src/sim';

const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: open(30, 30), units });
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};

describe('light infantry squads', () => {
  it('SQD-1: a squad of three loses a figure per third of health lost, keeping one while alive', () => {
    expect([100, 67, 66, 34, 33, 1].map((hp) => squadAlive('hum_rifleman', hp, 100))).toEqual([3, 3, 2, 2, 1, 1]);
    expect(squadAlive('hum_tank', 10, 550)).toBe(1); // not a squad
  });

  it('SQD-1: squad damage scales with the figures left; other units always deal full damage', () => {
    expect(unitDamage('hum_rifleman', 100, 0)).toBe(7);
    expect(unitDamage('hum_rifleman', 60, 0)).toBe(4);
    expect(unitDamage('hum_rifleman', 20, 0)).toBe(2);
    expect(unitDamage('hum_tank', 550, 0)).toBe(38);
    expect(unitDamage('hum_tank', 20, 0)).toBe(38);
  });

  it('SQD-1: in the simulation a battered squad hurts less than a fresh one', () => {
    const dealt = (hp: number): number => {
      const g = game([
        { owner: 0, kind: 'hum_rifleman', tx: 10, ty: 10 },
        { owner: 1, kind: 'ali_brute', tx: 13, ty: 10 },
      ]);
      const [rifle, brute] = g.state.units;
      rifle!.hp = hp;
      brute!.hp = 100000; // a punching bag; keep it out of melee
      brute!.mode = 'move';
      submit(g, { type: 'attack', player: 0, units: [rifle!.id], target: brute!.id });
      run(g, 60);
      return 100000 - brute!.hp;
    };
    expect(dealt(30)).toBeLessThan(dealt(100));
  });

  it('SQD-2: squads draw one figure per member around the lead', () => {
    expect(squadOffsets(3)).toHaveLength(3);
    expect(squadOffsets(1)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('veterancy', () => {
  it('VET-1: ranks come at 1x, 3x and 6x the unit cost in damage dealt', () => {
    expect([99, 100, 299, 300, 599, 600, 99999].map((xp) => rankFor('hum_rifleman', xp))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(rankFor('hum_tank', 799)).toBe(0);
    expect(rankFor('hum_tank', 800)).toBe(1);
  });

  it('VET-1: damage dealt to enemies earns experience and ranks the unit up, raising its health by the same share', () => {
    const g = game([
      { owner: 0, kind: 'hum_rifleman', tx: 10, ty: 10 },
      { owner: 1, kind: 'ali_gorger', tx: 13, ty: 10 },
    ]);
    const [rifle, gorger] = g.state.units;
    rifle!.xp = 99;
    rifle!.hp = 50;
    gorger!.mode = 'move';
    submit(g, { type: 'attack', player: 0, units: [rifle!.id], target: gorger!.id });
    run(g, 40);
    expect(rifle!.xp).toBeGreaterThan(99);
    expect(rifle!.rank).toBe(1);
    expect(rifle!.hp).toBe(55); // 50 of 100 becomes 55 of 110
  });

  it('VET-2: each rank adds 10% damage and maximum health; the top rank repairs itself out of combat', () => {
    expect(maxHpOf('hum_tank', 0)).toBe(550);
    expect(maxHpOf('hum_tank', 3)).toBe(715);
    expect(unitDamage('hum_tank', 550, 2)).toBe(45);
    const g = game([{ owner: 0, kind: 'hum_tank', tx: 10, ty: 10 }]);
    const tank = g.state.units[0]!;
    tank.rank = 3;
    tank.xp = 6 * 800;
    tank.hp = 300;
    run(g, 20 * 8);
    expect(tank.hp).toBeGreaterThan(300);
    expect(tank.hp).toBeLessThanOrEqual(715);
    const rookie = game([{ owner: 0, kind: 'hum_tank', tx: 10, ty: 10 }]);
    rookie.state.units[0]!.hp = 300;
    run(rookie, 20 * 8);
    expect(rookie.state.units[0]!.hp).toBe(300); // humans do not heal below the top rank
  });

  it('VET-3: snapshots carry each unit\'s rank, health bars use the ranked maximum, and experience is in the state hash', () => {
    const g = game([{ owner: 0, kind: 'hum_rifleman', tx: 10, ty: 10 }]);
    g.state.units[0]!.rank = 2;
    expect(snapshot(g, 0).units[0]!.rank).toBe(2);
    expect(hpFraction(60, 'hum_rifleman', 2)).toBe(0.5);
    const h = hash(g);
    g.state.units[0]!.xp += 1;
    expect(hash(g)).not.toBe(h);
  });
});
