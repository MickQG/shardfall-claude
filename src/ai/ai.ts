import { BUILDING_DEFS, buildingDef, UNIT_DEFS, unitDef, type Faction, type UnitDef } from '../data/defs';
import { BUILD_RANGE, canPlace, EXPLORED, FP, QUEUE_MAX, Rng, VISIBLE, type BuildingSnap, type Command, type MapDef, type Snapshot, type UnitSnap } from '../sim';
import { kitOf, type Kit } from './kit';

/** Difficulty changes only how fast the AI reacts, how many orders it can give, and a shard-income bonus. */
export interface Difficulty {
  name: string;
  /** Ticks between decisions (reaction time). */
  thinkEvery: number;
  /** Maximum orders per decision (actions per minute). */
  maxCommands: number;
  /** Percent bonus (or handicap, if negative) on delivered shards. */
  bonus: number;
}

export const DIFFICULTIES: Readonly<Record<'easy' | 'medium' | 'hard', Difficulty>> = {
  easy: { name: 'easy', thinkEvery: 80, maxCommands: 2, bonus: -20 },
  medium: { name: 'medium', thinkEvery: 30, maxCommands: 5, bonus: 0 },
  hard: { name: 'hard', thinkEvery: 10, maxCommands: 10, bonus: 30 },
};

export type Role = 'inf' | 'at' | 'tank' | 'art' | 'air' | 'scout';

export const roleOf = (d: UnitDef): Role =>
  d.role === 'infantry' || d.role === 'raider' ? 'inf' : d.role === 'antiarmor' ? 'at' : d.role === 'tank' ? 'tank' : d.role === 'artillery' ? 'art' : d.role === 'air' ? 'air' : 'scout';

export interface Intel {
  /** Fractions (0..1) of recently seen armed enemy units. */
  air: number;
  heavy: number;
  light: number;
  /** Fraction that are infantry squads (BAL-6). */
  squads?: number;
  total: number;
}

const BASE_WEIGHTS: Record<Role, number> = { inf: 0.28, at: 0.2, tank: 0.32, art: 0.08, air: 0.08, scout: 0.04 };

/** Pick the next unit to train: fill the biggest gap between desired and actual composition, adapting to what the enemy fields. */
export function chooseUnitKind(cands: readonly string[], counts: Readonly<Record<Role, number>>, intel: Intel): string | null {
  if (cands.length === 0) return null;
  const army = Object.values(counts).reduce((a, b) => a + b, 0);
  const w = { ...BASE_WEIGHTS };
  if (intel.total >= 3) {
    if (intel.heavy > 0.4) {
      w.at += 0.25;
      w.art += 0.05;
    }
    if (intel.light > 0.5) {
      w.tank += 0.15;
      w.inf += 0.1;
    }
    // An infantry-heavy enemy is met with crushers and rifles rather than more anti-armour (BAL-6).
    if ((intel.squads ?? 0) > 0.45) {
      w.tank += 0.25;
      w.inf += 0.1;
      w.at = Math.max(0.05, w.at - 0.1);
    }
  }
  let best: string | null = null;
  let bs = -Infinity;
  for (const k of cands) {
    const d = unitDef(k);
    const r = roleOf(d);
    let score = w[r] * (army + 3) - counts[r];
    if (r === 'art' && counts.art >= Math.max(1, army * 0.25)) score -= 5;
    if (r === 'air' && counts.air >= Math.max(1, army * 0.25)) score -= 5;
    if (r === 'scout' && counts.scout >= 1) score -= 5;
    // Enemy aircraft: anti-air capable units are worth a premium until we have a few.
    if (intel.total >= 2 && intel.air > 0.12 && d.weapon?.antiAir) score += 1.5 + 4 * intel.air;
    if (score > bs || (score === bs && best !== null && d.cost < unitDef(best).cost)) {
      bs = score;
      best = k;
    }
  }
  return best;
}

/** Launch a wave only with a real army that clearly outclasses what we know of the target. */
/** How far (tiles) an AI crusher looks for enemy infantry to run over, and how far past them it drives (BAL-5). */
export const CRUSH_REACH = 7;
export const CRUSH_OVERRUN = 1.5;

/**
 * Crush micro (BAL-5): each healthy crusher that sees an enemy infantry squad within reach drives through it (a plain
 * move to a point just beyond the squad), so it runs the squad over instead of standing and trading shots. Pure: a
 * function of what the player can see.
 */
