import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PERSONALITIES, type Personality } from '../../src/ai/ai';
import { lengthReport, playMatch, type MatchOptions, type MatchResult } from '../../src/ai/harness';
import { STEAMROLL_DIFFICULTY, STEAMROLL_TUNING, TANKSPAM, type SteamrollTuning } from '../../src/ai/steamroll';
import { aiRules, rulesLine } from './aiRules';
import { DIFFICULTIES, levelsLine } from './levels';
import { playMatches } from './pool';
import { variant } from './variant';

/**
 * The Hard AI as Vrax against the tank-spam opponent (HAR-7, AI-32): Aegis massing Bulwark Tanks that kite, without Field
 * Menders and with them in its ball. Each personality, seeds 1 to 8, from both seats: 16 games a personality and flavour,
 * one test each, so CI plays each as its own job.
 *
 * Environment (all optional; unset means everything):
 * - STEAMROLL_SEEDS: a seed range, such as `1-2` (default `1-8`);
 * - STEAMROLL_SEAT: `0` or `1`, the Hard AI's seat;
 * - STEAMROLL_VARIANT: further changes to the opponent, as in the steamroll series (HAR-5);
 * - AI_RULES: changes to the Hard AI's rules (AiRules), such as `noChase:0` (see aiRules.ts);
 * - LEVELS: changes to the difficulty levels (AI-28), such as `hard:8:12:20`;
 * - MATCH_SHARD: `k/n`, to play only the k-th of n shares of the selected games.
 * Pick a series with `-t "no menders raider"` (or `with menders balanced`, ...).
 */

/** As long as the steamroll series (HAR-5): its games turn on the opponent's big attack. */
export const TANKSPAM_TICKS = 20 * 60 * 20;

export type Flavour = 'no menders' | 'with menders';
export const FLAVOURS: readonly Flavour[] = ['no menders', 'with menders'];

/**
 * The pass mark (AI-32): wins of each personality's 16 games against each flavour, at least; floors under what was
 * measured, near the owner's mark of about half.
 */
export const PASS_WINS: Readonly<Record<Flavour, Readonly<Record<Personality, number>>>> = {
  'no menders': { raider: 5, balanced: 5, doomsday: 5 },
  'with menders': { raider: 5, balanced: 5, doomsday: 5 },
};

const SERIES_TIMEOUT = 3_000_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');

/** The opponent of a flavour: the tank-spam variant, with or without Menders, and the environment's changes. */
export const tuningOf = (f: Flavour): Partial<SteamrollTuning> => ({ ...TANKSPAM, menders: f === 'with menders' ? 1 : 0, ...variant() });

export interface TankspamGame {
  o: MatchOptions;
  seat: 0 | 1;
}

export function tankspamGames(p: Personality, f: Flavour): TankspamGame[] {
  const [a, b] = (env('STEAMROLL_SEEDS') || '1-8').split('-').map(Number) as [number, number];
  const seeds = Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
  const seats = ([0, 1] as const).filter((s) => !env('STEAMROLL_SEAT') || env('STEAMROLL_SEAT') === String(s));
  const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
  const all = seeds.flatMap((seed) =>
    seats.map((seat): TankspamGame => ({
      seat,
      o: {
        seed,
        factions: seat === 0 ? ['alien', 'human'] : ['human', 'alien'],
        difficulties: seat === 0 ? [DIFFICULTIES.hard, STEAMROLL_DIFFICULTY] : [STEAMROLL_DIFFICULTY, DIFFICULTIES.hard],
        personalities: seat === 0 ? [p, 'balanced'] : ['balanced', p],
        opponents: seat === 0 ? ['ai', 'steamroll'] : ['steamroll', 'ai'],
        steamroll: tuningOf(f),
        rules: aiRules(),
        maxTicks: TANKSPAM_TICKS,
      },
    })),
  );
  return all.filter((_, i) => i % n === k - 1);
}

const played = new Map<string, Promise<{ games: TankspamGame[]; results: MatchResult[] }>>();
function series(p: Personality, f: Flavour): Promise<{ games: TankspamGame[]; results: MatchResult[] }> {
  const key = `${p}/${f}`;
  let hit = played.get(key);
  if (!hit) {
    const games = tankspamGames(p, f);
    hit = playMatches(games.map((g) => g.o)).then((results) => ({ games, results }));
    played.set(key, hit);
  }
  return hit;
}

function tally(games: readonly TankspamGame[], rs: readonly MatchResult[]): { wins: number; losses: number; undecided: number } {
  const t = { wins: 0, losses: 0, undecided: 0 };
  rs.forEach((r, i) => {
    if (r.winner === null) t.undecided++;
    else if (r.winner === games[i]!.seat) t.wins++;
    else t.losses++;
  });
  return t;
}

const minutes = (ticks: number): string => (ticks / 1200).toFixed(1);

