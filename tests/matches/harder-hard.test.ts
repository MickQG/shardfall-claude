import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Difficulty } from '../../src/ai/ai';
import type { MatchOptions } from '../../src/ai/harness';
import { playMatches } from './pool';

/** Full AI-vs-AI matches (#107, #136): the harder Hard against the Hard it replaced, and against Medium. */

describe('harder Hard in full matches', () => {
  it('AI-20: the new Hard is no weaker than the previous Hard and still clearly beats Medium', async () => {
    const previousHard: Difficulty = { name: 'hard', thinkEvery: 10, maxCommands: 10, bonus: 30 };
    type Game = { o: MatchOptions; swap: boolean; pair: string };
    const games: Game[] = [];
    const series = (pair: string, opp: Difficulty, seeds: number[]): void => {
      for (const seed of seeds)
        for (const factions of [['human', 'alien'], ['alien', 'human']] as const)
          for (const swap of [false, true]) {
            const d = swap ? [opp, DIFFICULTIES.hard] : [DIFFICULTIES.hard, opp];
            games.push({ o: { seed, factions: [factions[0], factions[1]], difficulties: [d[0]!, d[1]!], maxTicks: 12000 }, swap, pair });
          }
    };
    series('old', previousHard, [1, 2, 3, 4]);
    series('medium', DIFFICULTIES.medium, [1, 2, 3, 4, 5, 6, 7, 8]);
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
    // The new Hard is no weaker than the Hard it replaced (the step is small, so only a regression fails this) ...
    const old = tally('old');
    expect(old.a).toBeGreaterThanOrEqual(old.b - 2);
    // ... and beats Medium clearly: measured 25 to 4 over 32 games (baseline 25 to 2).
    const med = tally('medium');
    expect(med.a).toBeGreaterThanOrEqual(med.b * 3);
  }, 900_000);
});
