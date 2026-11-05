import { unitDef } from '../../src/data/defs';
import { crushOrders } from '../../src/ai/ai';
import { createGame, FP, snapshot, submit, tick, type MapDef, type UnitSpawn } from '../../src/sim';

/** Headless battle harness shared by the balance tests (ROS-3, BAL-9). */
export type Army = Record<string, number>;
export const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
export const cost = (a: Army): number => Object.entries(a).reduce((s, [k, n]) => s + unitDef(k).cost * n, 0);
export const scale = (a: Army, budget: number): Army => Object.fromEntries(Object.entries(a).map(([k, n]) => [k, Math.max(1, Math.round((n * budget) / cost(a)))]));

export interface Result {
  /** Side A's value left minus side B's, as a percent of the average army cost. */
  margin: number;
  /** Percent of each side's value destroyed. */
  aLost: number;
  bLost: number;
  /** Squads run over by a crusher (BAL-1). */
  crushed: number;
}

/**
 * Armies A and B attack-move into each other on open ground; A starts on the left in seat 0, or on the right in seat 1.
 * With `micro`, both sides also give the AI's crush orders every 10 ticks (BAL-5).
 */
export function battle(a: Army, b: Army, seat: 0 | 1, micro = false): Result {
  const units: UnitSpawn[] = [];
  const place = (owner: number, army: Army, x0: number): void => {
    let i = 0;
    for (const [kind, n] of Object.entries(army)) for (let k = 0; k < n; k++, i++) units.push({ owner, kind, tx: x0 + (i % 4), ty: 18 + Math.floor(i / 4) });
  };
  place(seat, a, seat === 0 ? 10 : 34);
  place(1 - seat, b, seat === 0 ? 34 : 10);
  const g = createGame({ seed: 1, map: open(48, 48), units });
  const ids = (p: number): number[] => g.state.units.filter((u) => u.owner === p).map((u) => u.id);
  submit(g, { type: 'attackmove', player: 0, units: ids(0), x: 44 * FP, y: 22 * FP });
  submit(g, { type: 'attackmove', player: 1, units: ids(1), x: 4 * FP, y: 22 * FP });
  let crushed = 0;
  for (let t = 0; t < 20 * 180 && ids(0).length && ids(1).length; t++) {
    if (micro && t % 10 === 0) {
      for (const p of [0, 1]) {
        const s = snapshot(g, p);
        for (const c of crushOrders(p, s.units.filter((u) => u.owner === p), s.units.filter((u) => u.owner !== p), 48, 48)) submit(g, c);
      }
    }
    tick(g);
    for (const e of g.state.events) if (e.t === 'die' && e.crushed) crushed++;
  }
  const value = (p: number): number => g.state.units.filter((u) => u.owner === p).reduce((s, u) => s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0);
  const va = value(seat);
  const vb = value(1 - seat);
  return { margin: (100 * (va - vb)) / ((cost(a) + cost(b)) / 2), aLost: 100 * (1 - va / cost(a)), bLost: 100 * (1 - vb / cost(b)), crushed };
}

/** Results over two army sizes, fought from both seats. */
export const rounds = (a: Army, b: Army, micro = false): Result[] => [1600, 3200].flatMap((budget) => [0, 1].map((seat) => battle(scale(a, budget), scale(b, budget), seat as 0 | 1, micro)));

export const mean = (rs: Result[], k: keyof Result): number => rs.reduce((s, r) => s + r[k], 0) / rs.length;