function report(p: Personality, f: Flavour, games: readonly TankspamGame[], rs: readonly MatchResult[], took: number): void {
  const t = tally(games, rs);
  const shard = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_SEAT', 'STEAMROLL_VARIANT', 'AI_RULES', 'LEVELS'].map((k) => `${k}=${env(k) || '-'}`).join(' ');
  const lengths = lengthReport(rs.map((r) => r.ticks));
  const ai = rs.map((r, i) => r.ai[games[i]!.seat]!);
  const sum = (g: (s: (typeof ai)[number]) => number): number => ai.reduce((n, s) => n + g(s), 0);
  const out = [
    `HAR-7 ${p} ${f}: Hard AI as Vrax against the tank-spam opponent, ${rs.length} games (${shard}), tuning ${JSON.stringify({ ...STEAMROLL_TUNING, ...tuningOf(f) })}, played in ${took.toFixed(1)} min`,
    levelsLine(),
    rulesLine(),
    `AI-32 tankspam ${f} ${p}: Hard AI ${t.wins} won ${t.losses} lost ${t.undecided} undecided`,
    `length: median ${lengths.median.toFixed(1)} min, ${lengths.min.toFixed(1)} to ${lengths.max.toFixed(1)}`,
    `AI: produced skimmers/at ${sum((s) => s.produced.at)}, tanks ${sum((s) => s.produced.tank)}, inf ${sum((s) => s.produced.inf)}, scouts ${sum((s) => s.produced.scout)}; scouts lost ${sum((s) => s.scoutsLost)}; hit squads ${sum((s) => s.hitSquads)}, tank-ball raids ${sum((s) => s.ballRaids)}; Brutes held back ${sum((s) => s.heldBack)}`,
    ...rs.map((r, i) => {
      const g = games[i]!;
      const opp = r.ai[1 - g.seat]!.steamroll;
      const who = r.winner === null ? 'undecided' : r.winner === g.seat ? 'AI won' : 'AI lost';
      return `seed ${g.o.seed} seat ${g.seat}: ${who} (${r.reason}) at ${minutes(r.ticks)} min; opponent attacks ${opp?.launches.length ?? 0}, first ${opp?.launches[0] ? `${minutes(opp.launches[0].tick)} min ${opp.launches[0].value} cr ${opp.launches[0].crushers} crushers` : 'none'}; peak army AI ${r.peak.armyValue[g.seat]} / opponent ${r.peak.armyValue[1 - g.seat]}`;
    }),
  ];
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('the Hard AI as Vrax against the tank-spam opponent', () => {
  for (const f of FLAVOURS) {
    for (const p of PERSONALITIES) {
      it(`HAR-7: tankspam ${f} ${p}: the opponent plays Aegis, trains crushers and only the squads its Menders carry, kites, attacks, and replays the same game`, async () => {
        const started = Date.now();
        const { games, results: rs } = await series(p, f);
        report(p, f, games, rs, (Date.now() - started) / 60000);
        rs.forEach((r, i) => {
          const g = games[i]!;
          const s = r.ai[1 - g.seat]!;
          const where = `${p} ${f} seed ${g.o.seed} seat ${g.seat}`;
          expect(g.o.factions[1 - g.seat], where).toBe('human');
          expect({ art: s.produced.art, air: s.produced.air, scout: s.produced.scout, hero: s.produced.hero }, where).toEqual({ art: 0, air: 0, scout: 0, hero: 0 });
          expect(s.produced.tank, where).toBeGreaterThan(0);
          expect(s.retreats, where).toBe(0);
          // Its barracks train its opening's rifles and, with Menders, the squads they carry: never more squads than that.
          if (f === 'no menders') expect(s.produced.at, where).toBe(0);
        });
        // Its crushers kite.
        expect(rs.reduce((n, r, i) => n + (r.ai[1 - games[i]!.seat]!.steamroll?.kites ?? 0), 0)).toBeGreaterThan(0);
        const short = rs.reduce((b, r, i) => (r.ticks < rs[b]!.ticks ? i : b), 0);
        const again = playMatch(games[short]!.o);
        expect(again.hash).toBe(rs[short]!.hash);
      }, SERIES_TIMEOUT);

      const full = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_SEAT', 'STEAMROLL_VARIANT', 'AI_RULES', 'LEVELS'].every((k) => !env(k));
      it.skipIf(!full)(`AI-32: tankspam ${f} ${p}: the Hard AI as Vrax wins at least ${PASS_WINS[f][p]} of its 16 games`, async () => {
        const { games, results: rs } = await series(p, f);
        expect(rs).toHaveLength(16);
        expect(tally(games, rs).wins).toBeGreaterThanOrEqual(PASS_WINS[f][p]);
      }, SERIES_TIMEOUT);
    }
  }
});
