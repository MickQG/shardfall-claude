/** Static definitions. Speeds are fixed-point units per tick (256 = 1 tile). */

export interface UnitDef {
  speed: number;
  hp: number;
  /** Collision radius in fixed-point units. */
  radius: number;
}

export const UNIT_DEFS: Readonly<Record<string, UnitDef>> = {
  trooper: { speed: 38, hp: 100, radius: 80 },
  scout: { speed: 76, hp: 60, radius: 64 },
};

export const unitDef = (kind: string): UnitDef => {
  const d = UNIT_DEFS[kind];
  if (!d) throw new Error(`unknown unit kind: ${kind}`);
  return d;
};
