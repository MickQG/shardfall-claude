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

/** Interpolate unit positions between two snapshots; alpha is clamped to [0, 1]. */
/** A simulation facing (256 steps a circle) as radians, turned the short way from `from` to `to` by `a` (HERO-5). */
export function facingYaw(from: number, to: number, a: number): number {
  const d = ((((to - from) % 256) + 256 + 128) % 256) - 128;
  return ((from + d * a) * Math.PI * 2) / 256;
}

export function interpolate(prev: readonly UnitSnap[], curr: readonly UnitSnap[], alpha: number): RenderUnit[] {
  const a = Math.min(1, Math.max(0, alpha));
  const before = new Map<number, UnitSnap>();
  for (const u of prev) before.set(u.id, u);
  return curr.map((u) => {
    const p = before.get(u.id) ?? u;
    return {
      id: u.id,
      owner: u.owner,
      kind: u.kind,
      tx: (p.x + (u.x - p.x) * a) / SCALE,
      ty: (p.y + (u.y - p.y) * a) / SCALE,
      hp: u.hp,
      load: u.load,
      rank: u.rank,
      target: u.target,
      ...(u.facing !== undefined ? { yaw: facingYaw(p.facing ?? u.facing, u.facing, a) } : {}),
      ...(u.dock !== undefined ? { dock: u.dock } : {}),
    };
  });
}
