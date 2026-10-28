import { buildingDef } from '../data/defs';
import { screenToTile } from '../render/iso';
import type { CursorState } from './cursor';
import { pickEnemy, pickUnit, type ScreenUnit } from './selection';

/** Everything the hit-test needs, captured at one instant so hover and clicks agree. */
export interface HitContext {
  player: number;
  /** Units projected to screen space at the instant being tested. */
  units: readonly ScreenUnit[];
  buildings: readonly { id: number; owner: number; kind: string; tx: number; ty: number }[];
  /** Screen pixel to world (iso plane) pixel under the current camera. */
  toWorld(sx: number, sy: number): { x: number; y: number };
  blocked(tx: number, ty: number): boolean;
}

export interface Hit {
  ownUnit: number | null;
  enemyUnit: number | null;
  ownBuilding: number | null;
  enemyBuilding: number | null;
  /** Ground tile under the pointer. */
  tx: number;
  ty: number;
  blocked: boolean;
}

/** Roof heights (px) tried from the top down: a building's roof is drawn above its footprint. */
const LIFTS = [40, 28, 14, 0];

/** What is under the pointer at screen position (sx, sy). */
export function hitTest(ctx: HitContext, sx: number, sy: number): Hit {
  const w = ctx.toWorld(sx, sy);
  let building: HitContext['buildings'][number] | undefined;
  for (const lift of LIFTS) {
    const t = screenToTile(w.x, w.y + lift);
    building = ctx.buildings.find((b) => {
      const d = buildingDef(b.kind);
      return t.x >= b.tx && t.x < b.tx + d.w && t.y >= b.ty && t.y < b.ty + d.h;
    });
    if (building) break;
  }
  const g = screenToTile(w.x, w.y);
  const tx = Math.floor(g.x);
  const ty = Math.floor(g.y);
  return {
    ownUnit: pickUnit(ctx.units, sx, sy, ctx.player),
    enemyUnit: pickEnemy(ctx.units, sx, sy, ctx.player),
    ownBuilding: building && building.owner === ctx.player ? building.id : null,
    enemyBuilding: building && building.owner !== ctx.player ? building.id : null,
    tx,
    ty,
    blocked: ctx.blocked(tx, ty),
  };
}

export type RightClickOrder = { kind: 'attack'; target: number } | { kind: 'move'; tx: number; ty: number };

/** What a right-click does with a selection: attack an enemy unit, else an enemy building, else move to the tile. */
export function rightClickOrder(h: Hit): RightClickOrder {
  const target = h.enemyUnit ?? h.enemyBuilding;
  return target !== null ? { kind: 'attack', target } : { kind: 'move', tx: h.tx, ty: h.ty };
}

/**
 * The hover category the cursor is chosen from. With a selection the pointer shows what a right-click would do (enemies first);
 * with nothing selected it shows what a left-click would select (own things first).
 */
export function hoverKind(h: Hit, anySelected: boolean): CursorState['hover'] {
  const enemy = h.enemyUnit !== null || h.enemyBuilding !== null;
  const own = h.ownUnit !== null ? 'ownUnit' : h.ownBuilding !== null ? 'ownBuilding' : null;
  if (anySelected && enemy) return 'enemy';
  if (own) return own;
  if (enemy) return 'enemy';
  return h.blocked ? 'blocked' : 'ground';
}
