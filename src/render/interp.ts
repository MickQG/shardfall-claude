import type { UnitSnap } from '../sim';

export interface RenderUnit {
  id: number;
  owner: number;
  kind: string;
  /** Tile-space position (fractional). */
  tx: number;
  ty: number;
  hp: number;
  /** Shards carried (haulers). */
  load: number;
  /** Veterancy rank 0..3. */
  rank: number;
  /** Current attack target id, or -1. */
  target: number;
  /** For units the simulation turns (HERO-5): the facing, radians, 0 along +x and increasing toward +y. */
  yaw?: number;
  /** Haulers unloading on a dock pad: the refinery's id (ECO-7, R3D-22). */
  dock?: number;
}

const SCALE = 256;

/** A simulation facing (256 steps a circle) as radians, turned the short way from `from` to `to` by `a` (HERO-5). */
export function facingYaw(from: number, to: number, a: number): number {
  const d = ((((to - from) % 256) + 256 + 128) % 256) - 128;
  return ((from + d * a) * Math.PI * 2) / 256;
}

/** Interpolate unit positions between two snapshots; alpha is clamped to [0, 1]. */
export function interpolate(prev: readonly UnitSnap[], curr: readonly UnitSnap[], alpha: number): RenderUnit[] {
  const before = new Map<number, UnitSnap>();
  for (const u of prev) before.set(u.id, u);
  return between(before, curr, curr, alpha);
}

/**
 * The units of `latest` (everything but position and facing as `latest` has them), placed `alpha` of the way from
 * their state in `from` to their state in `to`; a unit missing from either takes its state from the next one.
 */
function between(from: ReadonlyMap<number, UnitSnap>, to: ReadonlyMap<number, UnitSnap> | readonly UnitSnap[], latest: readonly UnitSnap[], alpha: number): RenderUnit[] {
  const a = Math.min(1, Math.max(0, alpha));
  const toMap = to instanceof Map ? (to as ReadonlyMap<number, UnitSnap>) : null;
  return latest.map((u) => {
    const q = toMap?.get(u.id) ?? u;
    const p = from.get(u.id) ?? q;
    return {
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      tx: (p.x + (q.x - p.x) * a) / SCALE,
      ty: (p.y + (q.y - p.y) * a) / SCALE,
      hp: u.hp,
      load: u.load,
      rank: u.rank,
      target: u.target,
      ...(u.facing !== undefined ? { yaw: facingYaw(p.facing ?? q.facing ?? u.facing, q.facing ?? u.facing, a) } : {}),
      ...(u.dock !== undefined ? { dock: u.dock } : {}),
    };
  });
}

/** Real milliseconds between the worker's batches of ticks: it runs every half tick (host/worker.ts). */
export const ARRIVAL_MS = 25;
/** How much later than usual a snapshot may arrive before the drawn time has to wait for it, ms (R3D-10). */
export const DRAW_MARGIN_MS = 25;
/** How quickly the drawn time is pulled toward its target, per second (R3D-10): slow, so arrival jitter is averaged out. */
const PULL = 3;
/** Snapshots kept to draw between: enough to cover the lead at the fastest game speed. */
const KEEP = 8;

/**
 * The drawn time (R3D-10). Snapshots arrive unevenly (the worker sends them on a 25 ms timer, so at speed ×0.8 they
 * come 50 and 75 ms apart); placing units by the time since the last arrival makes them stall and leap. Instead the
 * drawn time runs at the game's own pace, a fixed lead behind the newest snapshot (one arrival gap plus a margin), and
 * units are placed between the two snapshots around it. It never runs backwards and never passes the newest snapshot,
 * so nothing is drawn before the simulation has done it (UI-15).
 */
export class DrawClock {
  private hist: { tick: number; at: number; units: readonly UnitSnap[]; byId: Map<number, UnitSnap> | null }[] = [];
  private t = Number.NaN;
  private last = Number.NaN;

  /** `margin`: how much later than usual a snapshot may arrive before the drawn time waits for it, ms. */
  constructor(private readonly margin = DRAW_MARGIN_MS) {}

  /** Record a snapshot of `tick` that arrived at `at` (ms). A tick before the newest starts afresh (a new game). */
  push(tick: number, units: readonly UnitSnap[], at: number): void {
    const newest = this.hist[this.hist.length - 1];
    if (newest && tick === newest.tick) return;
    if (newest && tick < newest.tick) {
      this.hist = [];
      this.t = Number.NaN;
    }
    this.hist.push({ tick, at, units, byId: null });
    if (this.hist.length > KEEP) this.hist.shift();
  }

  /** The drawn time, in ticks (fractional); NaN before the first snapshot. */
  get time(): number {
    return this.t;
  }

  /** How far (ticks) the drawn time aims to be behind the newest snapshot's arrival, at a tick length of `tickMs`. */
  lead(tickMs: number): number {
    return (Math.max(tickMs, ARRIVAL_MS) + this.margin) / tickMs;
  }

  /** Move the drawn time to the frame at `now` (ms), a tick lasting `tickMs` of real time; returns it. */
  advance(now: number, tickMs: number): number {
    const newest = this.hist[this.hist.length - 1];
    if (!newest) return this.t;
    const oldest = this.hist[0] as (typeof this.hist)[number];
    const want = newest.tick + (now - newest.at) / tickMs - this.lead(tickMs);
    const dt = Number.isNaN(this.last) ? 0 : Math.max(0, now - this.last);
    this.last = now;
    if (Number.isNaN(this.t) || want - this.t > 3) this.t = want;
    else this.t += Math.max(0, dt / tickMs + (want - this.t) * Math.min(1, (PULL * dt) / 1000));
    this.t = Math.min(newest.tick, Math.max(oldest.tick, this.t));
    return this.t;
  }

  /** The newest snapshot's units, placed at the drawn time. */
  units(): RenderUnit[] {
    const newest = this.hist[this.hist.length - 1];
    if (!newest) return [];
    let i = this.hist.length - 1;
    while (i > 0 && (this.hist[i - 1] as (typeof this.hist)[number]).tick > this.t) i--;
    const b = this.hist[i] as (typeof this.hist)[number];
    const a = this.hist[Math.max(0, i - 1)] as (typeof this.hist)[number];
    const frac = b.tick > a.tick ? (this.t - a.tick) / (b.tick - a.tick) : 1;
    return between(byIdOf(a), b === newest ? newest.units : byIdOf(b), newest.units, frac);
  }
}

function byIdOf(h: { units: readonly UnitSnap[]; byId: Map<number, UnitSnap> | null }): Map<number, UnitSnap> {
  if (!h.byId) {
    h.byId = new Map();
    for (const u of h.units) h.byId.set(u.id, u);
  }
  return h.byId;
}
