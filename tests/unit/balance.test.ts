import { describe, expect, it } from 'vitest';
import { unitDef } from '../../src/data/defs';
import { mean, rounds, type Army } from './battle';

/** Average margin (human minus alien) over two army sizes, fought from both seats. */
const even = (human: Army, alien: Army): number => mean(rounds(human, alien), 'margin');

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
  }, 600_000);
});