export function crushOrders(player: number, own: readonly UnitSnap[], foes: readonly UnitSnap[], mapW: number, mapH: number): Command[] {
  const out: Command[] = [];
  const squads = foes.filter((f) => f.owner !== player && (unitDef(f.kind).squad ?? 1) > 1);
  if (squads.length === 0) return out;
  for (const u of own) {
    const d = unitDef(u.kind);
    if (u.owner !== player || !d.crusher || u.hp * 10 < d.hp * 3) continue;
    let best: UnitSnap | null = null;
    let bd = CRUSH_REACH * FP;
    for (const f of squads) {
      const fd = Math.hypot(f.x - u.x, f.y - u.y);
      if (fd < bd || (fd === bd && best !== null && f.id < best.id)) {
        bd = fd;
        best = f;
      }
    }
    if (!best) continue;
    const len = Math.max(1, bd);
    const x = Math.max(0, Math.min(mapW * FP - 1, Math.round(best.x + ((best.x - u.x) * CRUSH_OVERRUN * FP) / len)));
    const y = Math.max(0, Math.min(mapH * FP - 1, Math.round(best.y + ((best.y - u.y) * CRUSH_OVERRUN * FP) / len)));
    out.push({ type: 'move', player, units: [u.id], x, y });
  }
  return out;
}

export function shouldAttack(myPower: number, enemyEstimate: number, armyCount: number, threshold: number, ratio = 1.25): boolean {
  return armyCount >= 5 && myPower >= threshold && myPower >= ratio * enemyEstimate;
}

const tileOf = (v: number): number => Math.floor(v / FP);
const dist = (ax: number, ay: number, bx: number, by: number): number => Math.hypot(ax - bx, ay - by);

interface Remembered {
  kind: string;
  x: number;
  y: number;
  t: number;
}

interface Wave {
  tx: number;
  ty: number;
  startPower: number;
  lastOrder: number;
  /** The units in the wave, and how many set out (AI-11). */
  members: Set<number>;
  size: number;
  /** Whether the last order held the wave back to close up. */
  held: boolean;
}

/** Wave pacing (AI-11): ticks between orders, tiles per hop, the spread at which it closes up, and gathering rules. */
export const WAVE_STEP = 60;
export const WAVE_HOP = 8;
export const WAVE_SPREAD = 4;
export const GATHER_R = 9;
export const GATHER_SHARE = 0.75;
export const GATHER_WAIT = 900;

export interface AiStats {
  waves: number;
  retreats: number;
  /** Waves launched into clearly stronger opposition. */
  suicides: number;
  /** Waves launched with fewer than five units. */
  lone: number;
  scoutedAt: number;
  defends: number;
  superweaponShots: number;
}

type Ctx = {
  snap: Snapshot;
  tick: number;
  own: UnitSnap[];
  foes: UnitSnap[];
  buildings: BuildingSnap[];
  enemyBuildings: BuildingSnap[];
  hq: BuildingSnap;
  credits: number;
  powerOut: number;
  powerIn: number;
  counts: Map<string, number>;
  army: UnitSnap[];
  haulers: UnitSnap[];
};

/**
 * An ordinary client of the simulation: it sees only its own fog-limited snapshot plus the static map
 * and answers with ordinary commands. Nothing here reads hidden state.
 */
export class AI {
  readonly kit: Kit;
  readonly stats: AiStats = { waves: 0, retreats: 0, suicides: 0, lone: 0, scoutedAt: -1, defends: 0, superweaponShots: 0 };
  private intel = new Map<number, Remembered>();
  private wave: Wave | null = null;
  private waveCooldown = 0;
  /** When the army was first strong enough to attack but not yet gathered, or -1. */
  private gatherSince = -1;
  private scoutId = -1;
  private lastScout = -100000;
  private defend = { tick: -1000, x: 0, y: 0 };
  private lastThreat = -100000;
  private idle = new Map<number, { x: number; y: number; n: number }>();
  private staging: { tx: number; ty: number } | null = null;
  private home: { tx: number; ty: number } | null = null;
  private attacks = 0;
  private lastWaveEnd = 0;
  /** Seeded personality so repeated games differ a little: attack timing, staging distance. */
  private readonly jitter: { wave: number; ratio: number; stage: number };

  constructor(
    readonly player: number,
    readonly faction: Faction,
    readonly diff: Difficulty,
    private map: MapDef,
    seed = 0,
  ) {
    this.kit = kitOf(faction);
    const r = new Rng(seed * 7919 + player * 104729 + 13);
    const f = (): number => r.int(1000) / 1000;
    this.jitter = { wave: 0.9 + 0.35 * f(), ratio: 1.15 + 0.3 * f(), stage: 11 + Math.floor(4 * f()) };
  }

