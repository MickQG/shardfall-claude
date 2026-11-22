import { describe, expect, it } from 'vitest';
import type { Difficulty } from '../../src/ai/ai';
import { unitDef, type Faction } from '../../src/data/defs';
import { aiRules } from './aiRules';
import { playMatches } from './pool';

/**
 * Full AI-vs-AI matches (#107): statistical checks that need whole games, run by `npm run test:matches` and by CI only
 * when the simulation, AI or data change (and on every push to main), not with the fast unit tests.
 *
 * For balance work (HAR-6) a bigger series: FACTION_SEEDS, a seed range such as `1-8` (default `1-2`, the CI series), and
 * MATCH_SHARD `k/n` to play only game i with i mod n equal to k - 1. A shard prints its tally and checks nothing.
 */

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');
const seeds = (): number[] => {
  const [a, b] = (env('FACTION_SEEDS') || '1-2').split('-').map(Number) as [number, number];
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
};

describe('faction balance in full matches', () => {
  it('ROS-4: equal hard AIs on every map, from both sides, and neither faction wins more than three quarters', async () => {
    const { DIFFICULTIES, printTally } = await import('./levels');
    const { MAPS } = await import('../../src/data/maps');
    const wins = { human: 0, alien: 0 };
    const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
    const games = MAPS.flatMap(({ id: map }) => seeds().flatMap((seed) => ([['human', 'alien'], ['alien', 'human']] as const).map((factions) => ({ seed, map, factions: [...factions] as [Faction, Faction], difficulties: [DIFFICULTIES.hard, DIFFICULTIES.hard] as [Difficulty, Difficulty], maxTicks: 20000, rules: aiRules() })))).filter((_, i) => i % n === k - 1);
    const results = await playMatches(games);
    results.forEach((r, i) => {
      const side = r.winner === null ? undefined : games[i]!.factions[r.winner];
      if (side) wins[side]++;
    });
    const decided = wins.human + wins.alien;
    const diag = results.map((r, i) => {
      const g = games[i]!;
      const side = (p: 0 | 1): string => {
        const k = ((r.traded[p] as unknown as { kinds?: Record<string, number> }).kinds ?? {});
        const prod = r.ai[p].produced;
        return `${g.factions[p] === 'human' ? 'A' : 'V'}: lost ${Object.entries(k).sort((x, y) => y[1] - x[1]).map(([kk, n]) => `${kk.replace(/^(hum|ali)_/, '')}${n}`).join(' ')} | prod i${prod.inf} at${prod.at} t${prod.tank} ar${prod.art}`;
      };
      return `DIAG ${g.map} s${g.seed} winner ${r.winner === null ? '-' : g.factions[r.winner] === 'human' ? 'A' : 'V'} t${r.ticks} || ${side(0)} || ${side(1)}`;
    });
    process.stdout.write(diag.join(String.fromCharCode(10)) + String.fromCharCode(10));
    await printTally([`ROS-4: Aegis ${wins.human} - Vrax ${wins.alien}, ${results.length - decided} undecided of ${results.length} (FACTION_SEEDS=${env('FACTION_SEEDS') || '-'} MATCH_SHARD=${env('MATCH_SHARD') || '-'})`]);
    if (env('MATCH_SHARD')) return;
    expect(decided).toBeGreaterThanOrEqual(8);
    expect(Math.max(wins.human, wins.alien)).toBeLessThanOrEqual(decided * 0.75);
    // The Vrax anti-armour infantry no longer outranges the Aegis army.
    expect(unitDef('ali_spitter').weapon!.range).toBe(unitDef('hum_rocketeer').weapon!.range);
    expect(unitDef('ali_spitter').buildTime).toBe(unitDef('hum_rocketeer').buildTime);
  }, 1_200_000);
});
