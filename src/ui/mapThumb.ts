import { STARTS } from '../data/maps';
import type { MapDef } from '../sim';

/** Thumbnail colours (MENU-1): open ground, the two rock levels, water, shard fields and the start positions. */
export const THUMB = {
  ground: [52, 78, 58],
  rock1: [118, 112, 100],
  rock2: [158, 150, 134],
  water: [42, 104, 142],
  shards: [53, 224, 161],
  start: [255, 210, 120],
} as const;

/**
 * RGBA pixels of a map thumbnail, one pixel per tile (MENU-1): ground, rock by level, water, shard fields, and a small
 * marker at each start. Pure, so the menu and the tests draw the same thing.
 */
export function thumbPixels(m: MapDef): Uint8ClampedArray<ArrayBuffer> {
  const W = m.width;
  const H = m.height;
  const px = new Uint8ClampedArray(new ArrayBuffer(W * H * 4));
  const put = (i: number, c: readonly number[]): void => {
    px[i * 4] = c[0]!;
    px[i * 4 + 1] = c[1]!;
    px[i * 4 + 2] = c[2]!;
    px[i * 4 + 3] = 255;
  };
  for (let i = 0; i < W * H; i++) {
    const h = m.heights[i] ?? 0;
    const blocked = !!m.blocked?.[i];
    put(i, (m.shards?.[i] ?? 0) > 0 ? THUMB.shards : blocked && h === 0 ? THUMB.water : h >= 2 ? THUMB.rock2 : h === 1 ? THUMB.rock1 : THUMB.ground);
  }
  for (const s of STARTS) {
    for (let y = s.ty - 1; y <= s.ty + 3; y++) for (let x = s.tx - 1; x <= s.tx + 3; x++) if (x >= 0 && y >= 0 && x < W && y < H) put(y * W + x, THUMB.start);
  }
  return px;
}

/** A canvas showing the map's thumbnail, turned to the game's isometric view by CSS. */
export function thumbCanvas(m: MapDef): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  const g = c.getContext('2d');
  if (g) g.putImageData(new ImageData(thumbPixels(m), m.width, m.height), 0, 0);
  return c;
}
