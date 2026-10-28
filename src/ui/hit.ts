import { buildingDef } from '../data/defs';
import { screenToTile } from '../render/iso';
import { buildingHeightPx } from '../render/voxel/buildings';
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
  /** Whether the tile holds shards to harvest. */
  shardAt(tx: number, ty: number): boolean;
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
  /** The ground tile holds shards. */
  resource: boolean;
}

/** What is under the pointer at screen position (sx, sy). */
export function hitTest(ctx: HitContext, sx: number, sy: number): Hit {
  const w = ctx.toWorld(sx, sy);
  // A building's body is drawn above its footprint, so test the footprint at lifts up to the roof; the nearest building wins.
  let building: HitContext['buildings'][number] | undefined;
  let nearest = -Infinity;
  for (const b of ctx.buildings) {
    const d = buildingDef(b.kind);
    const h = buildingHeightPx(b.kind);
    for (const lift of [h, h * 0.75, h * 0.5, h * 0.25, 0]) {
      const t = screenToTile(w.x, w.y + lift);
      if (t.x >= b.tx && t.x < b.tx + d.w && t.y >= b.ty && t.y < b.ty + d.h) {
        if (b.tx + b.ty + d.w + d.h > nearest) {
          building = b;
          nearest = b.tx + b.ty + d.w + d.h;
        }
        break;
      }
    }
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
    resource: ctx.shardAt(tx, ty),
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
  if (h.resource) return 'resource';
  return h.blocked ? 'blocked' : 'ground';
}