  /** Decide this tick's orders from a fog-limited snapshot. */
  think(snap: Snapshot): Command[] {
    const me = this.player;
    const buildings = snap.buildings.filter((b) => b.owner === me);
    const hq = buildings.find((b) => buildingDef(b.kind).hq);
    const pl = snap.players[me];
    if (!hq || !pl || !snap.fog) return [];
    const own = snap.units.filter((u) => u.owner === me);
    const foes = snap.units.filter((u) => u.owner !== me);
    const counts = new Map<string, number>();
    for (const b of buildings) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    for (const q of hq.queue) counts.set(q.kind, (counts.get(q.kind) ?? 0) + 1);
    const haulers = own.filter((u) => unitDef(u.kind).capacity !== undefined);
    const army = own.filter((u) => unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined && u.id !== this.scoutId);
    const c: Ctx = {
      snap, tick: snap.tick, own, foes, buildings,
      enemyBuildings: [...snap.buildings.filter((b) => b.owner !== me), ...snap.ghosts],
      hq, credits: pl.credits, powerOut: pl.powerOut, powerIn: pl.powerIn, counts, army, haulers,
    };
    this.updateIntel(c);
    this.setupPoints(c);

    const out: Command[] = [];
    this.placeReady(c, out);
    this.defendBase(c, out);
    this.structures(c, out);
    this.production(c, out);
    this.economy(c, out);
    this.attackLogic(c, out);
    this.scout(c, out);
    this.maintain(c, out);
    this.superweapon(c, out);
    // Crush orders go last so they override this tick's wave orders for the same units, and always get a share of the
    // command budget (BAL-5).
    const crush = crushOrders(me, c.army, c.foes, snap.mapWidth, snap.mapHeight).slice(0, Math.max(1, Math.ceil(this.diff.maxCommands / 2)));
    return [...out.slice(0, this.diff.maxCommands - crush.length), ...crush];
  }

  // ---------------------------------------------------------------- knowledge

  private updateIntel(c: Ctx): void {
    const { snap } = c;
    const W = snap.mapWidth;
    const seen = new Set<number>();
    for (const u of c.foes) {
      this.intel.set(u.id, { kind: u.kind, x: u.x, y: u.y, t: c.tick });
      seen.add(u.id);
    }
    for (const [id, e] of this.intel) {
      if (seen.has(id)) continue;
      const visible = ((snap.fog?.[tileOf(e.y) * W + tileOf(e.x)] ?? 0) & VISIBLE) !== 0;
      if (visible || c.tick - e.t > 2400) this.intel.delete(id);
    }
  }

  private setupPoints(c: Ctx): void {
    if (this.home) return;
    const W = this.map.width;
    const H = this.map.height;
    const d = buildingDef(c.hq.kind);
    const hx = c.hq.tx + d.w / 2;
    const hy = c.hq.ty + d.h / 2;
    this.home = { tx: Math.floor(hx), ty: Math.floor(hy) };
    // Symmetric map: the opponent starts opposite us. A human can read this off the map too.
    const ex = W - hx;
    const ey = H - hy;
    const len = Math.hypot(ex - hx, ey - hy) || 1;
    const sx = hx + ((ex - hx) / len) * this.jitter.stage;
    const sy = hy + ((ey - hy) / len) * this.jitter.stage;
    this.staging = this.nearestFree(Math.floor(sx), Math.floor(sy));
  }

  private enemyStart(): { tx: number; ty: number } {
    const home = this.home as { tx: number; ty: number };
    return this.nearestFree(this.map.width - home.tx - 1, this.map.height - home.ty - 1);
  }

