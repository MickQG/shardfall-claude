import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Personality } from '../../src/ai/ai';
import { playMatches } from './pool';

describe('AI artillery in full matches', () => {
  it('AI-19: against an infantry-heavy opponent artillery is a clearly larger share of the army value', async () => {
    const sides = [[1, 'human', 'alien'], [1, 'alien', 'human'], [2, 'human', 'alien']] as const;
    // Balanced against Raider (infantry-heavy), Medium against Medium, fourteen minutes.
    const rs = await playMatches(sides.map(([seed, a, b]) => ({ seed, factions: [a, b] as ['human' | 'alien', 'human' | 'alien'], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium] as [typeof DIFFICULTIES.medium, typeof DIFFICULTIES.medium], maxTicks: 20 * 60 * 14, personalities: ['balanced', 'raider'] as [Personality, Personality] })));
    const share = rs.map((r) => {
      const p = r.ai[0].produced;
      const v = [p.inf * 90, p.at * 235, p.tank * 815, p.art * 850, p.hero * 2000, p.scout * 235];
      return v[3]! / Math.max(1, v.reduce((a, b) => a + b, 0));
    });
    // Before AI-19 this was exactly 0 in all three games (measured on main); now about 0.18.
    for (const s of share) expect(s).toBeGreaterThan(0.08);
    expect(share.reduce((a, b) => a + b, 0) / share.length).toBeGreaterThan(0.12);
  }, 1_500_000);
});
