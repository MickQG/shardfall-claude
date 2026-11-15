import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, INTEL_FROM, type AiStats, type Difficulty } from '../../src/ai/ai';
import type { MatchOptions, MatchResult } from '../../src/ai/harness';
import type { Faction } from '../../src/data/defs';
import { MAPS } from '../../src/data/maps';
import { playMatches } from './pool';

/**
 * The standing scout in full matches (AI-21, #175): Medium against Medium, Balanced, on every map, Aegis against Vrax
 * both ways round (so each faction plays from both sides), seeds 1 and 2: 12 games, 24 AIs. It prints a tally of how
 * the scouts fare and how fresh each AI's sightings of the enemy army are, and adds it to the CI job summary.
 *
 * MATCH_SHARD=k/n (optional) plays only game i with i mod n equal to k - 1, so CI can split the series.
 */

/** Twelve minutes: scouting, the first waves and the middle game. */
export const SCOUT_TICKS = 20 * 60 * 12;
const SERIES_TIMEOUT = 2_400_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');

const medium: [Difficulty, Difficulty] = [DIFFICULTIES.medium, DIFFICULTIES.medium];
const sides: [Faction, Faction][] = [
  ['human', 'alien'],
  ['alien', 'human'],
];

export function scoutGames(): MatchOptions[] {
  const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
  const all = MAPS.flatMap(({ id: map }) => [1, 2].flatMap((seed) => sides.map((factions): MatchOptions => ({ seed, map, factions, difficulties: medium, maxTicks: SCOUT_TICKS }))));
  return all.filter((_, i) => i % n === k - 1);
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** Every scouting term of one AI, in ticks: finished ones, and the ones still running at the end of the match. */
const lifetimes = (s: AiStats, end: number): number[] => [...s.scoutLifetimes, ...s.scoutingSince.map((t) => end - t)];
const freshShare = (s: AiStats): number => (s.intelThinks > 0 ? s.intelFresh / s.intelThinks : 0);

export interface ScoutTally {
  ais: number;
  /** Median scouting term in seconds, over every AI's terms. */
  medianLife: number;
  /** Scouts lost per AI per game: mean and most. */
  lostMean: number;
  lostMax: number;
  /** Share of decisions from minute 5 on with a sighting of an armed enemy unit at most 60 s old: median and worst AI. */
  freshMedian: number;
  freshWorst: number;
}

export function scoutTally(rs: readonly MatchResult[]): ScoutTally {
  const stats = rs.flatMap((r) => r.ai.map((s) => ({ s, end: r.ticks })));
  const lives = stats.flatMap(({ s, end }) => lifetimes(s, end));
  const lost = stats.map(({ s }) => s.scoutsLost);
  const fresh = stats.map(({ s }) => freshShare(s));
  return {
    ais: stats.length,
    medianLife: median(lives) / 20,
    lostMean: lost.reduce((a, b) => a + b, 0) / Math.max(1, lost.length),
    lostMax: Math.max(0, ...lost),
    freshMedian: median(fresh),
    freshWorst: Math.min(1, ...fresh),
  };
}

function report(t: ScoutTally, games: number, minutes: number): void {
  const out = [
    `AI-21: Medium against Medium, Balanced, every map, ${games} games, ${t.ais} AIs (MATCH_SHARD=${env('MATCH_SHARD') || '-'}), ${SCOUT_TICKS} ticks at most, played in ${minutes.toFixed(1)} min`,
    `scout lifetime: median ${t.medianLife.toFixed(1)} s`,
    `scouts lost per AI per game: mean ${t.lostMean.toFixed(2)}, most ${t.lostMax}`,
    `intel fresh (armed enemy seen within 60 s, from minute 5): median ${(100 * t.freshMedian).toFixed(1)}%, worst ${(100 * t.freshWorst).toFixed(1)}%`,
  ];
  // Written straight to stdout: the runner holds back console.log output of a passing test.
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('the standing scout in full matches', () => {
  it('AI-21: on every map and from both sides, scouting statistics are reported (measurement)', async () => {
    const started = Date.now();
    const games = scoutGames();
    const rs = await playMatches(games);
    const t = scoutTally(rs);
    report(t, rs.length, (Date.now() - started) / 60000);
    for (const r of rs) {
      for (const s of r.ai) {
        expect(s.scoutsLost).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(s.scoutLifetimes)).toBe(true);
        if (r.ticks > INTEL_FROM + 100) expect(s.intelThinks).toBeGreaterThan(0);
        expect(freshShare(s)).toBeGreaterThanOrEqual(0);
        expect(freshShare(s)).toBeLessThanOrEqual(1);
      }
    }
  }, SERIES_TIMEOUT);
});
