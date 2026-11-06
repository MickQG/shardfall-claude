import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Difficulty } from '../../src/ai/ai';
import type { MatchOptions } from '../../src/ai/harness';
import type { Faction } from '../../src/data/defs';
import { MAPS } from '../../src/data/maps';
import { playMatches } from './pool';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

const medium: [Difficulty, Difficulty] = [DIFFICULTIES.medium, DIFFICULTIES.medium];
const sides: [Faction, Faction][] = [
  ['human', 'alien'],
  ['alien', 'human'],
];

describe('scouting in full matches', () => {
  it('AI-17: on every map and from both sides, every AI has found an enemy building by minute 4', async () => {
    const games: MatchOptions[] = MAPS.flatMap(({ id: map }) => [1, 2].flatMap((seed) => sides.map((factions) => ({ seed, map, factions, difficulties: medium, maxTicks: 20 * 60 * 4 }))));
    const results = await playMatches(games);
    results.forEach((r, i) => {
      for (const p of [0, 1] as const) {
        const at = r.ai[p].scoutedAt;
        const g = games[i]!;
        expect(at, `${g.map} seed ${g.seed} ${g.factions.join('/')} player ${p}`).toBeGreaterThanOrEqual(0);
        expect(at).toBeLessThanOrEqual(20 * 60 * 4);
      }
    });
  });
});

describe('generated maps in full matches', () => {
  it('MAP-8: both AIs build their bases and fight on generated maps', async () => {
    const seeds = [11, 2024, 777777];
    const results = await playMatches(seeds.map((mapSeed) => ({ seed: 3, factions: sides[0]!, difficulties: medium, maxTicks: 20 * 60 * 7, map: 'generated' as const, mapSeed })));
    results.forEach((r, i) => {
      expect(r.ai[0].waves + r.ai[1].waves, `map seed ${seeds[i]}`).toBeGreaterThan(0);
      expect(r.orders[0]).toBeGreaterThan(50);
      expect(r.orders[1]).toBeGreaterThan(50);
    });
  });
});
