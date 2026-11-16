import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Difficulty } from '../../src/ai/ai';
import { DIFFICULTIES } from './levels';
import { ECONOMY_MINUTES, lengthReport, type EconomyAt, type EconomyLog, type MatchOptions, type MatchResult, type Violations } from '../../src/ai/harness';
import type { Faction } from '../../src/data/defs';
import { MAPS } from '../../src/data/maps';
import { aiRules } from './aiRules';
import { playMatches } from './pool';

/**
 * Economy and production scale in full matches (AI-22, #181): Medium against Medium, Balanced, on every map, Aegis
 * against Vrax both ways round (so each faction plays from both sides), seeds 1 and 2: 12 games, 24 AIs. It prints a
 * tally of each AI's refineries, haulers, production buildings, turrets, lab, bank and army at each of ECONOMY_MINUTES,
 * the shards it gathered, when its second and third factory stood, the refineries lost, the harness violations (HAR-2)
 * and the match lengths, and adds it to the CI job summary.
 *
 * MATCH_SHARD=k/n (optional) plays only game i with i mod n equal to k - 1, so CI can split the series.
 */

// The targets of AI-22 (production first), Medium against Medium:
/** The second factory stands by this minute, at the median over every AI. */
export const FACTORY2_BY = 3.5;
/** Production buildings (barracks and factories) at minute 6, at the median, at least. */
export const PRODUCTION_AT_6 = 6;
/** HAR-2 violations per game, both AIs together, at most (the harness's own rule, scripts/harness.ts). */
export const VIOLATIONS_PER_GAME = 2;

/** Fourteen minutes: the opening, the middle game and the minute-12 record. */
export const ECONOMY_TICKS = 20 * 60 * 14;
const SERIES_TIMEOUT = 2_400_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');

const medium: [Difficulty, Difficulty] = [DIFFICULTIES.medium, DIFFICULTIES.medium];
const sides: [Faction, Faction][] = [
  ['human', 'alien'],
  ['alien', 'human'],
];

export function economyGames(): MatchOptions[] {
  const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
  const all = MAPS.flatMap(({ id: map }) => [1, 2].flatMap((seed) => sides.map((factions): MatchOptions => ({ seed, map, factions, difficulties: medium, maxTicks: ECONOMY_TICKS, rules: aiRules() }))));
  return all.filter((_, i) => i % n === k - 1);
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
};

/** One minute's figures over every AI whose match reached it. */
export interface MinuteTally {
  minute: number;
  /** AIs whose match reached this minute, and how many of them had lost a refinery by then. */
  ais: number;
  lostRefinery: number;
  refineries: { median: number; worst: number };
  haulers: { median: number; worst: number };
  production: { median: number; worst: number };
  barracks: { median: number; most: number };
  factories: { median: number; most: number };
  gathered: { median: number; worst: number };
  turrets: { median: number; most: number };
  /** AIs with a lab standing. */
  labs: number;
  /** Credits banked, credits paid into queues not started, and the two together. */
  credits: { median: number; most: number };
  queued: { median: number; most: number };
  idle: { median: number; most: number };
  /** Army value alive (credits, by health). */
  army: { median: number; worst: number };
  /** Among the AIs that had not lost a refinery by then: how many, and how many had at least three refineries and more than eight haulers. */
  intact: number;
  scaled: number;
}

export interface EconomyTally {
  games: number;
  minutes: MinuteTally[];
  /** Minute its second and third factory stood: median over every AI (one that never had it counts as never), latest, and how many never had it. */
  factory2: { median: number; latest: number; never: number };
  factory3: { median: number; latest: number; never: number };
  /** HAR-2 violations summed over every AI. */
  violations: Violations;
  /** Match length in minutes (capped by ECONOMY_TICKS). */
  length: { median: number; min: number; max: number };
}

const at = (r: MatchResult, p: number, minute: number): EconomyAt | undefined => r.economy[p]?.at.find((a) => a.minute === minute);
const lostBy = (r: MatchResult, p: number, minute: number): boolean => {
  const t = r.economy[p]?.refineryLostAt ?? -1;
  return t >= 0 && t <= minute * 20 * 60;
};