  private nearestFree(tx: number, ty: number): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    for (let r = 0; r < 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (x >= 0 && y >= 0 && x < W && y < H && !this.map.blocked?.[y * W + x]) return { tx: x, ty: y };
        }
      }
    }
    return { tx, ty };
  }

  private intelSummary(c: Ctx): Intel {
    let air = 0;
    let heavy = 0;
    let light = 0;
    let squads = 0;
    let total = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d || !d.weapon || c.tick - e.t > 2400) continue;
      total++;
      if ((d.squad ?? 1) > 1) squads++;
      if (d.armor === 'air') air++;
      else if (d.armor === 'heavy') heavy++;
      else light++;
    }
    return total === 0 ? { air: 0, heavy: 0, light: 0, squads: 0, total: 0 } : { air: air / total, heavy: heavy / total, light: light / total, squads: squads / total, total };
  }

  /** Cost-weighted strength of the remembered enemy army and defences within `r` tiles of a tile. */
  private enemyPowerNear(c: Ctx, tx: number, ty: number, r: number): number {
    let p = 0;
    for (const e of this.intel.values()) {
      const d = UNIT_DEFS[e.kind];
      if (!d?.weapon || c.tick - e.t > 1800) continue;
      if (dist(tileOf(e.x), tileOf(e.y), tx, ty) <= r) p += d.cost;
    }
    for (const b of c.enemyBuildings) {
      const d = buildingDef(b.kind);
      if (d.weapon && dist(b.tx, b.ty, tx, ty) <= r + 2) p += d.cost * 1.5;
    }
    return p;
  }

  private armyPower(units: readonly UnitSnap[]): number {
    let p = 0;
    for (const u of units) {
      const d = unitDef(u.kind);
      p += (d.cost * u.hp) / d.hp;
    }
    return p;
  }

  // ---------------------------------------------------------------- structures

  private can(c: Ctx, kind: string, extra = 0): boolean {
    const d = buildingDef(kind);
    return c.credits >= d.cost + extra && d.requires.every((r) => (c.counts.get(r) ?? 0) > 0 && c.buildings.some((b) => b.kind === r));
  }

  /** The structure we want next, ignoring affordability. Order encodes the build order. */
  private wantedStructure(c: Ctx): string | null {
    const k = this.kit;
    const n = (kind: string): number => c.counts.get(kind) ?? 0;
    const queuedDrain = c.hq.queue.reduce((s, q) => s + Math.max(0, -buildingDef(q.kind).power), 0);
    const margin = c.powerOut - c.powerIn - queuedDrain;
    const haulers = c.haulers.length;
    const refineries = n(k.refinery);
    const turretsWanted = Math.min(6, (c.tick < 3000 ? 0 : c.tick < 6500 ? 1 : c.tick < 11000 ? 2 : 3) + Math.min(3, this.attacks));

    if (c.powerIn > c.powerOut || margin < 15) return k.power;
    if (n(k.barracks) === 0) return k.barracks;
    if (refineries < 2) return k.refinery;
    if (margin < 35) return k.power;
    if (n(k.factory) === 0) return k.factory;
    if (n(k.turret) < turretsWanted) return k.turret;
    const rich = c.credits > 3000 ? 2 : c.credits > 1400 ? 1 : 0;
    if (n(k.barracks) < 1 + rich + (c.tick > 5000 ? 1 : 0) && n(k.barracks) < 4) return k.barracks;
    if (n(k.lab) === 0 && c.credits > 1100) return k.lab;
    if (n(k.factory) < 1 + rich && n(k.factory) < 3) return k.factory;
    if (refineries < 3 && haulers >= 4 && c.credits > 1100) return k.refinery;
    if (n(k.superweapon) === 0 && n(k.lab) > 0) {
      const sw = buildingDef(k.superweapon);
      if (margin < -sw.power + 10) return k.power;
      return k.superweapon;
    }
    if (c.credits > 4000 && n(k.barracks) < 5) return k.barracks;
    if (c.credits > 4000 && n(k.factory) < 4) return k.factory;
    if (n(k.turret) < 6 && c.credits > 1800) return k.turret;
    if (n(k.power) < 8 && margin < 80 && c.credits > 1200) return k.power;
    return null;
  }

  private structures(c: Ctx, out: Command[]): void {
    if (c.hq.queue.length > 0) return;
    const kind = this.wantedStructure(c);
    if (kind && this.can(c, kind)) out.push({ type: 'produce', player: this.player, source: c.hq.id, kind });
  }

  private placeReady(c: Ctx, out: Command[]): void {
    const head = c.hq.queue[0];
    if (!head?.ready) return;
    const spot = this.findSpot(c, head.kind);
    if (spot) out.push({ type: 'place', player: this.player, source: c.hq.id, tx: spot.tx, ty: spot.ty });
    else out.push({ type: 'cancel', player: this.player, source: c.hq.id, index: 0 });
  }

  private findSpot(c: Ctx, kind: string): { tx: number; ty: number } | null {
    const { snap } = c;
    const d = buildingDef(kind);
    const W = snap.mapWidth;
    const fog = snap.fog as Uint8Array;
    const occupied = [...snap.buildings, ...snap.ghosts];
    const ctx = { width: W, height: snap.mapHeight, terrain: this.map.blocked, occupied, own: c.buildings, fog };
    const occ = new Set<number>();
    for (const b of occupied) {
      const bd = buildingDef(b.kind);
      for (let y = b.ty; y < b.ty + bd.h; y++) for (let x = b.tx; x < b.tx + bd.w; x++) occ.add(y * W + x);
    }
    const home = this.home as { tx: number; ty: number };
    const stage = this.staging as { tx: number; ty: number };
    const dir = { x: stage.tx - home.tx, y: stage.ty - home.ty };
    const dl = Math.hypot(dir.x, dir.y) || 1;
    // Nearest shard tile, for refineries.
    const fields: [number, number][] = [];
    if (d.refinery) for (let i = 0; i < snap.shards.length; i += 3) if ((snap.shards[i] as number) > 0) fields.push([i % W, Math.floor(i / W)]);
    let best: { tx: number; ty: number } | null = null;
    let bs = Infinity;
    const minX = Math.min(...c.buildings.map((b) => b.tx)) - BUILD_RANGE - d.w;
    const maxX = Math.max(...c.buildings.map((b) => b.tx)) + BUILD_RANGE + 4;
    const minY = Math.min(...c.buildings.map((b) => b.ty)) - BUILD_RANGE - d.h;
    const maxY = Math.max(...c.buildings.map((b) => b.ty)) + BUILD_RANGE + 4;
    // Ties are broken by scan order; scan from the far corner for the bottom-right player so both sides resolve ties symmetrically.
    const flip = home.tx > W / 2;
    const y0 = Math.max(0, minY);
    const y1 = Math.min(snap.mapHeight - d.h, maxY);
    const x0 = Math.max(0, minX);
    const x1 = Math.min(W - d.w, maxX);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const tx = flip ? x1 - (ix - x0) : ix;
        const ty = flip ? y1 - (iy - y0) : iy;
        if (!canPlace(ctx, kind, tx, ty)) continue;
        // A compact base: nothing strays far from the headquarters (no creeping chains toward the enemy).
        const reach = d.refinery ? 24 : d.weapon ? 13 : 16;
        if (dist(tx + d.w / 2, ty + d.h / 2, home.tx, home.ty) > reach) continue;
        let score = 0;
        // Keep a one-tile gap so units are never walled in.
        let touching = 0;
        for (let y = ty - 1; y <= ty + d.h; y++) for (let x = tx - 1; x <= tx + d.w; x++) if (occ.has(y * W + x) || this.map.blocked?.[y * W + x]) touching++;
        score += touching * (d.weapon ? 1 : 6);
        // Never build on crystal.
        for (let y = ty; y < ty + d.h; y++) for (let x = tx; x < tx + d.w; x++) if ((snap.shards[y * W + x] as number) > 0) score += 80;
        const cx = tx + d.w / 2;
        const cy = ty + d.h / 2;
        const toward = ((cx - home.tx) * dir.x + (cy - home.ty) * dir.y) / dl;
        if (d.weapon) score -= toward * 2.2; // defences face the enemy
        else if (d.refinery) {
          let nearest = 40;
          for (const [fx, fy] of fields) nearest = Math.min(nearest, dist(cx, cy, fx, fy));
          score += nearest * 3;
        } else score += Math.max(0, toward) * 1.5 + dist(cx, cy, home.tx, home.ty) * 0.8; // soft buildings stay behind the lines
        if (score < bs) {
          bs = score;
          best = { tx, ty };
        }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- units

  private production(c: Ctx, out: Command[]): void {
    const intel = this.intelSummary(c);
    const counts: Record<Role, number> = { inf: 0, at: 0, tank: 0, art: 0, air: 0, scout: 0 };
    for (const u of c.army) counts[roleOf(unitDef(u.kind))]++;
    if (this.scoutId >= 0) counts.scout++;
    const queued = new Map<string, number>();
    for (const b of c.buildings) for (const q of b.queue) if (!BUILDING_DEFS[q.kind]) queued.set(q.kind, (queued.get(q.kind) ?? 0) + 1);
    for (const [kind, n] of queued) counts[roleOf(unitDef(kind))] += n;

    const next = this.wantedStructure(c);
    const hold = next && c.hq.queue.length === 0 ? Math.min(buildingDef(next).cost, 750) : 0;
    const urgent = c.army.length < 4 || c.tick - this.lastThreat < 600;
    const haulerWanted = this.haulerTarget(c) - c.haulers.length - (queued.get(this.kit.hauler) ?? 0);

    for (const b of c.buildings) {
      const depth = c.credits > 3000 ? 5 : c.credits > 2000 ? 4 : c.credits > 1100 ? 3 : 2;
      if (b.queue.length >= depth || b.queue.length >= QUEUE_MAX) continue;
      const trainable = Object.keys(UNIT_DEFS).filter((k) => unitDef(k).builtAt === b.kind && unitDef(k).faction === this.faction);
      if (trainable.length === 0) continue;
      // A hero only while the player has none, alive or queued (HERO-1).
      const allowed = trainable.filter((k) => unitDef(k).requires.every((r) => c.buildings.some((x) => x.kind === r)) && !(unitDef(k).hero && (queued.has(k) || c.own.some((u) => u.kind === k))));
      // Its hero takes the field whenever it is available and affordable with credits to spare (HERO-1).
      const hero = allowed.find((k) => unitDef(k).hero && c.credits >= unitDef(k).cost + 400);
      const pick: string | null =
        b.kind === this.kit.factory && haulerWanted > 0 && allowed.includes(this.kit.hauler) ? this.kit.hauler : (hero ?? chooseUnitKind(allowed.filter((k) => k !== this.kit.hauler && !unitDef(k).hero), counts, intel));
      if (!pick) continue;
      const cost = unitDef(pick).cost;
      const reserve = pick === this.kit.hauler || urgent ? 0 : hold;
      if (c.credits < cost + reserve) continue;
      c.credits -= cost;
      out.push({ type: 'produce', player: this.player, source: b.id, kind: pick });
      counts[roleOf(unitDef(pick))]++;
      if (pick === this.kit.hauler || unitDef(pick).hero) queued.set(pick, (queued.get(pick) ?? 0) + 1);
    }
  }

  private haulerTarget(c: Ctx): number {
    const refs = c.buildings.filter((b) => buildingDef(b.kind).refinery).length;
    return refs === 0 ? 0 : Math.min(7, refs * 2 + 1);
  }

  private economy(c: Ctx, out: Command[]): void {
    const W = c.snap.mapWidth;
    const fieldsNear = (hx: number, hy: number): { x: number; y: number } | null => {
      let best: { x: number; y: number } | null = null;
      let bd = Infinity;
      for (let i = 0; i < c.snap.shards.length; i++) {
        if ((c.snap.shards[i] as number) === 0) continue;
        const x = i % W;
        const y = Math.floor(i / W);
        // Avoid fields with remembered enemy troops on them.
        if (this.enemyPowerNear(c, x, y, 8) > 150) continue;
        const d = dist(x, y, hx, hy);
        if (d < bd) {
          bd = d;
          best = { x, y };
        }
      }
      return best;
    };
    for (const h of c.haulers) {
      const prev = this.idle.get(h.id);
      const still = prev && prev.x === h.x && prev.y === h.y;
      const n = still ? prev.n + 1 : 0;
      this.idle.set(h.id, { x: h.x, y: h.y, n });
      if (n >= 3 && h.dest === null) {
        const f = fieldsNear(tileOf(h.x), tileOf(h.y));
        if (f) out.push({ type: 'harvest', player: this.player, units: [h.id], x: f.x * FP + FP / 2, y: f.y * FP + FP / 2 });
        this.idle.set(h.id, { x: h.x, y: h.y, n: 0 });
      }
    }
  }

  // ---------------------------------------------------------------- army

  private defendBase(c: Ctx, out: Command[]): void {
    const threats = c.foes.filter((u) => unitDef(u.kind).weapon && c.buildings.some((b) => dist(tileOf(u.x), tileOf(u.y), b.tx, b.ty) <= 16));
    if (threats.length === 0) return;
    const power = this.armyPower(threats);
    if (power < 180 && threats.length < 2) return;
    if (c.tick - this.lastThreat > 600) this.attacks++;
    this.lastThreat = c.tick;
    const cx = threats.reduce((s, u) => s + u.x, 0) / threats.length;
    const cy = threats.reduce((s, u) => s + u.y, 0) / threats.length;
    const moved = dist(cx / FP, cy / FP, this.defend.x / FP, this.defend.y / FP) > 5;
    if (c.tick - this.defend.tick < 40 && !moved) return;
    this.defend = { tick: c.tick, x: cx, y: cy };
    if (this.wave) {
      this.wave = null;
      this.waveCooldown = c.tick + 500;
    }
    const ids = c.army.map((u) => u.id);
    if (ids.length > 0) {
      this.stats.defends++;
      out.push({ type: 'attackmove', player: this.player, units: ids, x: Math.round(cx), y: Math.round(cy) });
    }
  }

  private nearestEnemyBuilding(c: Ctx, tx: number, ty: number): BuildingSnap | null {
    let best: BuildingSnap | null = null;
    let bd = Infinity;
    for (const b of c.enemyBuildings) {
      const d = dist(b.tx, b.ty, tx, ty);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  private searchPoint(c: Ctx): { tx: number; ty: number } {
    const W = this.map.width;
    const H = this.map.height;
    const start = this.enemyStart();
    const pts = [start, { tx: W >> 1, ty: H >> 1 }, { tx: W >> 2, ty: (3 * H) >> 2 }, { tx: (3 * W) >> 2, ty: H >> 2 }, { tx: W >> 2, ty: H >> 2 }, { tx: (3 * W) >> 2, ty: (3 * H) >> 2 }];
    for (const p of pts) {
      const f = c.snap.fog?.[p.ty * W + p.tx] ?? 0;
      if ((f & EXPLORED) === 0) return this.nearestFree(p.tx, p.ty);
    }
    return this.nearestFree(start.tx, start.ty);
  }

  private attackLogic(c: Ctx, out: Command[]): void {
    const stage = this.staging as { tx: number; ty: number };
    const army = c.army;
    if (army.length === 0) {
      if (this.wave) this.wave = null;
      return;
    }
    const threatened = c.tick - this.lastThreat < 200;
    const order = (type: 'move' | 'attackmove', units: UnitSnap[], x: number, y: number): void => {
      if (units.length > 0) out.push({ type, player: this.player, units: units.map((u) => u.id), x: Math.floor(x) * FP + FP / 2, y: Math.floor(y) * FP + FP / 2 });
    };
    const centre = (us: UnitSnap[]): { x: number; y: number } => ({ x: us.reduce((s, u) => s + u.x, 0) / us.length / FP, y: us.reduce((s, u) => s + u.y, 0) / us.length / FP });

    if (this.wave) {
      const w = this.wave;
      // The wave is the units that set out together (AI-11); others are reinforcements.
      const members = army.filter((u) => w.members.has(u.id));
      const rest = army.filter((u) => !w.members.has(u.id));
      const p = this.armyPower(members);
      const { x: cx, y: cy } = members.length ? centre(members) : { x: stage.tx, y: stage.ty };
      const local = this.enemyPowerNear(c, Math.floor(cx), Math.floor(cy), 11);
      if (p <= 0.45 * w.startPower || members.length <= 2 || local >= 1.5 * p) {
        this.stats.retreats++;
        order('move', members, stage.tx, stage.ty);
        this.wave = null;
        this.waveCooldown = c.tick + 1200;
        this.lastWaveEnd = c.tick;
        return;
      }
      if (c.tick - w.lastOrder >= WAVE_STEP) {
        // Retarget when the objective is gone or reached.
        const near = dist(cx, cy, w.tx, w.ty) < 6;
        const known = c.enemyBuildings.some((b) => dist(b.tx, b.ty, w.tx, w.ty) < 4);
        if (near && !known) {
          const nb = this.nearestEnemyBuilding(c, Math.floor(cx), Math.floor(cy));
          const t = nb ? { tx: nb.tx, ty: nb.ty } : this.searchPoint(c);
          w.tx = t.tx;
          w.ty = t.ty;
        }
        w.lastOrder = c.tick;
        // Advance as one body (AI-11): the whole wave attack-moves to a point a short hop ahead of its centre, so the
        // fast wait there for the slow; strung out, it closes up on its centre first; close to the objective it goes in.
        // Spread: how far most of the wave (four in five) is from its centre; a big wave is naturally wider.
        const ds = members.map((u) => dist(u.x / FP, u.y / FP, cx, cy)).sort((a, b) => a - b);
        const spread = ds[Math.floor(0.8 * (ds.length - 1))] ?? 0;
        const strung = spread > WAVE_SPREAD + Math.sqrt(members.length) && !w.held;
        w.held = strung; // never hold back two hops running
        const d = dist(cx, cy, w.tx, w.ty);
        const k = strung ? 0 : d <= WAVE_HOP + 2 ? 1 : WAVE_HOP / d;
        order('attackmove', members, cx + (w.tx - cx) * k, cy + (w.ty - cy) * k);
        // Reinforcements gather at the staging point and join in groups, never one at a time.
        const home = rest.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) < 10);
        if (home.length >= Math.max(3, Math.ceil(0.25 * w.size))) {
          order('attackmove', home, cx, cy);
          for (const u of home) w.members.add(u.id);
        } else order('attackmove', rest.filter((u) => u.dest === null && !home.includes(u)), stage.tx, stage.ty);
      }
      return;
    }

    if (!threatened) {
      // Gather at the staging point.
      const away = army.filter((u) => u.dest === null && dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) > 7);
      if (away.length > 0 && c.tick % 3 === 0) order('attackmove', away, stage.tx, stage.ty);
    }

    if (threatened || c.tick < this.waveCooldown) return;
    const p = this.armyPower(army);
    const threshold = Math.min(4200, (1100 + 450 * this.stats.waves) * this.jitter.wave);
    const known = this.nearestEnemyBuilding(c, stage.tx, stage.ty);
    const target = known ? { tx: known.tx, ty: known.ty } : this.enemyStart();
    // Attack only on fresh intel: what we have recently seen of their army (anywhere), plus their defences at the target.
    // Without it we are blind, and a blind attack into a defender with reinforcements is how armies get lost.
    const recent = [...this.intel.values()].filter((e) => UNIT_DEFS[e.kind]?.weapon && c.tick - e.t <= 1200);
    const seen = recent.reduce((s, e) => s + (UNIT_DEFS[e.kind]?.cost ?? 0), 0);
    const defences = c.enemyBuildings.reduce((s, b) => (buildingDef(b.kind).weapon && dist(b.tx, b.ty, target.tx, target.ty) <= 14 ? s + buildingDef(b.kind).cost * 1.5 : s), 0);
    const blind = recent.length === 0;
    const stalemate = c.tick - this.lastWaveEnd > 7000;
    const est = blind ? (stalemate ? 1.1 * p : 3 * p) : 1.15 * seen + defences + 250;
    if (!shouldAttack(p, est, army.length, threshold, this.jitter.ratio)) {
      this.gatherSince = -1;
      return;
    }
    // Strong enough: set out only once most of the army has gathered at the staging point (AI-11), or after a while.
    const gathered = army.filter((u) => dist(tileOf(u.x), tileOf(u.y), stage.tx, stage.ty) <= GATHER_R);
    if (this.gatherSince < 0) this.gatherSince = c.tick;
    if (gathered.length < GATHER_SHARE * army.length && c.tick - this.gatherSince < GATHER_WAIT) return;
    this.gatherSince = -1;
    const wave = gathered.length >= 3 ? gathered : army;
    this.stats.waves++;
    if (p < 0.8 * est) this.stats.suicides++;
    if (wave.length < 5) this.stats.lone++;
    this.wave = { tx: target.tx, ty: target.ty, startPower: this.armyPower(wave), lastOrder: c.tick, members: new Set(wave.map((u) => u.id)), size: wave.length, held: false };
    const { x, y } = centre(wave);
    const d = dist(x, y, target.tx, target.ty);
    order('attackmove', wave, x + ((target.tx - x) * Math.min(d, WAVE_HOP)) / Math.max(1, d), y + ((target.ty - y) * Math.min(d, WAVE_HOP)) / Math.max(1, d));
  }


  // ---------------------------------------------------------------- scouting

  private scout(c: Ctx, out: Command[]): void {
    const me = c.own.find((u) => u.id === this.scoutId);
    if (this.scoutId >= 0 && !me) this.scoutId = -1;
    const knowEnemy = c.enemyBuildings.length > 0;
    if (knowEnemy && this.stats.scoutedAt < 0) this.stats.scoutedAt = c.tick;
    const stage = this.staging as { tx: number; ty: number };

    if (me) {
      // A scout is expendable until it has been hit; then it falls back with what it learned.
      const hurt = me.hp < unitDef(me.kind).hp * 0.55;
      const danger = hurt && c.foes.some((u) => unitDef(u.kind).weapon && dist(tileOf(u.x), tileOf(u.y), tileOf(me.x), tileOf(me.y)) < 9);
      const done = knowEnemy && c.tick - this.lastScout > 900;
      if (danger || done) {
        out.push({ type: 'move', player: this.player, units: [me.id], x: stage.tx * FP + FP / 2, y: stage.ty * FP + FP / 2 });
        if (done || dist(tileOf(me.x), tileOf(me.y), stage.tx, stage.ty) < 8) this.scoutId = -1;
      }
      return;
    }
    const fresh = [...this.intel.values()].some((e) => UNIT_DEFS[e.kind]?.weapon && c.tick - e.t <= 900);
    const due = c.tick > 1100 && (!knowEnemy || !fresh);
    if (!due || c.tick - this.lastScout < 1500) return;
    // Prefer a genuinely fast scout, else spare a basic infantry unit.
    const cands = c.army.filter((u) => u.dest === null).sort((a, b) => unitDef(b.kind).speed - unitDef(a.kind).speed || a.id - b.id);
    const pick = cands.find((u) => unitDef(u.kind).role === 'scout') ?? (c.tick > 1500 ? cands[cands.length - 1] : undefined);
    if (!pick) return;
    this.scoutId = pick.id;
    this.lastScout = c.tick;
    const target = this.enemyStart();
    out.push({ type: 'move', player: this.player, units: [pick.id], x: target.tx * FP + FP / 2, y: target.ty * FP + FP / 2 });
  }

  // ---------------------------------------------------------------- upkeep

  private maintain(c: Ctx, out: Command[]): void {
    for (const b of c.buildings) {
      const d = buildingDef(b.kind);
      const hot = c.foes.some((u) => unitDef(u.kind).weapon && dist(tileOf(u.x), tileOf(u.y), b.tx, b.ty) <= 9);
      if (!d.hq && b.hp < d.hp * 0.18 && hot) {
        out.push({ type: 'sell', player: this.player, building: b.id }); // salvage what we can
      } else if (!hot && b.hp < d.hp * 0.75 && !b.repairing && c.credits > 350) {
        out.push({ type: 'repair', player: this.player, building: b.id, on: true });
      }
    }
  }

  private superweapon(c: Ctx, out: Command[]): void {
    const sw = c.buildings.find((b) => buildingDef(b.kind).superweapon && b.charge >= 100);
    if (!sw) return;
    const radius = (buildingDef(sw.kind).superweapon as { radius: number }).radius;
    let best: { tx: number; ty: number } | null = null;
    let bs = 500;
    for (const t of c.enemyBuildings) {
      let score = 0;
      for (const o of c.enemyBuildings) if (dist(o.tx, o.ty, t.tx, t.ty) <= radius) score += buildingDef(o.kind).cost;
      for (const e of this.intel.values()) if (c.tick - e.t < 300 && dist(tileOf(e.x), tileOf(e.y), t.tx, t.ty) <= radius) score += (UNIT_DEFS[e.kind]?.cost ?? 0) * 0.5;
      // Never hit ourselves.
      const friendly = c.own.some((u) => dist(tileOf(u.x), tileOf(u.y), t.tx, t.ty) <= radius + 2) || c.buildings.some((b) => dist(b.tx, b.ty, t.tx, t.ty) <= radius + 3);
      if (!friendly && score > bs) {
        bs = score;
        best = { tx: t.tx + 1, ty: t.ty + 1 };
      }
    }
    if (!best) return;
    this.stats.superweaponShots++;
    out.push({ type: 'superweapon', player: this.player, building: sw.id, x: best.tx * FP + FP / 2, y: best.ty * FP + FP / 2 });
  }
}
