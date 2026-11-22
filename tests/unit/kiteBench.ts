import { AI, DIFFICULTIES, type AiRules, type AiStats } from '../../src/ai/ai';
import { kiteOrders, STEAMROLL_DIFFICULTY } from '../../src/ai/steamroll';
import { buildingDef, UNIT_DEFS, unitDef, type Faction } from '../../src/data/defs';
import { createGame, FP, hash, snapshot, submit, tick, type BuildingSnap, type Command, type Game, type MapDef, type Snapshot, type UnitSpawn } from '../../src/sim';

/**
 * Open-ground benches for the AI's discipline (HAR-9 kite, HAR-10 overwhelm, spec 033). The real AI class (Hard, fog as in the
 * game: it decides from `snapshot(game, seat)` and answers with commands, as src/ai/harness.ts does) owns an army standing
 * near its base, on a 96 by 96 map with nothing to hide behind. A scripted opponent, with no economy, attacks it. Nobody
 * trains or builds (the AI has no credits), so every number is about what the army does with what it has. The AI's standing
 * scout is off: a scout leaving on purpose would count as a straggler.
 *
 * The AI's base is at 10,10 (headquarters 3 by 3) and its army stands in a block around its staging point (19..24, 19..24).
 * The opponent's headquarters is at 83,83, far out of sight.
 */

export const SIZE = 96;
export const AI_HQ = { tx: 10, ty: 10 };
export const FOE_HQ = { tx: 83, ty: 83 };
/** Where the AI's army stands. */
export const STAGE = { x: 19, y: 19 };
const OPEN: MapDef = { width: SIZE, height: SIZE, heights: new Array<number>(SIZE * SIZE).fill(0) };

/** Game ticks per second, and the tick the bench starts at (the AI's early-game rules are over by then). */
export const TPS = 20;
export const START_TICK = 3000;
/** The scripted opponent decides this often, in ticks (the steamroll opponent's cadence, HAR-7). */
const FOE_EVERY = STEAMROLL_DIFFICULTY.thinkEvery;
/** The harness samples positions this often, in ticks. */
export const SAMPLE_EVERY = 20;
/** A unit that ends further than this (tiles) from where it started has straggled. */
export const STRAGGLE = 12;

export type Policy = (g: Game, me: number, them: number, tickNo: number) => Command[];

export interface BenchSetup {
  /** Seeds the sim and the AI (1 by default). */
  seed?: number;
  /** The AI: its seat, faction and army (kinds, in rows of five around STAGE), and optionally rules to change. */
  ai: { seat: 0 | 1; faction: Faction; army: string[]; rules?: Partial<AiRules> };
  /** The scripted opponent: its army (rows of five from `from`), and how it plays; `intel` shows the AI its headquarters (so it knows where the enemy is, and may launch a wave). */
  foe: { faction: Faction; army: string[]; from: [number, number]; policy: Policy };
  /** Seconds of game time to play. */
  seconds: number;
  intel?: boolean;
  /**
   * A kind of enemy unit the AI is shown eight of, far off in the fog (as the AI-34 tests do): a big enemy army it has seen keeps
   * it from setting out on a wave, so the scenario is about an army that stands.
   */
  hold?: string;
}

export interface BenchResult {
  /** Full cost (credits) of the AI's units that died, of the opponent's that died, and (by health) the AI's value left at the end. */
  aiLost: number;
  foeLost: number;
  aiValueLeft: number;
  /** The AI's army: value (by health) at the start, and units alive at the start and at the end. */
  aiValueStart: number;
  aiUnitsStart: number;
  aiUnitsEnd: number;
  /** Farthest any AI combat unit was from the centre of the AI's combat units (tiles), over all samples; and the same in the last sample. */
  maxStray: number;
  /** The AI's units alive at the end more than STRAGGLE tiles from where they started. */
  straggled: number;
  /** The AI's units that were ever more than STRAGGLE tiles from where they started, at any sample (dead or alive). */
  everStraggled: number;
  /** How far the centre of the AI's combat units moved from where it started, at the end (tiles). */
  drift: number;
  /** AI value left over its start value after 60 s (HAR-10); equals aiValueLeft share when the bench is shorter. */
  survival: number;
  stats: AiStats;
  hash: number;
}

const tile = (v: number): number => v / FP;
const combat = (g: Game, owner: number): Game['state']['units'] => g.state.units.filter((u) => u.owner === owner && unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined);
const valueOf = (us: Game['state']['units']): number => us.reduce((s, u) => s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0);

