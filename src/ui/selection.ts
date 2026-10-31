import { unitDef } from '../data/defs';
import type { Viewport } from '../render/camera';
import type { RenderUnit } from '../render/interp';
import type { Projector } from '../render/projector';
import { FP } from '../sim';
import { combatUnitIds } from './controls';

/** A unit projected to screen space. */
export interface ScreenUnit {
  id: number;
  owner: number;
  kind: string;
  sx: number;
  sy: number;
  /** Pick reach on screen, px (the unit's drawn size at the current zoom); the caller's radius when absent. */
  r?: number;
  /** Screen point of the top of the body: clicks anywhere up the body count, not only at its feet. */
  hx?: number;
  hy?: number;
}

/** The smallest pick reach, px, so tiny or far-zoomed units stay easy to click (CTL-1). */
export const PICK_RADIUS = 18;

/** How far from its centre a unit can be clicked, tiles: its drawn body with a margin, a squad's whole spread. */
export function pickReach(kind: string): number {
  const d = unitDef(kind);
  return Math.max(0.42, (d.radius / FP) * 1.5) + (d.squad ? 0.3 : 0);
}

/** How tall a unit's body is drawn, isometric pixels at zoom 1 (aircraft fly above the ground). */
export const bodyLift = (kind: string): number => (unitDef(kind).air ? 52 : 18);

export function toScreenUnits(units: readonly RenderUnit[], proj: Projector): ScreenUnit[] {
  return units.map((u) => {
    // Aim at the unit body (slightly above its ground point).
    const s = proj.toScreen(u.tx, u.ty, 6);
    const g = proj.toScreen(u.tx, u.ty);
    const h = proj.toScreen(u.tx, u.ty, bodyLift(u.kind));
    // The reach in tiles as it appears on screen now, averaged over both ground axes.
    const R = pickReach(u.kind);
    const a = proj.toScreen(u.tx + R, u.ty);
    const b = proj.toScreen(u.tx, u.ty + R);
    const r = Math.max(PICK_RADIUS, (Math.hypot(a.x - g.x, a.y - g.y) + Math.hypot(b.x - g.x, b.y - g.y)) / 2);
    return { id: u.id, owner: u.owner, kind: u.kind, sx: s.x, sy: s.y, r, hx: h.x, hy: h.y };
  });
}

/**
 * How far (sx, sy) is from a unit, in units of its pick reach: the distance to the segment from its centre up to the
 * top of its body, over its reach. At most 1 means the click lands on it.
 */
export function pickScore(u: ScreenUnit, sx: number, sy: number, radius: number): number {
  const r = Math.max(radius, u.r ?? radius);
  const hx = u.hx ?? u.sx;
  const hy = u.hy ?? u.sy;
  const vx = hx - u.sx;
  const vy = hy - u.sy;
  const len2 = vx * vx + vy * vy;
  const k = len2 > 0 ? Math.max(0, Math.min(1, ((sx - u.sx) * vx + (sy - u.sy) * vy) / len2)) : 0;
  return Math.hypot(sx - (u.sx + vx * k), sy - (u.sy + vy * k)) / r;
}

/** The unit (filtered by `want`) the click lands on most squarely, or null. */
function pick(units: readonly ScreenUnit[], sx: number, sy: number, radius: number, want: (u: ScreenUnit) => boolean): number | null {
  let best: number | null = null;
  let bs = 1;
  for (const u of units) {
    if (!want(u)) continue;
    const sc = pickScore(u, sx, sy, radius);
    if (sc <= bs) {
      bs = sc;
      best = u.id;
    }
  }
  return best;
}

/** The own unit under the click: within its drawn size at the current zoom (at least `radius`), or null (CTL-1). */
export function pickUnit(units: readonly ScreenUnit[], sx: number, sy: number, player: number, radius = PICK_RADIUS): number | null {
  return pick(units, sx, sy, radius, (u) => u.owner === player);
}

/** Own units inside the rectangle; when it holds any combat unit, only the combat units. */
export function boxSelect(units: readonly ScreenUnit[], x0: number, y0: number, x1: number, y1: number, player: number): number[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const inside = units.filter((u) => u.owner === player && u.sx >= minX && u.sx <= maxX && u.sy >= minY && u.sy <= maxY);
  const combat = combatUnitIds(inside, player);
  return combat.length > 0 ? combat : inside.map((u) => u.id);
}

/** All own units, on or off screen, whose kind is among the kinds of the `selected` own units. */
export function selectKinds(units: readonly { id: number; owner: number; kind: string }[], selected: readonly number[], player: number): number[] {
  const kinds = new Set(units.filter((u) => u.owner === player && selected.includes(u.id)).map((u) => u.kind));
  return units.filter((u) => u.owner === player && kinds.has(u.kind)).map((u) => u.id);
}

/** All own units of the same kind as `id` that are on screen. */
export function selectSameKind(units: readonly ScreenUnit[], id: number, player: number, vp: Viewport): number[] {
  const ref = units.find((u) => u.id === id);
  if (!ref) return [];
  return units.filter((u) => u.owner === player && u.kind === ref.kind && u.sx >= 0 && u.sy >= 0 && u.sx <= vp.width && u.sy <= vp.height).map((u) => u.id);
}

/** Current selection and control groups. */
export class Selection {
  private ids = new Set<number>();
  private groups = new Map<number, number[]>();

  get selected(): number[] {
    return [...this.ids];
  }

  has(id: number): boolean {
    return this.ids.has(id);
  }

  set(ids: readonly number[]): void {
    this.ids = new Set(ids);
  }

  clear(): void {
    this.ids.clear();
  }

  /** Add ids to the selection (shift-box, shift + double-click). */
  add(ids: readonly number[]): void {
    for (const id of ids) this.ids.add(id);
  }

  /** Toggle each id in or out (shift-click). */
  toggle(ids: readonly number[]): void {
    for (const id of ids) {
      if (this.ids.has(id)) this.ids.delete(id);
      else this.ids.add(id);
    }
  }

  /** Store the selection as group `n`; with nothing selected the group is left as it was. */
  assignGroup(n: number): void {
    if (this.ids.size === 0) return;
    this.groups.set(n, this.selected);
  }

  /** Recall a group, dropping units that no longer exist. Returns the ids selected. */
  recallGroup(n: number, alive: ReadonlySet<number>): number[] {
    const ids = (this.groups.get(n) ?? []).filter((id) => alive.has(id));
    this.groups.set(n, ids);
    this.ids = new Set(ids);
    return ids;
  }

  /** Remove units that no longer exist from the selection. */
  prune(alive: ReadonlySet<number>): void {
    for (const id of this.ids) if (!alive.has(id)) this.ids.delete(id);
  }
}

/** The enemy unit (any owner but `player`) under the pointer, by the same reach as own units, or null. */
export function pickEnemy(units: readonly ScreenUnit[], sx: number, sy: number, player: number, radius = 20): number | null {
  return pick(units, sx, sy, radius, (u) => u.owner !== player);
}
