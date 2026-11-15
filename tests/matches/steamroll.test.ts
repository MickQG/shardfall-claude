import { appendFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, PERSONALITIES, type Personality } from '../../src/ai/ai';
import { lengthReport, playMatch, type MatchOptions, type MatchResult } from '../../src/ai/harness';
import { STEAMROLL_DIFFICULTY, STEAMROLL_TUNING, type SteamrollTuning } from '../../src/ai/steamroll';
import type { Faction } from '../../src/data/defs';
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
 * - STEAMROLL_VARIANT: parts of the opponent to change, for calibration, such as `opening:0,spend:0,mass:0,bonus:15` (`=` works too);
 * - MATCH_SHARD: `k/n`, to play only the k-th of n shares of the selected games.
 * Pick the personality with `-t raider` (or balanced, doomsday).
 */

/** Long enough that nearly every game is decided, by elimination or the harness's material rule. */
export const STEAMROLL_TICKS = 20 * 60 * 15;
/** One personality's 32 games on a four-core runner, with margin. */
const SERIES_TIMEOUT = 3_000_000;

const env = (k: string): string => (typeof process !== 'undefined' ? (process.env[k] ?? '') : '');

/** The opponent variant the environment asks for (STEAMROLL_VARIANT), as changes to STEAMROLL_TUNING. */
export function variant(spec = env('STEAMROLL_VARIANT')): Partial<SteamrollTuning> {
  const out: Partial<SteamrollTuning> = {};
  for (const part of spec.split(',').filter(Boolean)) {
    const [k, v] = part.split(/[=:]/) as [string, string]; // `:` too: the Balance workflow's variables cannot carry `=` in a value (HAR-6)
    if (k === 'opening' || k === 'spend') out[k] = v === '1' || v === 'true';
    else if (k === 'mass' || k === 'bonus') out[k] = Number(v);
    else throw new Error(`STEAMROLL_VARIANT: unknown part ${k}`);
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

/** Prints the tally, and adds it to the CI job summary when there is one. */
function report(p: Personality, games: readonly SteamrollGame[], rs: readonly MatchResult[], minutes: number): void {
  const lengths = lengthReport(rs.map((r) => r.ticks));
  const shard = ['MATCH_SHARD', 'STEAMROLL_SEEDS', 'STEAMROLL_AI_FACTION', 'STEAMROLL_SEAT', 'STEAMROLL_VARIANT'].map((k) => `${k}=${env(k) || '-'}`).join(' ');
  const out = [
    `HAR-5 ${p}: Hard AI against the steamroll opponent, ${rs.length} games (${shard}), tuning ${JSON.stringify({ ...STEAMROLL_TUNING, ...variant() })}, ${STEAMROLL_TICKS} ticks at most, played in ${minutes.toFixed(1)} min`,
    line(p, tally(games, rs)),
    ...(['human', 'alien'] as const).map((f) => line(`AI ${f}`, tally(games, rs, (g) => g.faction === f))),
    `by: ${rs.filter((r) => r.reason === 'elimination').length} elimination, ${rs.filter((r) => r.reason === 'material').length} material, ${rs.filter((r) => r.reason === 'draw').length} undecided`,
    `length: median ${lengths.median.toFixed(1)} min, ${lengths.min.toFixed(1)} to ${lengths.max.toFixed(1)}`,
  ];
  // Written straight to stdout: the runner holds back console.log output of a passing test.
  process.stdout.write(`${out.join('\n')}\n`);
  const summary = env('GITHUB_STEP_SUMMARY');
  if (summary) appendFileSync(summary, `\`\`\`\n${out.join('\n')}\n\`\`\`\n`);
}

describe('the Hard AI against the steamroll opponent', () => {
  for (const p of PERSONALITIES) {
    it(`HAR-5: against ${p}, the steamroll opponent trains crushers, its hero and only opening rifles, never retreats, attacks, and replays the same game`, async () => {
      const started = Date.now();
      const { games, results: rs } = await steamrollSeries(p);
      report(p, games, rs, (Date.now() - started) / 60000);

      rs.forEach((r, i) => {
        const g = games[i] as SteamrollGame;
        const s = r.ai[1 - g.seat]!;
        const where = `${p} seed ${g.o.seed} ${g.o.factions.join('-')} seat ${g.seat}`;
        // Crushers and its hero, and rifle squads only until its first crushers stood: no anti-armour, artillery,
        // aircraft or scouts.
        expect({ at: s.produced.at, art: s.produced.art, air: s.produced.air, scout: s.produced.scout }, where).toEqual({ at: 0, art: 0, air: 0, scout: 0 });
        expect(s.produced.tank, where).toBeGreaterThan(0);
        expect(s.steamroll?.infantryAfter, where).toBe(0);
        expect(s.retreats, where).toBe(0);
      });
      // It goes on the attack in every game that lasts nine minutes or more.
      rs.forEach((r, i) => {
        if (r.ticks >= 20 * 60 * 9) expect(r.ai[1 - games[i]!.seat]!.waves, `game ${i}`).toBeGreaterThan(0);
      });

      // The same seeds and settings give the same game (HAR-1): the shortest game, replayed.
      const short = rs.reduce((b, r, i) => (r.ticks < rs[b]!.ticks ? i : b), 0);
      const again = playMatch(games[short]!.o);
      expect(again.hash).toBe(rs[short]!.hash);
      expect(again.ai).toEqual(rs[short]!.ai);
    }, SERIES_TIMEOUT);
  }
});
