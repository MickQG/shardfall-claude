export const EXPLORED = 1;
export const VISIBLE = 2;

export interface VisionSource {
  /** Tile coordinates. */
  tx: number;
  ty: number;
  /** Radius in whole tiles. */
  r: number;
}

export const createFog = (w: number, h: number): Uint8Array => new Uint8Array(w * h);

/**
 * How long a tile stays in sight after the last unit or building that saw it moves away or dies (FOG-6, FOG-7), ticks
 * (8 s): the fog closes in slowly instead of at once.
 */
export const SIGHT_LINGER = 160;

/** Lingering sight: per tile, the tick until which it stays visible, and the clock. */
export interface Linger {
  until: Int32Array;
  tick: number;
  linger: number;
}

/**
 * Clear VISIBLE everywhere, then stamp circular vision; stamped tiles become explored. With `keep`, a stamped tile stays
 * visible for `keep.linger` ticks after it was last stamped.
 */
export function recomputeVisible(fog: Uint8Array, w: number, h: number, sources: readonly VisionSource[], keep?: Linger): void {
  for (let i = 0; i < fog.length; i++) fog[i] = keep && (keep.until[i] as number) > keep.tick ? EXPLORED | VISIBLE : (fog[i] as number) & EXPLORED;
  for (const s of sources) {
    const r2 = s.r * s.r;
    for (let dy = -s.r; dy <= s.r; dy++) {
      const y = s.ty + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -s.r; dx <= s.r; dx++) {
        const x = s.tx + dx;
        if (x < 0 || x >= w || dx * dx + dy * dy > r2) continue;
        fog[y * w + x] = EXPLORED | VISIBLE;
        if (keep) keep.until[y * w + x] = keep.tick + keep.linger;
      }
    }
  }
}
