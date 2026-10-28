import type { MapDef, UnitSpawn } from '../sim';

/** Deterministic placeholder terrain: a ridge ring around the centre with rock outcrops. */
export function demoMap(width = 96, height = 96): MapDef {
  const heights: number[] = [];
  const blocked: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ridge = d > 8 && d < 14;
      heights.push(ridge ? 1 + (((x + y) >> 3) & 1) : 0);
      // Ridge is a wall with gaps every 12 tiles so units must route through chokepoints.
      const gap = (x + y) % 12 < 3;
      blocked.push(ridge && !gap ? 1 : 0);
    }
  }
  return { width, height, heights, blocked };
}

export function demoUnits(): UnitSpawn[] {
  const out: UnitSpawn[] = [];
  for (let i = 0; i < 6; i++) out.push({ owner: 0, kind: i % 3 === 0 ? 'scout' : 'trooper', tx: 10 + (i % 3), ty: 10 + Math.floor(i / 3) });
  for (let i = 0; i < 4; i++) out.push({ owner: 1, kind: 'trooper', tx: 84 + (i % 2), ty: 84 + Math.floor(i / 2) });
  return out;
}
