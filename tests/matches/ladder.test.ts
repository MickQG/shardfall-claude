import { describe, expect, it } from 'vitest';
import type { MatchOptions } from '../../src/ai/harness';
import { DIFFICULTIES, printTally, type Level } from './levels';
import { playMatches } from './pool';

/** Full AI-vs-AI matches (#107, #187): the difficulty ladder, each level against the one below it. */

/** Twenty minutes: the levels are close together, and few games between them are decided in ten. */
const CAP = 20 * 60 * 20;

describe('the difficulty ladder in full matches', () => {
  it('AI-28: Hard beats Medium more often than not, and Medium beats Easy more often than not', async () => {
    type Game = { o: MatchOptions; swap: boolean; pair: string };
    const games: Game[] = [];
    // Every pairing is played with both factions and from both sides of the map, so difficulty is not confused with either.
    const series = (a: Level, b: Level, seeds: number[]): void => {
      for (const seed of seeds)
        for (const factions of [['human', 'alien'], ['alien', 'human']] as const)
          for (const swap of [false, true]) {
            const d = swap ? [DIFFICULTIES[b], DIFFICULTIES[a]] : [DIFFICULTIES[a], DIFFICULTIES[b]];
            games.push({ o: { seed, factions: [factions[0], factions[1]], difficulties: [d[0]!, d[1]!], maxTicks: CAP }, swap, pair: `${a}-${b}` });
          }
    };
    series('hard', 'medium', [1, 2, 3, 4]);
    series('medium', 'easy', [1, 2]);
    const results = await playMatches(games.map((g) => g.o));
    const tally = (pair: string): { a: number; b: number; undecided: number } => {
      const t = { a: 0, b: 0, undecided: 0 };
      results.forEach((r, i) => {
        const g = games[i]!;
        if (g.pair !== pair) return;
        if (r.winner === null) t.undecided++;
        else if ((r.winner === 0) !== g.swap) t.a++;
        else t.b++;
      });
      return t;
    };
    const hardMedium = tally('hard-medium');
    const mediumEasy = tally('medium-easy');
    await printTally([`AI-28 ladder: hard ${hardMedium.a} - medium ${hardMedium.b} (${hardMedium.undecided} undecided) of 16; medium ${mediumEasy.a} - easy ${mediumEasy.b} (${mediumEasy.undecided} undecided) of 8`]);
    expect(hardMedium.a).toBeGreaterThan(hardMedium.b);
    expect(mediumEasy.a).toBeGreaterThan(mediumEasy.b);
  }, 2_400_000);
});
