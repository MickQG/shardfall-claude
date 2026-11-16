import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APPROACHES, DEFAULT_RULES, DIFFICULTIES, PERSONALITIES, type Personality } from '../../src/ai/ai';
import { lengthReport, playMatch, type ArmyAt, type EconomyAt, type MatchOptions, type MatchResult } from '../../src/ai/harness';
import { STEAMROLL_DIFFICULTY, STEAMROLL_TUNING, type SteamrollTuning } from '../../src/ai/steamroll';
import type { Faction } from '../../src/data/defs';
import { aiRules, rulesLine } from './aiRules';
import { playMatches } from './pool';

/**
 * The Hard AI against the steamroll opponent (HAR-5, #174): each personality, seeds 1 to 8, Aegis against Vrax both ways
 * round and from both seats, 96 games, one test per personality. Later slices (#175 to #177) add their win-rate checks
 * to these same series.
 *
 * CI plays it in shards, chosen by environment variables (all optional; unset means everything):
 * - STEAMROLL_SEEDS: a seed range, such as `1-2` (default `1-8`);
 * - STEAMROLL_AI_FACTION: `human` or `alien`, the Hard AI's faction;
 * - STEAMROLL_SEAT: `0` or `1`, the Hard AI's seat;
 * - STEAMROLL_VARIANT: knobs of the opponent to change, for calibration, such as `launch:18000,crushers:8,bonus:15` (`=` works
 *   too); any key of SteamrollTuning, all numbers;
 * - AI_RULES: changes to the Hard AI's rules (AiRules), such as `recall:0,queueDepth:2` (see aiRules.ts);
 * - MATCH_SHARD: `k/n`, to play only the k-th of n shares of the selected games.
 * Pick the personality with `-t raider` (or balanced, doomsday).
 */

/** Long enough that nearly every game is decided, by elimination or the harness's material rule: its games turn on one big attack. */
export const STEAMROLL_TICKS = 20 * 60 * 20;
/** A game this long gives the opponent time to mass and launch its attack. */
const LAUNCH_BY = 20 * 60 * 15;
/** The pass mark (AI-25): wins of each personality's 32 games, at least. */
export const PASS_WINS = 16;

/** One personality's 32 games on a four-core runner, with margin. */
const SERIES_TIMEOUT = 3_000_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');

/** The opponent variant the environment asks for (STEAMROLL_VARIANT), as changes to STEAMROLL_TUNING. */
export function variant(spec = env('STEAMROLL_VARIANT')): Partial<SteamrollTuning> {
  const out: Partial<SteamrollTuning> = {};
  for (const part of spec.split(',').filter(Boolean)) {
    const [k, v] = part.split(/[=:]/) as [string, string]; // `:` too: the Balance workflow's variables cannot carry `=` in a value (HAR-6)
    if (!(k in STEAMROLL_TUNING) || !Number.isFinite(Number(v))) throw new Error(`STEAMROLL_VARIANT: bad part ${part}`);
    out[k as keyof SteamrollTuning] = Number(v);
  }
  return out;
}

export interface SteamrollGame {
  o: MatchOptions;
  /** The Hard AI's seat (the steamroll opponent has the other), personality and faction. */
  seat: 0 | 1;
  personality: Personality;
  faction: Faction;
}

const seedRange = (): number[] => {
  const [a, b] = (env('STEAMROLL_SEEDS') || '1-8').split('-').map(Number) as [number, number];
  return Array.from({ length: (b ?? a) - a + 1 }, (_, i) => a + i);
};

/** One personality's games against the opponent: every seed, faction order and seat the environment selects. */
export function steamrollGames(personality: Personality): SteamrollGame[] {
  const tuning = variant();
  const factions = (['human', 'alien'] as const).filter((f) => !env('STEAMROLL_AI_FACTION') || env('STEAMROLL_AI_FACTION') === f);
  const seats = ([0, 1] as const).filter((s) => !env('STEAMROLL_SEAT') || env('STEAMROLL_SEAT') === String(s));
  const [k, n] = (env('MATCH_SHARD') || '1/1').split('/').map(Number) as [number, number];
  const all = seedRange().flatMap((seed) =>
    factions.flatMap((faction) =>
      seats.map((seat): SteamrollGame => {
        const other: Faction = faction === 'human' ? 'alien' : 'human';
        const o: MatchOptions = {
          seed,
          factions: seat === 0 ? [faction, other] : [other, faction],
          difficulties: seat === 0 ? [DIFFICULTIES.hard, STEAMROLL_DIFFICULTY] : [STEAMROLL_DIFFICULTY, DIFFICULTIES.hard],
          personalities: seat === 0 ? [personality, 'balanced'] : ['balanced', personality],
          opponents: seat === 0 ? ['ai', 'steamroll'] : ['steamroll', 'ai'],
          steamroll: tuning,
          rules: aiRules(),
          maxTicks: STEAMROLL_TICKS,
        };
        return { o, seat, personality, faction };
      }),
    ),
  );
  // MATCH_SHARD=k/n plays game i when i mod n is k - 1.
  return all.filter((_, i) => i % n === k - 1);
}

