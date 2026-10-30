import type { Camera, Viewport } from '../render/camera';
import { worldToScreen } from '../render/camera';
import type { RenderUnit } from '../render/interp';
import { tileToScreen } from '../render/iso';
import { combatUnitIds } from './controls';

/** A unit projected to screen space. */
export interface ScreenUnit {
  id: number;
  owner: number;
  kind: string;
  sx: number;
  sy: number;
}

export const PICK_RADIUS = 18;

export function toScreenUnits(units: readonly RenderUnit[], cam: Camera, vp: Viewport): ScreenUnit[] {
  return units.map((u) => {
    const w = tileToScreen(u.tx, u.ty);
    // Aim at the unit body (slightly above its ground point).
    const s = worldToScreen(cam, vp, w.x, w.y - 6);
    return { id: u.id, owner: u.owner, kind: u.kind, sx: s.x, sy: s.y };
  });
}

/** Nearest own unit within the pick radius, or null. */
export function pickUnit(units: readonly ScreenUnit[], sx: number, sy: number, player: number, radius = PICK_RADIUS): number | null {
  let best: number | null = null;
  let bd = radius * radius;
  for (const u of units) {
    if (u.owner !== player) continue;
    const d = (u.sx - sx) ** 2 + (u.sy - sy) ** 2;
    if (d <= bd) {
      bd = d;
      best = u.id;
    }
  }
  return best;
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

/** Nearest enemy unit (any owner but `player`) within the pick radius, or null. */
export function pickEnemy(units: readonly ScreenUnit[], sx: number, sy: number, player: number, radius = 20): number | null {
  let best: number | null = null;
  let bd = radius * radius;
  for (const u of units) {
    if (u.owner === player) continue;
    const d = (u.sx - sx) ** 2 + (u.sy - sy) ** 2;
    if (d <= bd) {
      bd = d;
      best = u.id;
    }
  }
  return best;
}
