import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Personality } from '../../src/ai/ai';
import type { MatchResult } from '../../src/ai/harness';
import { playMatches } from './pool';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 */

const LONG = 900_000;
const SIDES = [
  [1, ['human', 'alien']],
  [1, ['alien', 'human']],
  [2, ['human', 'alien']],
  [2, ['alien', 'human']],
  [3, ['human', 'alien']],
  [3, ['alien', 'human']],
] as const;

/** Ten minutes covers Raider's opening and Balanced's comparison; Doomsday needs fourteen for its strikes to land. */
const SERIES_TICKS = { raider: 20 * 60 * 10, balanced: 20 * 60 * 10, doomsday: 20 * 60 * 14 } as const;

/** Player 0 plays `p` against a Balanced player 1, Medium against Medium, from every seed and side; cached per personality. */
const cache = new Map<string, Promise<MatchResult[]>>();
function series(p: Personality): Promise<MatchResult[]> {
  const key = p;
  const hit = cache.get(key);
  if (hit) return hit;
  const rs = playMatches(SIDES.map(([seed, f]) => ({ seed, factions: [f[0], f[1]], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium], maxTicks: SERIES_TICKS[p], personalities: [p, 'balanced'] as [Personality, Personality] })));
  cache.set(key, rs);
  return rs;
}
const never = (t: number): number => (t < 0 ? Infinity : t);

describe('AI personalities in full matches', () => {
  it('AI-14: Raider attacks before minute 4, mostly at the enemy economy in its first eight minutes', async () => {
    const [rs, b] = await Promise.all([series('raider'), series('balanced')]);
    for (const r of rs) {
      expect(r.ai[0].firstWaveAt).toBeGreaterThanOrEqual(0);
      expect(r.ai[0].firstWaveAt).toBeLessThan(20 * 60 * 4);
    }
    const early = rs.reduce((s, r) => s + r.ai[0].earlyWaves, 0);
    const economy = rs.reduce((s, r) => s + r.ai[0].economyWaves, 0);
    expect(economy * 2).toBeGreaterThan(early);
    // Balanced does not single out the economy.
    expect(b.reduce((s, r) => s + r.ai[0].economyWaves, 0) * 2).toBeLessThan(b.reduce((s, r) => s + r.ai[0].earlyWaves, 0) + 1);
  }, LONG);

  it('AI-15: Doomsday stands its superweapon first, and its army reaches the struck area within about ten seconds of the strike', async () => {
    const [d, b] = await Promise.all([series('doomsday'), series('balanced')]);
    d.forEach((m, i) => {
      expect(m.ai[0].superweaponAt).toBeGreaterThanOrEqual(0);
      expect(m.ai[0].superweaponAt).toBeLessThan(never(b[i]!.ai[0].superweaponAt));
    });
    const arrivals = d.filter((m) => m.ai[0].strikeAt >= 0).map((m) => never(m.ai[0].strikeArrival)).sort((x, y) => x - y);
    expect(arrivals.length).toBeGreaterThanOrEqual(4);
    expect(arrivals[Math.floor((arrivals.length - 1) / 2)]).toBeLessThanOrEqual(20 * 10);
  }, LONG);
});
