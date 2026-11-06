import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../src/ai/ai';
import { unitDef, type Faction } from '../../src/data/defs';
import { playMatches } from './pool';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

describe('faction balance in full matches', () => {
  it('ROS-4: equal hard AIs on every map, from both sides, and neither faction wins more than three quarters', async () => {
    const { DIFFICULTIES } = await import('../../src/ai/ai');
    const { MAPS } = await import('../../src/data/maps');
    const wins = { human: 0, alien: 0 };
    const games = MAPS.flatMap(({ id: map }) => [1, 2].flatMap((seed) => ([['human', 'alien'], ['alien', 'human']] as const).map((factions) => ({ seed, map, factions: [...factions] as [Faction, Faction], difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard] as [Difficulty, Difficulty], maxTicks: 20000 }))));
    const results = await playMatches(games);
    results.forEach((r, i) => {
      const side = r.winner === null ? undefined : games[i]!.factions[r.winner];
      if (side) wins[side]++;
    });
    const decided = wins.human + wins.alien;
    expect(decided).toBeGreaterThanOrEqual(8);
    expect(Math.max(wins.human, wins.alien)).toBeLessThanOrEqual(decided * 0.75);
    // The Vrax anti-armour infantry no longer outranges the Aegis army.
    expect(unitDef('ali_spitter').weapon!.range).toBe(unitDef('hum_rocketeer').weapon!.range);
    expect(unitDef('ali_spitter').buildTime).toBe(unitDef('hum_rocketeer').buildTime);
  }, 1_200_000);
});