const played = new Map<Personality, Promise<{ games: SteamrollGame[]; results: MatchResult[] }>>();
/** One personality's series, played once per run and shared by every check on it. */
export function steamrollSeries(p: Personality): Promise<{ games: SteamrollGame[]; results: MatchResult[] }> {
  let hit = played.get(p);
  if (!hit) {
    const games = steamrollGames(p);
    hit = playMatches(games.map((g) => g.o)).then((results) => ({ games, results }));
    played.set(p, hit);
  }
  return hit;
}

export interface Tally {
  wins: number;
  losses: number;
  undecided: number;
}

/** The Hard AI's wins, losses and undecided games over the games `pick` selects. */
export function tally(games: readonly SteamrollGame[], rs: readonly MatchResult[], pick: (g: SteamrollGame) => boolean = () => true): Tally {
  const t: Tally = { wins: 0, losses: 0, undecided: 0 };
  rs.forEach((r, i) => {
    const g = games[i] as SteamrollGame;
    if (!pick(g)) return;
    if (r.winner === null) t.undecided++;
    else if (r.winner === g.seat) t.wins++;
    else t.losses++;
  });
  return t;
}

const line = (name: string, t: Tally): string => `${name.padEnd(12)} Hard AI ${String(t.wins).padStart(3)} won ${String(t.losses).padStart(3)} lost ${String(t.undecided).padStart(3)} undecided`;

const median = (xs: readonly number[]): number => {
  const m = [...xs].sort((a, b) => a - b);
  if (m.length === 0) return NaN;
  const mid = m.length >> 1;
  return m.length % 2 ? (m[mid] as number) : ((m[mid - 1] as number) + (m[mid] as number)) / 2;
};
const minutes = (ticks: number): string => (ticks / 1200).toFixed(1);

const production = (e: EconomyAt): number => e.barracks + e.factories;

/** The Hard AI's and the opponent's stock at the opponent's first attack (AI-22). */
function launchLine(g: SteamrollGame, at: readonly [EconomyAt, EconomyAt]): string {
  const ai = at[g.seat];
  const opp = at[1 - g.seat]!;
  return `at the attack: production AI ${production(ai)} / opponent ${production(opp)}, AI banked ${ai.credits} cr and ${ai.queued} cr in queues not started, army AI ${ai.army} cr / opponent ${opp.army} cr`;
}

/** The Hard AI's army at the opponent's first attack (AI-23): lost before it, share at home, artillery and heroes. */
const armyLine = (a: ArmyAt): string => `AI army lost before it ${a.lost} cr, at home ${(100 * a.home).toFixed(0)}%, artillery ${a.artillery}, heroes ${a.heroes}`;

/** At the opponent's first attack (AI-22), over the games in which it attacked: the AI's and the opponent's stock. */
export function atLaunchTally(games: readonly SteamrollGame[], rs: readonly MatchResult[]): { games: number; ai: EconomyAt[]; opp: EconomyAt[]; army: ArmyAt[] } {
  const rows = rs.flatMap((r, i) => (r.atLaunch ? [{ ai: r.atLaunch.at[games[i]!.seat], opp: r.atLaunch.at[1 - games[i]!.seat]!, army: r.atLaunch.army[games[i]!.seat] }] : []));
  return { games: rows.length, ai: rows.map((x) => x.ai), opp: rows.map((x) => x.opp), army: rows.map((x) => x.army) };
}

function launchSummary(t: ReturnType<typeof atLaunchTally>): string {
  const m = (xs: readonly EconomyAt[], f: (e: EconomyAt) => number): number => median(xs.map(f));
  return (
    `at the opponent's first attack (${t.games} games), medians: production buildings AI ${m(t.ai, production)} / opponent ${m(t.opp, production)}; ` +
    `AI banked ${m(t.ai, (e) => e.credits)} cr, in queues not started ${m(t.ai, (e) => e.queued)} cr; army AI ${m(t.ai, (e) => e.army)} cr / opponent ${m(t.opp, (e) => e.army)} cr; ` +
    `AI army lost before it ${median(t.army.map((a) => a.lost))} cr, at home ${(100 * median(t.army.map((a) => a.home))).toFixed(0)}%, artillery ${median(t.army.map((a) => a.artillery))}, heroes ${median(t.army.map((a) => a.heroes))}`
  );
}