const enemyHq = (g: Game, owner: number): BuildingSnap[] => {
  const b = g.state.buildings.find((x) => x.owner === owner && buildingDef(x.kind).hq);
  return b ? [{ id: b.id, owner, kind: b.kind, tx: b.tx, ty: b.ty, hp: b.hp, queue: [], repairing: false, rally: null, charge: 0 }] : [];
};

/** The bench's opponent seat: the other one. */
const hqKind = (f: Faction): string => (f === 'human' ? 'hum_hq' : 'ali_hq');

export function runBench(o: BenchSetup): BenchResult {
  const me = o.ai.seat;
  const them = (1 - me) as 0 | 1;
  const units: UnitSpawn[] = [
    ...o.ai.army.map((kind, i) => ({ owner: me, kind, tx: STAGE.x + (i % 5), ty: STAGE.y + Math.floor(i / 5) })),
    ...o.foe.army.map((kind, i) => ({ owner: them, kind, tx: o.foe.from[0] + (i % 5), ty: o.foe.from[1] + Math.floor(i / 5) })),
  ];
  const players = [0, 1].map((p) => ({ faction: p === me ? o.ai.faction : o.foe.faction, credits: 0 }));
  const g = createGame({
    seed: o.seed ?? 1,
    map: OPEN,
    players,
    units,
    buildings: [
      { owner: me, kind: hqKind(o.ai.faction), ...AI_HQ },
      { owner: them, kind: hqKind(o.foe.faction), ...FOE_HQ },
    ],
  });
  g.state.tick = START_TICK;
  const ai = new AI(me, o.ai.faction, DIFFICULTIES.hard, OPEN, (o.seed ?? 1) + 5, 'balanced', { standingScout: false, rules: { twoScouts: false, ...o.ai.rules } });
  const start = new Map(combat(g, me).map((u) => [u.id, { x: tile(u.x), y: tile(u.y) }]));
  const startValue = valueOf(combat(g, me));
  const centre = (us: Game['state']['units']): { x: number; y: number } => ({ x: us.reduce((s, u) => s + tile(u.x), 0) / Math.max(1, us.length), y: us.reduce((s, u) => s + tile(u.y), 0) / Math.max(1, us.length) });
  const c0 = centre(combat(g, me));
  const lost = [0, 0];
  let maxStray = 0;
  const strayed = new Set<number>();
  let survival = 1;
  const t0 = g.state.tick;
  const aiThink = (): Command[] => {
    const s = snapshot(g, me);
    if (o.hold) s.units.push(...[...Array(8)].map((_, i) => ({ id: 900000 + i, owner: them, kind: o.hold!, x: (70 + (i % 4)) * FP + FP / 2, y: (40 + Math.floor(i / 4)) * FP + FP / 2, hp: unitDef(o.hold!).hp, dest: null, load: 0, rank: 0, target: -1 })));
    if (o.intel && !s.buildings.some((b) => b.owner === them) && s.ghosts.length === 0) s.ghosts.push(...enemyHq(g, them));
    return ai.think(s as Snapshot);
  };
  for (let n = 0; n < o.seconds * TPS; n++) {
    const t = g.state.tick;
    if (t % ai.diff.thinkEvery === 0) for (const c of aiThink()) submit(g, c);
    if ((t - t0) % FOE_EVERY === 0) for (const c of o.foe.policy(g, them, me, t - t0)) submit(g, c);
    tick(g);
    for (const e of g.state.events) if (e.t === 'die' && e.owner >= 0 && UNIT_DEFS[e.kind]) lost[e.owner] = (lost[e.owner] as number) + unitDef(e.kind).cost;
    if ((t - t0) % SAMPLE_EVERY === 0) {
      const us = combat(g, me);
      const c = centre(us);
      for (const u of us) {
        maxStray = Math.max(maxStray, Math.hypot(tile(u.x) - c.x, tile(u.y) - c.y));
        const s0 = start.get(u.id);
        if (s0 && Math.hypot(tile(u.x) - s0.x, tile(u.y) - s0.y) > STRAGGLE) strayed.add(u.id);
      }
    }
    if (t - t0 === 60 * TPS - 1) survival = startValue > 0 ? valueOf(combat(g, me)) / startValue : 0;
  }
  const end = combat(g, me);
  if (o.seconds < 60) survival = startValue > 0 ? valueOf(end) / startValue : 0;
  const ce = centre(end);
  return {
    aiLost: lost[me] as number,
    foeLost: lost[them] as number,
    aiValueLeft: valueOf(end),
    aiValueStart: startValue,
    aiUnitsStart: start.size,
    aiUnitsEnd: end.length,
    maxStray,
    straggled: end.filter((u) => {
      const s0 = start.get(u.id);
      return !s0 || Math.hypot(tile(u.x) - s0.x, tile(u.y) - s0.y) > STRAGGLE;
    }).length,
    everStraggled: strayed.size,
    drift: Math.hypot(ce.x - c0.x, ce.y - c0.y),
    survival,
    stats: ai.stats,
    hash: hash(g),
  };
}

