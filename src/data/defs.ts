/** Static definitions. Speeds are fixed-point units per tick (256 = 1 tile). */

export interface UnitDef {
  speed: number;
  hp: number;
  /** Collision radius in fixed-point units. */
  radius: number;
  /** Vision radius in whole tiles. */
  vision: number;
}

export const UNIT_DEFS: Readonly<Record<string, UnitDef>> = {
  trooper: { speed: 38, hp: 100, radius: 80, vision: 7 },
  scout: { speed: 76, hp: 60, radius: 64, vision: 11 },
};

export const unitDef = (kind: string): UnitDef => {
  const d = UNIT_DEFS[kind];
  if (!d) throw new Error(`unknown unit kind: ${kind}`);
  return d;
};
