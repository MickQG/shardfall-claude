import { describe, expect, it } from 'vitest';
import { DIFFICULTIES } from '../../src/ai/ai';
import type { MatchOptions } from '../../src/ai/harness';
import { playMatches } from './pool';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

describe('difficulty in full matches', () => {
  it('HAR-3: across seeds and sides, Hard beats Easy, and Hard beats Medium more often than not', async () => {
    type Game = { o: MatchOptions; swap: boolean; pair: string };
    const games: Game[] = [];
    // Every pairing is played from both sides of the map and with both factions, so difficulty is not confused with faction or position.
    const series = (a: keyof typeof DIFFICULTIES, b: keyof typeof DIFFICULTIES, seeds: number[]): void => {
      for (const seed of seeds)
        for (const factions of [['human', 'alien'], ['alien', 'human']] as const)
          for (const swap of [false, true]) {
            const d = swap ? [DIFFICULTIES[b], DIFFICULTIES[a]] : [DIFFICULTIES[a], DIFFICULTIES[b]];
            games.push({ o: { seed, factions: [factions[0], factions[1]], difficulties: [d[0]!, d[1]!], maxTicks: 12000 }, swap, pair: `${a}-${b}` });
          }
    };
    series('hard', 'easy', [1]);
    series('hard', 'medium', [1, 2, 3]);
    const results = await playMatches(games.map((g) => g.o));
    const tally = (pair: string): { a: number; b: number } => {
      const t = { a: 0, b: 0 };
      results.forEach((r, i) => {
        const g = games[i]!;
        if (g.pair !== pair || r.winner === null) return;
        if ((r.winner === 0) !== g.swap) t.a++;
        else t.b++;
      });
      return t;
    };
    const hardEasy = tally('hard-easy');
    expect(hardEasy.a).toBeGreaterThanOrEqual(3); // of 4
    expect(hardEasy.a).toBeGreaterThan(hardEasy.b);
    const hardMedium = tally('hard-medium');
    expect(hardMedium.a).toBeGreaterThan(hardMedium.b);
  }, 600_000);
});