const rep = (kind: string, n: number): string[] => [...Array(n)].map(() => kind);

// ---- HAR-9 kite scenarios ----

/** Where a scripted harasser starts, about 25 tiles from the AI's army. */
export const HARASS_FROM: [number, number] = [41, 41];

/** The units of a seat that can fire, with their gun's reach. */
const reachOf = (kind: string): number => unitDef(kind).weapon?.range ?? 0;

/**
 * The Glare Skimmer harasser (HAR-9 a): each skimmer closes to range 9 of the nearest AI unit and fires (it fires on the
 * move, SKM-3), and backs 4 tiles straight away from every AI unit that comes within that unit's reach plus 2.
 */
export const skimmerPolicy: Policy = (g, me, them) => {
  const mine = g.state.units.filter((u) => u.owner === me && unitDef(u.kind).weapon);
  const foes = g.state.units.filter((u) => u.owner === them && unitDef(u.kind).weapon && !unitDef(u.kind).air);
  const out: Command[] = [];
  if (foes.length === 0) return out;
  const clamp = (v: number): number => Math.min(SIZE - 1, Math.max(1, v));
  for (const h of mine) {
    const hx = tile(h.x);
    const hy = tile(h.y);
    let ax = 0;
    let ay = 0;
    let near: (typeof foes)[number] | null = null;
    let nd = Infinity;
    for (const f of foes) {
      const d = Math.hypot(tile(f.x) - hx, tile(f.y) - hy);
      if (d < nd) {
        nd = d;
        near = f;
      }
      if (d < reachOf(f.kind) + 2) {
        ax += (hx - tile(f.x)) / Math.max(0.25, d);
        ay += (hy - tile(f.y)) / Math.max(0.25, d);
      }
    }
    const l = Math.hypot(ax, ay);
    if (l > 1e-6) out.push({ type: 'move', player: me, units: [h.id], x: clamp(hx + (4 * ax) / l) * FP, y: clamp(hy + (4 * ay) / l) * FP });
    else if (near && nd > unitDef(h.kind).weapon!.range - 0.4) {
      const fx = tile(near.x);
      const fy = tile(near.y);
      const r = unitDef(h.kind).weapon!.range - 0.5;
      out.push({ type: 'move', player: me, units: [h.id], x: clamp(fx + ((hx - fx) / nd) * r) * FP, y: clamp(fy + ((hy - fy) / nd) * r) * FP });
    }
  }
  return out;
};

/**
 * The Bulwark harasser (HAR-9 b): Bulwarks attack-move at the nearest AI unit they see, and give HAR-7's `kiteOrders`
 * (last, so they hold) as the Aegis tank-spam opponent does.
 */
export const bulwarkPolicy: Policy = (g, me, them) => {
  const snap = snapshot(g, me);
  const mine = snap.units.filter((u) => u.owner === me && unitDef(u.kind).weapon);
  if (mine.length === 0) return [];
  const seen = snap.units.filter((u) => u.owner === them);
  const out: Command[] = [];
  for (const u of mine) {
    const f = seen.reduce<(typeof seen)[number] | null>((b, x) => (!b || Math.hypot(x.x - u.x, x.y - u.y) < Math.hypot(b.x - u.x, b.y - u.y) ? x : b), null);
    const goal = f ? { x: f.x, y: f.y } : { x: STAGE.x * FP, y: STAGE.y * FP };
    out.push({ type: 'attackmove', player: me, units: [u.id], x: goal.x, y: goal.y });
  }
  return [...out, ...kiteOrders(me, snap.units, OPEN)];
};

export type KiteVariant = 'skimmer' | 'bulwark';

