import type { MapDef } from '../sim';

/** Deterministic placeholder terrain: a ridge ring around the centre. */
export function demoMap(width = 96, height = 96): MapDef {
  const heights: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      heights.push(d > 8 && d < 14 ? 1 + (((x + y) >> 3) & 1) : 0);
    }
  }
  return { width, height, heights };
}
