export const TILE_W = 64;
export const TILE_H = 32;
export const HEIGHT_PX = 12;

export interface Pt {
  x: number;
  y: number;
}

/** Tile (fractional) to screen position, before camera. */
export function tileToScreen(tx: number, ty: number, level = 0): Pt {
  return { x: (tx - ty) * (TILE_W / 2), y: (tx + ty) * (TILE_H / 2) - level * HEIGHT_PX };
}

/** Screen position (level 0) back to fractional tile. */
export function screenToTile(x: number, y: number): Pt {
  const a = x / (TILE_W / 2);
  const b = y / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}
