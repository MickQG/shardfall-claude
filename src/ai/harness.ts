import { buildingDef, UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { skirmishConfig, type MapId } from '../data/maps';
import { createGame, FP, hash, Rng, snapshot, submit, tick, type Game } from '../sim';
import { Hv } from '../sim/state';
import { AI, type AiStats, type Difficulty, type Personality } from './ai';
import { kitOf, type Kit } from './kit';
import { STEAMROLL_DIFFICULTY, STEAMROLL_TUNING, SteamrollAI, type SteamrollTuning } from './steamroll';

export interface Violations {
  /** Haulers left idle (or switched off) for ten seconds while shards and a refinery exist. */
  idleHauler: number;
  /** Units with an order that did not move for fifteen seconds. */
  stuck: number;
  /** Low power left unfixed for 45 seconds. */
  powerOutage: number;
  /** Over 3500 unspent shards for 75 seconds. */
  hoard: number;
  /** Enemy armed units at the base for 15 seconds with no army nearby. */
  undefended: number;
  /** Attack waves launched into clearly stronger opposition. */
  suicide: number;
  /** Attack waves with fewer than five units. */
  lone: number;
}

export interface MatchOptions {
  seed: number;
  factions: [Faction, Faction];
  difficulties: [Difficulty, Difficulty];
  maxTicks: number;
  /** The skirmish map (MAP-4); Crossroads by default. */
  map?: MapId;
  /** The map seed when `map` is 'generated' (MAP-7). */
  mapSeed?: number;
  /** Each AI's personality (AI-12); Balanced by default. */
  personalities?: [Personality, Personality];
  /**
   * Which player is the ordinary AI and which the steamroll opponent (HAR-5); both the AI by default. A steamroll seat
   * plays at STEAMROLL_DIFFICULTY (with the tuning's bonus) whatever `difficulties` says for it, and ignores its personality.
   */
  opponents?: [Opponent, Opponent];
  /** Parts of the steamroll opponent to change, for measuring each one (HAR-5); STEAMROLL_TUNING by default. */
  steamroll?: Partial<SteamrollTuning>;
}

/** Who plays a seat in a headless match: the AI, or the steamroll opponent used to measure it (HAR-5). */
export type Opponent = 'ai' | 'steamroll';

export interface MatchResult {
  winner: number | null;
  reason: 'elimination' | 'material' | 'draw';
  ticks: number;
  material: [number, number];
  hash: number;
  violations: [Violations, Violations];
  ai: [AiStats, AiStats];
  /** Peak counts, for sanity checks on the economy, and the largest army value (credits, by health) each side had. */
  peak: { haulers: [number, number]; army: [number, number]; buildings: [number, number]; armyValue: [number, number] };
  /** Orders each AI issued, for determinism checks. */
  orders: [number, number];
  /** How each player's economy and production grew (AI-22): read off the game state, which the harness may see. */
  economy: [EconomyLog, EconomyLog];
}

/** The minutes of game time at which the harness takes stock of each player's economy (AI-22). */
export const ECONOMY_MINUTES = [8, 10, 12] as const;

/** One player's economy at one minute of game time (AI-22). */
export interface EconomyAt {
  minute: number;
  refineries: number;
  haulers: number;
  barracks: number;
  factories: number;
  /** Credits earned from delivered shards so far, bonus included. */
  gathered: number;
}

/** One player's economy over a match (AI-22): a record for each of ECONOMY_MINUTES the match reached, and the tick it first lost a refinery (destroyed or sold), or -1. */
export interface EconomyLog {
  at: EconomyAt[];
  refineryLostAt: number;
}

const zero = (): Violations => ({ idleHauler: 0, stuck: 0, powerOutage: 0, hoard: 0, undefended: 0, suicide: 0, lone: 0 });

const material = (g: Game, p: number): number => {
  let m = 0;
  for (const u of g.state.units) if (u.owner === p) m += (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp;
  for (const b of g.state.buildings) if (b.owner === p) m += (buildingDef(b.kind).cost * b.hp) / buildingDef(b.kind).hp;
  return m;
};

/** Plays one complete AI-vs-AI match headlessly and reports the result plus any bad behaviour observed. */
export function playMatch(o: MatchOptions): MatchResult {
  const steam = (p: number): boolean => o.opponents?.[p] === 'steamroll';
  const tuning: SteamrollTuning = { ...STEAMROLL_TUNING, ...o.steamroll };
  const diffs = [0, 1].map((p) => (steam(p) ? { ...STEAMROLL_DIFFICULTY, bonus: tuning.bonus } : o.difficulties[p])) as [Difficulty, Difficulty];
  const cfg = skirmishConfig(o.seed, { factions: o.factions, bonuses: [diffs[0].bonus, diffs[1].bonus], map: o.map, mapSeed: o.mapSeed });
  const game = createGame(cfg);
  const ais = [0, 1].map((p) =>
    steam(p) ? new SteamrollAI(p, o.factions[p] as Faction, cfg.map, o.seed, tuning) : new AI(p, o.factions[p] as Faction, diffs[p] as Difficulty, cfg.map, o.seed, o.personalities?.[p] ?? 'balanced'),
  ) as [AI, AI];
  // Random think phases per match: when mirrored armies meet, a few ticks of timing decide the fight, so a fixed offset would hand one side every game.
  const pr = new Rng(o.seed * 31 + 7);
  const phase = [pr.int(diffs[0].thinkEvery), pr.int(diffs[1].thinkEvery)];
  const viol: [Violations, Violations] = [zero(), zero()];
  const peak = { haulers: [0, 0] as [number, number], army: [0, 0] as [number, number], buildings: [0, 0] as [number, number], armyValue: [0, 0] as [number, number] };
  const orders: [number, number] = [0, 0];
  const economy: [EconomyLog, EconomyLog] = [
    { at: [], refineryLostAt: -1 },
    { at: [], refineryLostAt: -1 },
  ];
  const kits = [kitOf(o.factions[0]), kitOf(o.factions[1])];
  const refineriesSeen = [new Set<number>(), new Set<number>()];

  // Per-entity episode trackers: key -> first tick of the current bad streak.
  const since = new Map<string, number>();
  const counted = new Set<string>();
  const lastPos = new Map<number, { x: number; y: number; t: number }>();
  const episode = (key: string, bad: boolean, tickNow: number, limit: number, onHit: () => void): void => {
    if (!bad) {
      since.delete(key);
      counted.delete(key);
      return;
    }
    const s = since.get(key) ?? tickNow;
    since.set(key, s);
    if (tickNow - s >= limit && !counted.has(key)) {
      counted.add(key);
      onHit();
    }
  };

  const s = game.state;
  while (s.tick < o.maxTicks && !s.over) {
    for (const p of [0, 1] as const) {
      const ai = ais[p];
      if ((s.tick + (phase[p] as number)) % ai.diff.thinkEvery !== 0) continue;
      for (const c of ai.think(snapshot(game, p))) {
        submit(game, c);
        orders[p]++;
      }
    }
    tick(game);
    if (s.tick % 10 !== 0) continue;

    const t = s.tick;
    const anyShards = s.shards.some((v) => v > 0);
    for (const p of [0, 1]) {
      const v = viol[p] as Violations;
      const refineries = s.buildings.filter((b) => b.owner === p && buildingDef(b.kind).refinery).length;
      const haulers = s.units.filter((u) => u.owner === p && unitDef(u.kind).capacity !== undefined);
      peak.haulers[p] = Math.max(peak.haulers[p] as number, haulers.length);
      const army = s.units.filter((u) => u.owner === p && unitDef(u.kind).weapon);
      peak.army[p] = Math.max(peak.army[p] as number, army.length);
      peak.armyValue[p] = Math.max(peak.armyValue[p] as number, Math.round(army.reduce((m, u) => m + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0)));
      peak.buildings[p] = Math.max(peak.buildings[p] as number, s.buildings.filter((b) => b.owner === p).length);
      for (const h of haulers) {
        const idle = (h.hv === Hv.Idle || !h.auto) && h.path.length === 0 && !h.waiting && h.load === 0;
        episode(`h${h.id}`, idle && refineries > 0 && anyShards, t, 600, () => v.idleHauler++);
      }
      const pl = s.players[p]!;
      // Economy statistics (AI-22): refineries lost, and a record at each of ECONOMY_MINUTES.
      const log = economy[p] as EconomyLog;
      const refIds = new Set(s.buildings.filter((b) => b.owner === p && buildingDef(b.kind).refinery).map((b) => b.id));
      const seen = refineriesSeen[p] as Set<number>;
      if (log.refineryLostAt < 0 && [...seen].some((id) => !refIds.has(id))) log.refineryLostAt = t;
      refineriesSeen[p] = refIds;
      const minute = ECONOMY_MINUTES.find((m) => m * 20 * 60 === t);
      if (minute !== undefined) {
        const kit = kits[p] as Kit;
        const own = (kind: string): number => s.buildings.filter((b) => b.owner === p && b.kind === kind).length;
        log.at.push({ minute, refineries, haulers: haulers.length, barracks: own(kit.barracks), factories: own(kit.factory), gathered: pl.stats.shardsGathered });
      }
      episode(`pw${p}`, pl.powerIn > pl.powerOut, t, 900, () => v.powerOutage++);
      episode(`hd${p}`, pl.credits > 3500, t, 1500, () => v.hoard++);

      // Undefended: enemy gunmen at one of our buildings and none of our own within reach.
      if (t > 3000) {
        const mine = s.buildings.filter((b) => b.owner === p);
        const attackers = s.units.filter((u) => u.owner !== p && unitDef(u.kind).weapon && mine.some((b) => Math.hypot(u.x / FP - b.tx, u.y / FP - b.ty) < 10));
        const defenders = s.units.filter((u) => u.owner === p && unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined);
        const covered = attackers.length > 0 && defenders.some((d) => attackers.some((a) => Math.hypot(a.x - d.x, a.y - d.y) / FP < 22));
        const turrets = mine.some((b) => buildingDef(b.kind).weapon);
        episode(`ud${p}`, attackers.length >= 2 && !covered && !turrets, t, 300, () => v.undefended++);
      }
    }
    // Stuck units: ordered somewhere, but not moving for 15 s, and not fighting.
    for (const u of s.units) {
      if (u.goal < 0 || u.waiting || u.path.length === 0 || u.target >= 0 || unitDef(u.kind).air) {
        lastPos.delete(u.id);
        continue;
      }
      const lp = lastPos.get(u.id);
      if (!lp || Math.abs(lp.x - u.x) + Math.abs(lp.y - u.y) > FP / 2) lastPos.set(u.id, { x: u.x, y: u.y, t });
      else if (t - lp.t >= 300 && !counted.has(`s${u.id}:${lp.t}`)) {
        counted.add(`s${u.id}:${lp.t}`);
        (viol[u.owner] as Violations).stuck++;
      }
    }
  }

  const m: [number, number] = [material(game, 0), material(game, 1)];
  let winner: number | null = null;
  let reason: MatchResult['reason'] = 'draw';
  if (s.over) {
    winner = s.winner;
    reason = winner === null ? 'draw' : 'elimination';
  } else if (m[0] >= 1.35 * m[1]) {
    winner = 0;
    reason = 'material';
  } else if (m[1] >= 1.35 * m[0]) {
    winner = 1;
    reason = 'material';
  }
  for (const p of [0, 1]) {
    (viol[p] as Violations).suicide = (ais[p] as AI).stats.suicides;
    (viol[p] as Violations).lone = (ais[p] as AI).stats.lone;
  }
  return { winner, reason, ticks: s.tick, material: m, hash: hash(game), violations: viol, ai: [ais[0].stats, ais[1].stats], peak, orders, economy };
}

/** Shared by tests and the CLI: sum of every violation counter. */
export const totalViolations = (v: Violations): number => v.idleHauler + v.stuck + v.powerOutage + v.hoard + v.undefended + v.suicide + v.lone;

export const unitKinds = Object.keys(UNIT_DEFS);

/** Median, shortest and longest match length in minutes, from match lengths in ticks (HAR-4). */
export function lengthReport(ticks: readonly number[]): { median: number; min: number; max: number; n: number } {
  const m = [...ticks].map((t) => t / (20 * 60)).sort((a, b) => a - b);
  if (m.length === 0) return { median: 0, min: 0, max: 0, n: 0 };
  const mid = m.length >> 1;
  const median = m.length % 2 ? (m[mid] as number) : ((m[mid - 1] as number) + (m[mid] as number)) / 2;
  return { median, min: m[0] as number, max: m[m.length - 1] as number, n: m.length };
}

/** Whether a median match length lands in the 12 to 20 minute target (HAR-4). */
export const inLengthTarget = (medianMinutes: number): boolean => medianMinutes >= 12 && medianMinutes <= 20;
