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
}

const SCALE = 256;

/** Interpolate unit positions between two snapshots; alpha is clamped to [0, 1]. */
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
    };
  });
}
