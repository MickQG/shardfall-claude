import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Difficulty } from '../../src/ai/ai';
import { DIFFICULTIES } from './levels';
import type { MatchOptions, MatchResult } from '../../src/ai/harness';
import type { Faction } from '../../src/data/defs';
import { MAPS } from '../../src/data/maps';
import { aiRules } from './aiRules';
import { playMatches } from './pool';

/**
 * The standing scout in full matches (AI-21, #175): two equal Balanced AIs on every map, Aegis against Vrax both ways
 * round (so each faction plays from both sides), seeds 1 and 2: 12 games, 24 AIs. It prints a tally of how the scouts
 * fare and how much of the enemy army each AI keeps in sight, and adds it to the CI job summary.
 *
 * Environment (all optional):
 * - SCOUT_DIFFICULTY: `hard` or `medium` (default), both AIs;
 * - SCOUT_STANDING: `0` turns the standing scout off, to measure the old scouting with the same statistics;
 * - MATCH_SHARD: `k/n`, to play only game i with i mod n equal to k - 1, so CI can split the series.
 */

// Targets for AI-21 (issue #175), set from the measured series (12 games each, every map, both sides). They apply with
// the standing scout on. Measured at Hard: 1.0 scouts lost per AI per game (old scouting 2.7), alive at least 95% of the
// time, coverage 51% (old 44%); at Medium: 1.1 lost (old 3.1), alive about 96%, coverage 45% (old 40%).
/** Hard: scouts lost per AI per game, on average, at most; share of sampled time a standing scout is alive, at least; mean intel coverage, at least. */
export const HARD_LOST = 2;
export const HARD_ALIVE = 0.85;
export const HARD_COVERAGE = 0.4;
/** Medium: the same. */
export const MEDIUM_LOST = 2.5;
export const MEDIUM_ALIVE = 0.8;
export const MEDIUM_COVERAGE = 0.36;

/** Twelve minutes: scouting, the first waves and the middle game. */
export const SCOUT_TICKS = 20 * 60 * 12;
const SERIES_TIMEOUT = 2_400_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');
const level = (): 'hard' | 'medium' => (env('SCOUT_DIFFICULTY') === 'hard' ? 'hard' : 'medium');
const standing = (): boolean => env('SCOUT_STANDING') !== '0';

const sides: [Faction, Faction][] = [
  ['human', 'alien'],
  ['alien', 'human'],
];

export function scoutGames(): MatchOptions[] {
  const d = DIFFICULTIES[level()];
  const both: [Difficulty, Difficulty] = [d, d];
  const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
  const all = MAPS.flatMap(({ id: map }) => [1, 2].flatMap((seed) => sides.map((factions): MatchOptions => ({ seed, map, factions, difficulties: both, maxTicks: SCOUT_TICKS, standingScout: standing(), rules: aiRules() }))));
  return all.filter((_, i) => i % n === k - 1);
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

export interface ScoutTally {
  ais: number;
  /** Scouts lost (standing scouts and units sent scouting) per AI per game: mean and most. */
  lostMean: number;
  lostMax: number;
  /** Scout units trained per AI per game. */
  trainedMean: number;
  /** Median life of a standing scout in seconds: the lost ones, and the ones alive at the end, counted to the end. */
  standingLife: number;
  /** Share of sampled time a standing scout was alive: mean and worst AI. */
  aliveMean: number;
  aliveWorst: number;
  /** Intel coverage (value of the enemy army it saw within 60 s over its true value): mean and worst AI. */
  coverageMean: number;
  coverageWorst: number;
}

export function scoutTally(rs: readonly MatchResult[]): ScoutTally {
  const ais = rs.flatMap((r) => [0, 1].map((p) => ({ s: r.ai[p]!, w: r.watch[p]!, end: r.ticks })));
  const lives = ais.flatMap(({ s, end }) => [...s.standingLives, ...(s.standingSince >= 0 ? [end - s.standingSince] : [])]);
  const lost = ais.map(({ s }) => s.scoutsLost);
  const sampled = ais.filter(({ w }) => w.samples > 0);
  return {
    ais: ais.length,
    lostMean: mean(lost),
    lostMax: Math.max(0, ...lost),
    trainedMean: mean(ais.map(({ s }) => s.produced.scout)),
    standingLife: median(lives) / 20,
    aliveMean: mean(sampled.map(({ w }) => w.alive)),
    aliveWorst: Math.min(1, ...sampled.map(({ w }) => w.alive)),
    coverageMean: mean(sampled.map(({ w }) => w.coverage)),
    coverageWorst: Math.min(1, ...sampled.map(({ w }) => w.coverage)),
  };
}

const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;

function report(t: ScoutTally, games: number, minutes: number): void {
  const out = [
    `AI-21: ${level()} against ${level()}, Balanced, standing scout ${standing() ? 'on' : 'OFF'}, every map, ${games} games, ${t.ais} AIs (MATCH_SHARD=${env('MATCH_SHARD') || '-'}), ${SCOUT_TICKS} ticks at most, played in ${minutes.toFixed(1)} min`,
    `scouts lost per AI per game: mean ${t.lostMean.toFixed(2)}, most ${t.lostMax}; scout units trained per AI per game: mean ${t.trainedMean.toFixed(2)}`,
    `standing scout: median life ${Number.isNaN(t.standingLife) ? '-' : `${t.standingLife.toFixed(1)} s`}; alive ${pct(t.aliveMean)} of sampled time on average, worst AI ${pct(t.aliveWorst)}`,
    `intel coverage (enemy army value seen within 60 s, sampled every 10 s from minute 4): mean ${pct(t.coverageMean)}, worst AI ${pct(t.coverageWorst)}`,
  ];
  // Written straight to stdout: the runner holds back console.log output of a passing test.
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('the standing scout in full matches', () => {
  it('AI-21: on every map and from both sides, the scout survives and the AI keeps the enemy army in sight', async () => {
    const started = Date.now();
    const rs = await playMatches(scoutGames());
    const t = scoutTally(rs);
    report(t, rs.length, (Date.now() - started) / 60000);
    for (const r of rs) {
      for (const w of r.watch) {
        expect(w.coverage).toBeGreaterThanOrEqual(0);
        expect(w.coverage).toBeLessThanOrEqual(1);
        expect(w.alive).toBeGreaterThanOrEqual(0);
        expect(w.alive).toBeLessThanOrEqual(1);
      }
    }
    if (!standing()) return; // the old scouting, measured for comparison only
    const hard = level() === 'hard';
    expect(t.lostMean).toBeLessThanOrEqual(hard ? HARD_LOST : MEDIUM_LOST);
    expect(t.aliveMean).toBeGreaterThanOrEqual(hard ? HARD_ALIVE : MEDIUM_ALIVE);
    expect(t.coverageMean).toBeGreaterThanOrEqual(hard ? HARD_COVERAGE : MEDIUM_COVERAGE);
  }, SERIES_TIMEOUT);
});
