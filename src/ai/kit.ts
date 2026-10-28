import { BUILDING_DEFS, UNIT_DEFS, type BuildingDef, type Faction, type UnitDef } from '../data/defs';

/** The faction-specific building and unit kinds the AI plans around, derived from the data tables. */
export interface Kit {
  faction: Faction;
  hq: string;
  power: string;
  refinery: string;
  /** Trains infantry. */
  barracks: string;
  /** Trains haulers and vehicles. */
  factory: string;
  lab: string;
  turret: string;
  superweapon: string;
  hauler: string;
}

const find = <T>(rec: Readonly<Record<string, T>>, f: (k: string, d: T) => boolean): string => {
  const hit = Object.entries(rec).find(([k, d]) => f(k, d));
  if (!hit) throw new Error('kit: missing kind');
  return hit[0];
};

export function kitOf(faction: Faction): Kit {
  const b = (f: (k: string, d: BuildingDef) => boolean): string => find(BUILDING_DEFS, (k, d) => d.faction === faction && f(k, d));
  const u = (f: (k: string, d: UnitDef) => boolean): string => find(UNIT_DEFS, (k, d) => d.faction === faction && f(k, d));
  const hauler = u((_, d) => d.capacity !== undefined);
  return {
    faction,
    hq: b((_, d) => !!d.hq),
    power: b((_, d) => d.power > 0 && !d.hq),
    refinery: b((_, d) => !!d.refinery),
    barracks: UNIT_DEFS[u((_, d) => d.role === 'infantry' || d.role === 'raider')]!.builtAt,
    factory: (UNIT_DEFS[hauler] as UnitDef).builtAt,
    lab: b((_, d) => d.tier === 3 && !d.weapon && !d.superweapon),
    turret: b((_, d) => !!d.weapon),
    superweapon: b((_, d) => !!d.superweapon),
    hauler,
  };
}
