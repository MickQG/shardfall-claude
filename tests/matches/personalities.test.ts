import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, SUPERWEAPON_ARMY, SUPERWEAPON_HAULERS, type Personality } from '../../src/ai/ai';
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
  // Eight games: Doomsday's superweapon is optional (AI-15), so it strikes in only some of them.
  [4, ['human', 'alien']],
  [4, ['alien', 'human']],
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
    // Raider singles out the economy more than Balanced, whose waves go for whatever building is nearest.
    const share = (ms: MatchResult[]): number => ms.reduce((t, r) => t + r.ai[0].economyWaves, 0) / Math.max(1, ms.reduce((t, r) => t + r.ai[0].earlyWaves, 0));
    expect(share(rs)).toBeGreaterThan(share(b));
  }, LONG);

  it('AI-15: Doomsday techs up first, fields more tanks, artillery and heroes but keeps rifles, builds its superweapon only when strong, and wins its share', async () => {
    const [d, b] = await Promise.all([series('doomsday'), series('balanced')]);
    // Value of what it trained: tanks, artillery and heroes against everything (unit costs of either faction, roughly).
    const value = (r: MatchResult): { tech: number; all: number } => {
      const p = r.ai[0].produced;
      const v = { inf: p.inf * 90, at: p.at * 235, tank: p.tank * 815, art: p.art * 850, hero: p.hero * 2000, air: 0, scout: p.scout * 235 };
      return { tech: v.tank + v.art + v.hero, all: Object.values(v).reduce((t, x) => t + x, 0) };
    };
    const share = (ms: MatchResult[]): number => ms.reduce((t, r) => t + value(r).tech / Math.max(1, value(r).all), 0) / ms.length;
    d.forEach((m, i) => {
      // Its lab before Balanced's, in every game.
      expect(m.ai[0].labAt).toBeGreaterThanOrEqual(0);
      expect(m.ai[0].labAt).toBeLessThan(never(b[i]!.ai[0].labAt));
      // Rifles to answer enemy infantry.
      expect(m.ai[0].produced.inf).toBeGreaterThanOrEqual(2);
      // A superweapon only with a strong army and a working economy.
      const o = m.ai[0].superweaponOrder;
      if (o) {
        expect(o.army).toBeGreaterThanOrEqual(SUPERWEAPON_ARMY);
        expect(o.haulers).toBeGreaterThanOrEqual(SUPERWEAPON_HAULERS);
      }
    });
    expect(share(d)).toBeGreaterThan(share(b) + 0.04);
    // It does go for the superweapon when it can, and times its attack with the strike.
    const arrivals = d.filter((m) => m.ai[0].strikeAt >= 0).map((m) => never(m.ai[0].strikeArrival)).sort((x, y) => x - y);
    expect(arrivals.length).toBeGreaterThanOrEqual(2);
    expect(arrivals[Math.floor((arrivals.length - 1) / 2)]).toBeLessThanOrEqual(20 * 10);
    // A fair opponent: it wins at least three of eight games against Balanced.
    expect(d.filter((m) => m.winner === 0).length).toBeGreaterThanOrEqual(3);
  }, LONG);
});
