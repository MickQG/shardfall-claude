import { describe, expect, it } from 'vitest';
import { createGame, FP, hash, submit, tick, type Game, type UnitSpawn } from '../../src/sim';

const W = 30;
const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: { width: W, height: W, heights: new Array<number>(W * W).fill(0) }, units });
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const unit = (g: Game, kind: string, owner = 0) => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;
const moveEast = (g: Game, kind: string, tx: number): void =>
  submit(g, { type: 'move', player: 0, units: [unit(g, kind).id], x: tx * FP + FP / 2, y: 10 * FP + FP / 2 });

/** A tank drives east along row 10 through a unit standing on its path; where the blocker ends up, and when the tank arrives. */
function drive(blockerOwner: number, blockerKind = 'hum_hauler', offset = 0) {
  const g = game([
    { owner: 0, kind: 'hum_tank', tx: 4, ty: 10 },
    { owner: blockerOwner, kind: blockerKind, tx: 10, ty: 10 },
  ]);
  const b = unit(g, blockerKind, blockerOwner);
  b.y += offset;
  const start = { x: b.x, y: b.y };
  moveEast(g, 'hum_tank', 18);
  let arrived = -1;
  for (let t = 0; t < 400 && arrived < 0; t++) {
    tick(g);
    const tank = unit(g, 'hum_tank');
    if (Math.floor(tank.x / FP) === 18 && tank.path.length === 0) arrived = t;
  }
  return { dx: (b.x - start.x) / FP, dy: (b.y - start.y) / FP, arrived };
}

describe('allies make way', () => {
  it('SIM-9: an ally standing in a moving unit path steps aside, at right angles, instead of being shoved ahead', () => {
    const r = drive(0);
    // Out of the way to the side, not pushed along the row ahead of the tank.
    expect(Math.abs(r.dy)).toBeGreaterThan(0.4);
    expect(Math.abs(r.dx)).toBeLessThan(0.5);
    expect(r.arrived).toBeGreaterThan(0);
  });

  it('SIM-9: the mover keeps its pace: it arrives as soon as with nobody in the way', () => {
    const clear = game([{ owner: 0, kind: 'hum_tank', tx: 4, ty: 10 }]);
    moveEast(clear, 'hum_tank', 18);
    let t0 = -1;
    for (let t = 0; t < 400 && t0 < 0; t++) {
      tick(clear);
      const tank = unit(clear, 'hum_tank');
      if (Math.floor(tank.x / FP) === 18 && tank.path.length === 0) t0 = t;
    }
    expect(drive(0).arrived).toBeLessThanOrEqual(t0 + 2);
  });

  it('SIM-9: the ally steps to the side it already stands on', () => {
    expect(drive(0, 'hum_hauler', 20).dy).toBeGreaterThan(0.4);
    expect(drive(0, 'hum_hauler', -20).dy).toBeLessThan(-0.4);
  });

  it('SIM-9: enemies do not make way, and an ally behind the mover is not moved aside', () => {
    // An enemy is only pushed apart: shoved along, not stepping aside as an ally does.
    const enemy = drive(1, 'ali_gorger');
    expect(Math.abs(enemy.dy)).toBeLessThan(Math.abs(drive(0).dy));
    // A unit behind a mover driving away from it stays put.
    const g = game([
      { owner: 0, kind: 'hum_tank', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_hauler', tx: 10, ty: 10 },
    ]);
    const h = unit(g, 'hum_hauler');
    h.x -= FP / 2;
    moveEast(g, 'hum_tank', 20);
    run(g, 60);
    expect(Math.abs(unit(g, 'hum_hauler').y - 10 * FP - FP / 2)).toBeLessThan(FP / 4);
  });

  it('SIM-9: an ally shooting at a target holds its ground', () => {
    const g = game([
      { owner: 0, kind: 'hum_tank', tx: 4, ty: 10 },
      { owner: 0, kind: 'hum_hauler', tx: 10, ty: 10 },
    ]);
    const h = unit(g, 'hum_hauler');
    h.target = 999; // engaged
    const y0 = h.y;
    moveEast(g, 'hum_tank', 18);
    run(g, 120);
    expect(Math.abs(unit(g, 'hum_hauler').y - y0)).toBeLessThan(FP / 4);
  });

  it('SIM-9: making way is deterministic', () => {
    const play = (): number => {
      const g = game([
        { owner: 0, kind: 'hum_tank', tx: 4, ty: 10 },
        { owner: 0, kind: 'hum_rifleman', tx: 10, ty: 10 },
        { owner: 0, kind: 'hum_hauler', tx: 12, ty: 10 },
      ]);
      moveEast(g, 'hum_tank', 18);
      run(g, 200);
      return hash(g);
    };
    expect(play()).toBe(play());
  });
});
