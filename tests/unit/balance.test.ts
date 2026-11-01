import { describe, expect, it } from 'vitest';
import { unitDef } from '../../src/data/defs';
import { createGame, FP, submit, tick, type MapDef, type UnitSpawn } from '../../src/sim';

type Army = Record<string, number>;
const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
const cost = (a: Army): number => Object.entries(a).reduce((s, [k, n]) => s + unitDef(k).cost * n, 0);
const scale = (a: Army, budget: number): Army => Object.fromEntries(Object.entries(a).map(([k, n]) => [k, Math.max(1, Math.round((n * budget) / cost(a)))]));

/** Human value left minus alien value left, as a percent of the average army cost, after both attack-move into each other. */
function margin(human: Army, alien: Army, humanSeat: 0 | 1): number {
  const units: UnitSpawn[] = [];
  const place = (owner: number, army: Army, x0: number): void => {
    let i = 0;
    for (const [kind, n] of Object.entries(army)) for (let k = 0; k < n; k++, i++) units.push({ owner, kind, tx: x0 + (i % 4), ty: 18 + Math.floor(i / 4) });
  };
  place(humanSeat, human, humanSeat === 0 ? 10 : 34);
  place(1 - humanSeat, alien, humanSeat === 0 ? 34 : 10);
  const g = createGame({ seed: 1, map: open(48, 48), units });
  const ids = (p: number): number[] => g.state.units.filter((u) => u.owner === p).map((u) => u.id);
  submit(g, { type: 'attackmove', player: 0, units: ids(0), x: 44 * FP, y: 22 * FP });
  submit(g, { type: 'attackmove', player: 1, units: ids(1), x: 4 * FP, y: 22 * FP });
  for (let t = 0; t < 20 * 180 && ids(0).length && ids(1).length; t++) tick(g);
  const value = (p: number): number => g.state.units.filter((u) => u.owner === p).reduce((s, u) => s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0);
  return (100 * (value(humanSeat) - value(1 - humanSeat))) / ((cost(human) + cost(alien)) / 2);
}

/** Average margin over two army sizes, fought from both seats. */
const even = (human: Army, alien: Army): number => {
  const m = [1600, 3200].flatMap((b) => [0, 1].map((seat) => margin(scale(human, b), scale(alien, b), seat as 0 | 1)));
  return m.reduce((s, x) => s + x, 0) / m.length;
};

describe('faction balance', () => {
  const cases: [string, Army, Army][] = [
    ['rifle infantry', { hum_rifleman: 1 }, { ali_skitter: 1 }],
    ['scouts', { hum_buggy: 1 }, { ali_stalker: 1 }],
    ['anti-armour infantry', { hum_rocketeer: 1 }, { ali_spitter: 1 }],
    ['tanks', { hum_tank: 1 }, { ali_brute: 1 }],
    ['mixed army', { hum_tank: 3, hum_rocketeer: 4, hum_rifleman: 6 }, { ali_brute: 3, ali_spitter: 4, ali_skitter: 8 }],
  ];
  for (const [name, human, alien] of cases) {
    it(`ROS-3: equal-cost ${name} fights end within 20% of even`, () => {
      expect(Math.abs(even(human, alien))).toBeLessThan(20);
    }, 60_000);
  }
});

describe('faction balance in full matches', () => {
  it('ROS-4: equal hard AIs on every map, from both sides, and neither faction wins more than three quarters', async () => {
    const { DIFFICULTIES } = await import('../../src/ai/ai');
    const { playMatch } = await import('../../src/ai/harness');
    const { MAPS } = await import('../../src/data/maps');
    const wins = { human: 0, alien: 0 };
    for (const { id: map } of MAPS)
      for (const seed of [1, 2])
        for (const factions of [['human', 'alien'], ['alien', 'human']] as const) {
          const r = playMatch({ seed, map, factions: [...factions], difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard], maxTicks: 20000 });
          const side = r.winner === null ? undefined : factions[r.winner];
          if (side) wins[side]++;
        }
    const decided = wins.human + wins.alien;
    expect(decided).toBeGreaterThanOrEqual(8);
    expect(Math.max(wins.human, wins.alien)).toBeLessThanOrEqual(decided * 0.75);
    // The Vrax anti-armour infantry no longer outranges the Aegis army.
    expect(unitDef('ali_spitter').weapon!.range).toBe(unitDef('hum_rocketeer').weapon!.range);
    expect(unitDef('ali_spitter').buildTime).toBe(unitDef('hum_rocketeer').buildTime);
  }, 300_000);
});