/** One game's facts for calibration (HAR-5): result, the opponent's first attack, economy and production, both armies. */
function gameLine(g: SteamrollGame, r: MatchResult): string {
  const s = r.ai[1 - g.seat]!;
  const sr = s.steamroll;
  const first = sr?.launches[0];
  const who = r.winner === null ? 'undecided' : r.winner === g.seat ? 'AI won' : 'AI lost';
  return [
    `seed ${g.o.seed} AI ${g.faction} seat ${g.seat}: ${who} (${r.reason}) at ${minutes(r.ticks)} min`,
    `attack ${first ? `${minutes(first.tick)} min, ${first.value} cr, ${first.crushers} crushers` : 'none'} (${sr?.launches.length ?? 0} in all)`,
    `peak haulers ${sr?.peakHaulers ?? 0} refineries ${sr?.peakRefineries ?? 0} barracks ${sr?.peakBarracks ?? 0} factories ${sr?.peakFactories ?? 0}`,
    `peak army AI ${r.peak.armyValue[g.seat]} cr / opponent ${r.peak.armyValue[1 - g.seat]} cr`,
    ...(r.atLaunch ? [launchLine(g, r.atLaunch.at), armyLine(r.atLaunch.army[g.seat])] : []),
  ].join('; ');
}

/** The Hard AI's main waves by approach and the order chosen in each game (AI-26), its split raids and hit squads (AI-27). */
export function groupsLine(games: readonly SteamrollGame[], rs: readonly MatchResult[]): string {
  const stats = rs.map((r, i) => r.ai[games[i]!.seat]!);
  const by = APPROACHES.map((a) => `${a} ${stats.reduce((n, s) => n + s.approaches[a], 0)}`).join(', ');
  const repeats = stats.reduce((n, s) => n + s.approachLog.filter((a, i) => i > 0 && a === s.approachLog[i - 1]).length, 0);
  const orders = stats.map((s) => s.approachLog.map((a) => a[0]).join('') || '-').join(' ');
  const sum = (f: (s: (typeof stats)[number]) => number): number => stats.reduce((n, s) => n + f(s), 0);
  return `AI-26/AI-27: main waves by approach ${by} (same twice running ${repeats}); orders by game ${orders}; split raids ${sum((s) => s.splitRaids)}, hit squads ${sum((s) => s.hitSquads)}, Raider's army scout units ${sum((s) => s.raiderScouts)}`;
}