/** The Aegis army the Skimmers harass: 10 Riflemen, 6 Rocketeers and 2 Bulwarks, 4100 credits against their 3800. */
export const AEGIS_ARMY: string[] = [...rep('hum_rifleman', 10), ...rep('hum_rocketeer', 6), ...rep('hum_tank', 2)];
/** The Vrax army the Bulwarks harass: 3 Brutes, 4 Spitters and 6 Skitterers, 3850 credits against their 3200. */
export const VRAX_ARMY: string[] = [...rep('ali_brute', 3), ...rep('ali_spitter', 4), ...rep('ali_skitter', 6)];

/**
 * The kite scenario (HAR-9): the AI's army against four harassers, for `seconds` of game time (90 by default).
 * 'skimmer': Aegis AI (seat 0) against four Glare Skimmers (Vrax); 'bulwark': Vrax AI (seat 1) against four Bulwark Tanks.
 */
export function kiteBench(variant: KiteVariant, o: { seconds?: number; seed?: number; rules?: Partial<AiRules> } = {}): BenchResult {
  const seconds = o.seconds ?? 90;
  if (variant === 'skimmer') {
    return runBench({ seconds, seed: o.seed, ai: { seat: 0, faction: 'human', army: AEGIS_ARMY, rules: o.rules }, foe: { faction: 'alien', army: rep('ali_skimmer', 4), from: HARASS_FROM, policy: skimmerPolicy }, hold: 'ali_brute' });
  }
  return runBench({ seconds, seed: o.seed, ai: { seat: 1, faction: 'alien', army: VRAX_ARMY, rules: o.rules }, foe: { faction: 'human', army: rep('hum_tank', 4), from: HARASS_FROM, policy: bulwarkPolicy }, hold: 'hum_tank' });
}

// ---- HAR-10 overwhelm scenario ----

/** The Aegis wave: 8 Riflemen, 4 Rocketeers and 2 Bulwarks, 3400 credits. */
export const WAVE_ARMY: string[] = [...rep('hum_rifleman', 8), ...rep('hum_rocketeer', 4), ...rep('hum_tank', 2)];
/** Twice its power in Vrax: 6 Brutes, 8 Spitters and 8 Skitterers, 7380 credits. */
export const OVERWHELMING_ARMY: string[] = [...rep('ali_brute', 6), ...rep('ali_spitter', 8), ...rep('ali_skitter', 8)];

/** The enemy army marches on the AI's headquarters as one body (attack-move), re-ordered every decision. */
export const marchPolicy: Policy = (g, me) => {
  const mine = g.state.units.filter((u) => u.owner === me && unitDef(u.kind).weapon);
  if (mine.length === 0) return [];
  return [{ type: 'attackmove', player: me, units: mine.map((u) => u.id), x: (AI_HQ.tx + 1) * FP, y: (AI_HQ.ty + 1) * FP }];
};

/** Where the overwhelming army stops: the middle ground between the bases, which it takes and holds (HAR-10). */
export const HOLD_GROUND = { tx: 32, ty: 32 };

/** An army that takes HOLD_GROUND and holds it, fighting whatever comes within its reach. */
export const holdPolicy: Policy = (g, me) => {
  const mine = g.state.units.filter((u) => u.owner === me && unitDef(u.kind).weapon && u.target < 0);
  if (mine.length === 0) return [];
  return [{ type: 'attackmove', player: me, units: mine.map((u) => u.id), x: (HOLD_GROUND.tx + 1) * FP, y: (HOLD_GROUND.ty + 1) * FP }];
};

/**
 * The overwhelm scenario (HAR-10): an Aegis AI wave meets a Vrax army of about twice its power that has taken
 * the middle ground (HOLD_GROUND) and holds it; it fights what comes within reach but does not march on the AI's base, so the
 * scenario judges the wave's decision to retreat, not whether a base can survive an army twice its wave's size. The AI knows where the enemy headquarters is (so it sets out), but has not seen the army. It reports
 * `survival`: the share of the wave's starting value left after 60 s, and `stats.retreats`.
 */
export function overwhelmBench(o: { seconds?: number; seed?: number; rules?: Partial<AiRules> } = {}): BenchResult {
  return runBench({
    seconds: o.seconds ?? 60,
    seed: o.seed,
    intel: true,
    ai: { seat: 0, faction: 'human', army: WAVE_ARMY, rules: o.rules },
    foe: { faction: 'alien', army: OVERWHELMING_ARMY, from: [50, 50], policy: holdPolicy },
  });
}
