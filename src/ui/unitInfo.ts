import { DAMAGE_PCT, UNIT_DEFS, type ArmorType, type Faction, type UnitDef, type WeaponDef } from '../data/defs';

/** Plain-language summary of one unit kind for the main-menu info panel. */
export interface UnitCard {
  kind: string;
  name: string;
  cost: number;
  role: string;
  toughness: 'Fragile' | 'Sturdy' | 'Very tough';
  speed: 'Slow' | 'Average' | 'Fast';
  range: 'Melee' | 'Short' | 'Medium' | 'Long' | null;
  hitsAir: boolean;
  regenerates: boolean;
  canAttack: boolean;
  /** Armour classes the weapon deals full damage or more to, with the enemy kinds of that class. */
  strong: { armour: string; units: string[] }[];
  /** Enemy kinds that can hit this unit for full damage or more. */
  weak: string[];
}

const ROLE: Record<UnitDef['role'], string> = { harvester: 'Harvester', infantry: 'Infantry', antiarmor: 'Anti-armour', scout: 'Scout', tank: 'Tank', artillery: 'Artillery', air: 'Air', raider: 'Raider' };
const ARMOUR: readonly [ArmorType, string][] = [
  ['light', 'Light'],
  ['heavy', 'Heavy'],
  ['air', 'Air'],
  ['structure', 'Buildings'],
];

const canHit = (w: WeaponDef, armour: ArmorType): boolean => (armour === 'air' ? w.antiAir : w.antiGround);
const hurts = (w: WeaponDef, armour: ArmorType): boolean => canHit(w, armour) && DAMAGE_PCT[w.type][armour] >= 100;

const toughness = (hp: number): UnitCard['toughness'] => (hp < 150 ? 'Fragile' : hp < 400 ? 'Sturdy' : 'Very tough');
const speed = (s: number): UnitCard['speed'] => (s < 30 ? 'Slow' : s < 50 ? 'Average' : 'Fast');
const range = (r: number): NonNullable<UnitCard['range']> => (r < 2 ? 'Melee' : r < 5 ? 'Short' : r < 8 ? 'Medium' : 'Long');

/** One card per unit kind of `faction`, in definition order. */
export function unitCards(faction: Faction): UnitCard[] {
  const all = Object.entries(UNIT_DEFS);
  const enemies = all.filter(([, d]) => d.faction !== faction).map(([, d]) => d);
  return all
    .filter(([, d]) => d.faction === faction)
    .map(([kind, d]) => {
      const w = d.weapon;
      return {
        kind,
        name: d.name,
        cost: d.cost,
        role: d.hero ? 'Hero tank' : ROLE[d.role],
        toughness: toughness(d.hp),
        speed: speed(d.speed),
        range: w ? range(w.range) : null,
        hitsAir: !!w?.antiAir,
        regenerates: d.regen !== undefined,
        canAttack: !!w,
        // Unit armour classes the enemy fields no unit of (no aircraft, since the heroes replaced them) are left out.
        strong: w
          ? ARMOUR.filter(([a]) => hurts(w, a))
              .map(([a, label]) => ({ armour: label, units: enemies.filter((e) => e.armor === a).map((e) => e.name), structure: a === 'structure' }))
              .filter((x) => x.structure || x.units.length > 0)
              .map(({ armour, units }) => ({ armour, units }))
          : [],
        weak: enemies.filter((e) => e.weapon && hurts(e.weapon, d.armor)).map((e) => e.name),
      };
    });
}
