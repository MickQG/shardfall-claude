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

/** Clear VISIBLE everywhere, then stamp circular vision; stamped tiles become explored. */
export function recomputeVisible(fog: Uint8Array, w: number, h: number, sources: readonly VisionSource[]): void {
  for (let i = 0; i < fog.length; i++) fog[i] = (fog[i] as number) & EXPLORED;
  for (const s of sources) {
    const r2 = s.r * s.r;
    for (let dy = -s.r; dy <= s.r; dy++) {
      const y = s.ty + dy;
      if (y < 0 || y >= h) continue;
      for (let dx = -s.r; dx <= s.r; dx++) {
        const x = s.tx + dx;
        if (x < 0 || x >= w || dx * dx + dy * dy > r2) continue;
        fog[y * w + x] = EXPLORED | VISIBLE;
      }
    }
  }
}