export function economyTally(rs: readonly MatchResult[]): EconomyTally {
  const minutes = ECONOMY_MINUTES.map((minute): MinuteTally => {
    const rows = rs.flatMap((r) => [0, 1].map((p) => ({ e: at(r, p, minute), lost: lostBy(r, p, minute) }))).filter((x): x is { e: EconomyAt; lost: boolean } => x.e !== undefined);
    const col = (f: (e: EconomyAt) => number): number[] => rows.map(({ e }) => f(e));
    const intact = rows.filter((x) => !x.lost);
    return {
      minute,
      ais: rows.length,
      lostRefinery: rows.filter((x) => x.lost).length,
      refineries: { median: median(col((e) => e.refineries)), worst: Math.min(...col((e) => e.refineries)) },
      haulers: { median: median(col((e) => e.haulers)), worst: Math.min(...col((e) => e.haulers)) },
      production: { median: median(col((e) => e.barracks + e.factories)), worst: Math.min(...col((e) => e.barracks + e.factories)) },
      barracks: { median: median(col((e) => e.barracks)), most: Math.max(...col((e) => e.barracks)) },
      factories: { median: median(col((e) => e.factories)), most: Math.max(...col((e) => e.factories)) },
      gathered: { median: median(col((e) => e.gathered)), worst: Math.min(...col((e) => e.gathered)) },
      turrets: { median: median(col((e) => e.turrets)), most: Math.max(...col((e) => e.turrets)) },
      labs: rows.filter(({ e }) => e.lab).length,
      credits: { median: median(col((e) => e.credits)), most: Math.max(...col((e) => e.credits)) },
      queued: { median: median(col((e) => e.queued)), most: Math.max(...col((e) => e.queued)) },
      idle: { median: median(col((e) => e.credits + e.queued)), most: Math.max(...col((e) => e.credits + e.queued)) },
      army: { median: median(col((e) => e.army)), worst: Math.min(...col((e) => e.army)) },
      intact: intact.length,
      scaled: intact.filter(({ e }) => e.refineries >= 3 && e.haulers > 8).length,
    };
  });
  const violations: Violations = { idleHauler: 0, stuck: 0, powerOutage: 0, hoard: 0, undefended: 0, suicide: 0, lone: 0 };
  for (const r of rs) for (const v of r.violations) for (const k of Object.keys(violations) as (keyof Violations)[]) violations[k] += v[k];
  const len = lengthReport(rs.map((r) => r.ticks));
  const stood = (f: (log: EconomyLog) => number): { median: number; latest: number; never: number } => {
    const ts = rs.flatMap((r) => r.economy.map(f));
    const min = ts.map((t) => (t < 0 ? Infinity : t / 1200));
    return { median: median(min), latest: Math.max(...min.filter(Number.isFinite), 0), never: ts.filter((t) => t < 0).length };
  };
  return { games: rs.length, minutes, factory2: stood((l) => l.factory2At), factory3: stood((l) => l.factory3At), violations, length: { median: len.median, min: len.min, max: len.max } };
}

function report(t: EconomyTally, minutes: number): void {
  const v = t.violations;
  const out = [
    `AI-22: Medium against Medium, Balanced, every map, ${t.games} games (MATCH_SHARD=${env('MATCH_SHARD') || '-'}), ${ECONOMY_TICKS} ticks at most, played in ${minutes.toFixed(1)} min`,
    ...t.minutes.map(
      (m) =>
        `minute ${m.minute}: ${m.ais} AIs (${m.lostRefinery} had lost a refinery); refineries median ${m.refineries.median} worst ${m.refineries.worst}; haulers median ${m.haulers.median} worst ${m.haulers.worst}; ` +
        `production buildings median ${m.production.median} worst ${m.production.worst} (barracks median ${m.barracks.median} most ${m.barracks.most}, factories median ${m.factories.median} most ${m.factories.most}); ` +
        `gathered median ${Math.round(m.gathered.median)} worst ${m.gathered.worst}; with no refinery lost, ${m.scaled} of ${m.intact} had 3+ refineries and 9+ haulers; ` +
        `turrets median ${m.turrets.median} most ${m.turrets.most}; lab in ${m.labs} of ${m.ais}; banked median ${m.credits.median} most ${m.credits.most}; ` +
        `in queues not started median ${m.queued.median} most ${m.queued.most}; banked and queued median ${m.idle.median} most ${m.idle.most}; army alive median ${m.army.median} worst ${m.army.worst}`,
    ),
    `second factory stood: median minute ${t.factory2.median.toFixed(1)}, latest ${t.factory2.latest.toFixed(1)}, ${t.factory2.never} AIs never; third: median ${t.factory3.median.toFixed(1)}, latest ${t.factory3.latest.toFixed(1)}, ${t.factory3.never} never`,
    `HAR-2 violations, all AIs: idle haulers ${v.idleHauler}, stuck ${v.stuck}, power outage ${v.powerOutage}, hoard ${v.hoard}, undefended ${v.undefended}, suicide ${v.suicide}, lone ${v.lone}`,
    `match length (capped at ${ECONOMY_TICKS / 1200} min): median ${t.length.median.toFixed(1)}, shortest ${t.length.min.toFixed(1)}, longest ${t.length.max.toFixed(1)} min`,
  ];
  // Written straight to stdout: the runner holds back console.log output of a passing test.
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('economy and production scale in full matches', () => {
  it('AI-22: on every map and from both sides, the AI builds production first: its second factory by minute 3.5 and six production buildings by minute 6', async () => {
    const started = Date.now();
    const rs = await playMatches(economyGames());
    const t = economyTally(rs);
    report(t, (Date.now() - started) / 60000);
    // Sanity only: the records are taken in order, at the minutes the match reached.
    for (const r of rs) {
      for (const log of r.economy) {
        expect(log.at.map((a) => a.minute)).toEqual(ECONOMY_MINUTES.filter((m) => m * 1200 <= r.ticks));
        for (const a of log.at) {
          for (const n of [a.refineries, a.haulers, a.barracks, a.factories, a.turrets, a.credits, a.queued, a.army, a.gathered]) expect(n).toBeGreaterThanOrEqual(0);
        }
        if (log.factory3At >= 0) expect(log.factory2At).toBeGreaterThanOrEqual(0);
        if (log.factory3At >= 0) expect(log.factory3At).toBeGreaterThanOrEqual(log.factory2At);
      }
    }
    // The targets of AI-22 (see above).
    expect(t.factory2.median).toBeLessThanOrEqual(FACTORY2_BY);
    const six = t.minutes.find((m) => m.minute === 6);
    if (six && six.ais > 0) expect(six.production.median).toBeGreaterThanOrEqual(PRODUCTION_AT_6);
    const v = t.violations;
    expect(v.idleHauler + v.stuck + v.powerOutage + v.hoard + v.undefended + v.suicide + v.lone).toBeLessThanOrEqual(VIOLATIONS_PER_GAME * t.games);
  }, SERIES_TIMEOUT);
});