/** Prints the tally, every game's facts and their medians, and adds them to the CI job summary when there is one. */
function report(p: Personality, games: readonly SteamrollGame[], rs: readonly MatchResult[], minutesTaken: number): void {
  const lengths = lengthReport(rs.map((r) => r.ticks));
  const shard = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_AI_FACTION', 'STEAMROLL_SEAT', 'STEAMROLL_VARIANT', 'AI_RULES'].map((k) => `${k}=${env(k) || '-'}`).join(' ');
  const opp = rs.map((r, i) => r.ai[1 - games[i]!.seat]!.steamroll);
  const firsts = opp.flatMap((s) => (s?.launches[0] ? [s.launches[0]] : []));
  const peakAi = rs.map((r, i) => r.peak.armyValue[games[i]!.seat] as number);
  const peakOpp = rs.map((r, i) => r.peak.armyValue[1 - games[i]!.seat] as number);
  const out = [
    `HAR-5 ${p}: Hard AI against the steamroll opponent, ${rs.length} games (${shard}), tuning ${JSON.stringify({ ...STEAMROLL_TUNING, ...variant() })}, ${STEAMROLL_TICKS} ticks at most, played in ${minutesTaken.toFixed(1)} min`,
    rulesLine(),
    line(p, tally(games, rs)),
    ...(['human', 'alien'] as const).map((f) => line(`AI ${f}`, tally(games, rs, (g) => g.faction === f))),
    `by: ${rs.filter((r) => r.reason === 'elimination').length} elimination, ${rs.filter((r) => r.reason === 'material').length} material, ${rs.filter((r) => r.reason === 'draw').length} undecided`,
    `length: median ${lengths.median.toFixed(1)} min, ${lengths.min.toFixed(1)} to ${lengths.max.toFixed(1)}`,
    `opponent attacked in ${firsts.length} of ${rs.length} games; medians: first attack ${minutes(median(firsts.map((f) => f.tick)))} min with ${median(firsts.map((f) => f.value))} cr and ${median(firsts.map((f) => f.crushers))} crushers`,
    `medians: opponent peak haulers ${median(opp.map((s) => s?.peakHaulers ?? 0))}, refineries ${median(opp.map((s) => s?.peakRefineries ?? 0))}, barracks ${median(opp.map((s) => s?.peakBarracks ?? 0))}, factories ${median(opp.map((s) => s?.peakFactories ?? 0))}; peak army AI ${median(peakAi)} cr, opponent ${median(peakOpp)} cr`,
    launchSummary(atLaunchTally(games, rs)),
    groupsLine(games, rs),
    ...rs.map((r, i) => gameLine(games[i]!, r)),
  ];
  // Written straight to stdout: the runner holds back console.log output of a passing test.
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('the Hard AI against the steamroll opponent', () => {
  for (const p of PERSONALITIES) {
    it(`HAR-5, AI-22, AI-23, AI-26: against ${p}, the steamroll opponent trains only rifle and anti-armour squads, crushers and haulers, never retreats, attacks, and replays the same game`, async () => {
      const started = Date.now();
      const { games, results: rs } = await steamrollSeries(p);
      report(p, games, rs, (Date.now() - started) / 60000);

      rs.forEach((r, i) => {
        const g = games[i] as SteamrollGame;
        const s = r.ai[1 - g.seat]!;
        const where = `${p} seed ${g.o.seed} ${g.o.factions.join('-')} seat ${g.seat}`;
        // Rifle and anti-armour squads and crushers: no artillery, aircraft, scouts or hero.
        expect({ art: s.produced.art, air: s.produced.air, scout: s.produced.scout, hero: s.produced.hero }, where).toEqual({ art: 0, air: 0, scout: 0, hero: 0 });
        expect(s.produced.tank, where).toBeGreaterThan(0);
        expect(s.produced.inf, where).toBeGreaterThan(0);
        expect(s.retreats, where).toBe(0);
        // Every attack sets out at its launch size.
        const t = { ...STEAMROLL_TUNING, ...g.o.steamroll };
        for (const l of s.steamroll?.launches ?? []) {
          expect(l.value, where).toBeGreaterThanOrEqual(t.launch);
          expect(l.crushers, where).toBeGreaterThanOrEqual(t.crushers);
        }
        // It goes on the attack in every game that lasts long enough to mass.
        if (r.ticks >= LAUNCH_BY) expect(s.steamroll?.launches.length, where).toBeGreaterThan(0);
        // The harness takes stock at its first attack (AI-22, measurement).
        if (r.atLaunch) expect(r.atLaunch.tick, where).toBe(s.steamroll?.launches[0]?.tick);
        // ... and of both armies (AI-23): losses so far and the share at home are real measures.
        for (const a of r.atLaunch?.army ?? []) {
          expect(a.lost, where).toBeGreaterThanOrEqual(0);
          expect(a.home, where).toBeGreaterThanOrEqual(0);
          expect(a.home, where).toBeLessThanOrEqual(1);
        }
      });

      // Main waves vary their approach (AI-26): over the series they used all three (checked when the whole series is
      // played; a shard prints its count), and no AI chose the same twice running.
      if ({ ...DEFAULT_RULES, ...aiRules() }.approach) {
        const logs = rs.map((r, i) => r.ai[games[i]!.seat]!.approachLog);
        const whole = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_AI_FACTION', 'STEAMROLL_SEAT'].every((k) => !env(k));
        if (whole) for (const a of APPROACHES) expect(logs.some((l) => l.includes(a)), `${p}: a main wave went ${a}`).toBe(true);
        logs.forEach((l, i) => expect(l.some((a, k) => k > 0 && a === l[k - 1]), `${p} game ${i}: ${l.join(',')}`).toBe(false));
      }

      // The same seeds and settings give the same game (HAR-1): the shortest game, replayed.
      const short = rs.reduce((b, r, i) => (r.ticks < rs[b]!.ticks ? i : b), 0);
      const again = playMatch(games[short]!.o);
      expect(again.hash).toBe(rs[short]!.hash);
      expect(again.ai).toEqual(rs[short]!.ai);
    }, SERIES_TIMEOUT);

    // The pass mark holds only over the whole series as the game plays it: every seed, faction and seat, the opponent's own
    // tuning and the AI's own rules.
    const full = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_AI_FACTION', 'STEAMROLL_SEAT', 'STEAMROLL_VARIANT', 'AI_RULES'].every((k) => !env(k));
    it.skipIf(!full)(`AI-25: against the steamroll opponent, ${p} wins at least half of its 32 games`, async () => {
      const { games, results: rs } = await steamrollSeries(p);
      expect(rs).toHaveLength(32);
      expect(tally(games, rs).wins).toBeGreaterThanOrEqual(PASS_WINS);
    }, SERIES_TIMEOUT);
  }
});
