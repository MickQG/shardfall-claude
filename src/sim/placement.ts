import { buildingDef } from '../data/defs';
import { EXPLORED } from './fog';

/** Structures may be placed within this many tiles of an own building's footprint. */
export const BUILD_RANGE = 6;

export interface Footprint {
  kind: string;
  /** Top-left tile. */
  tx: number;
  ty: number;
}

export interface PlacementContext {
  width: number;
  height: number;
  /** Terrain blockers, row-major (1 = blocked). May be undefined if the map has none. */
  terrain: ArrayLike<number> | undefined;
  /** All buildings that occupy tiles (own, visible and remembered enemy ones). */
  occupied: readonly Footprint[];
  /** The placing player's completed buildings (used for build range). */
  own: readonly Footprint[];
  /** The placing player's fog grid. */
  fog: Uint8Array;
}

const rectGap = (a: { tx: number; ty: number; w: number; h: number }, tx: number, ty: number, w: number, h: number): number => {
  const dx = Math.max(a.tx - (tx + w - 1), tx - (a.tx + a.w - 1), 0);
  const dy = Math.max(a.ty - (ty + h - 1), ty - (a.ty + a.h - 1), 0);
  return Math.max(dx, dy);
};

/** Shared by the simulation and the UI so the placement ghost matches what the sim accepts. */
export function canPlace(ctx: PlacementContext, kind: string, tx: number, ty: number): boolean {
  const { w, h } = buildingDef(kind);
  if (tx < 0 || ty < 0 || tx + w > ctx.width || ty + h > ctx.height) return false;
  for (let y = ty; y < ty + h; y++) {
    for (let x = tx; x < tx + w; x++) {
      const i = y * ctx.width + x;
      if (ctx.terrain?.[i]) return false;
      if (!((ctx.fog[i] as number) & EXPLORED)) return false;
    }
  }
  for (const o of ctx.occupied) {
    const d = buildingDef(o.kind);
    if (tx < o.tx + d.w && tx + w > o.tx && ty < o.ty + d.h && ty + h > o.ty) return false;
  }
  return ctx.own.some((o) => {
    const d = buildingDef(o.kind);
    return rectGap({ tx: o.tx, ty: o.ty, w: d.w, h: d.h }, tx, ty, w, h) <= BUILD_RANGE;
  });
}
