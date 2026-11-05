/**
 * Static definitions for both factions. All lengths in tiles unless noted; times in ticks (20 per second);
 * speeds in fixed-point units per tick (256 = 1 tile). Balance lives here and is tuned through the AI harness.
 */

export type Faction = 'human' | 'alien';
export type ArmorType = 'light' | 'heavy' | 'structure' | 'air';
export type DamageType = 'pierce' | 'rocket' | 'blast' | 'claw' | 'bite' | 'beam';

export interface WeaponDef {
  damage: number;
  /** Range in tiles. */
  range: number;
  /** Ticks between shots. */
  cooldown: number;
  type: DamageType;
  antiAir: boolean;
  antiGround: boolean;
  /** Splash radius in tiles (0 = single target). */
  splash?: number;
  /** Ticks a projectile takes to land (0 = instant). */
  flight?: number;
  /** Lobbed: fires over buildings (CMB-14). */
  indirect?: boolean;
}

export interface UnitDef {
  faction: Faction;
  name: string;
  speed: number;
  hp: number;
  /** Collision radius in fixed-point units. */
  radius: number;
  /** Vision radius in whole tiles. */
  vision: number;
  cost: number;
  buildTime: number;
  /** Building kind that trains this unit. */
  builtAt: string;
  /** Building kinds the player must own. */
  requires: string[];
  armor: ArmorType;
  weapon?: WeaponDef;
  air?: boolean;
  /** Haulers: shards carried per trip. */
  capacity?: number;
  /** HP regained per second-tick interval of 20 ticks when out of combat (aliens). */
  regen?: number;
  /** Infantry squads: figures in the squad; damage scales with figures still standing (SQD-1). */
  squad?: number;
  /** A hero (HERO-1): one at a time per player, alive or in production. */
  hero?: boolean;
  /** A heavy vehicle that crushes enemy infantry squads it drives over (BAL-1). */
  crusher?: boolean;
  /**
   * Turns slowly (HERO-5): facing steps (of 256 a circle) a tick. Such a unit turns in place before it walks a new way,
   * fires only at what it faces, and is never shoved by smaller units.
   */
  turnRate?: number;
  /** Role hint used by the AI for composition. */
  role: 'harvester' | 'infantry' | 'antiarmor' | 'scout' | 'tank' | 'artillery' | 'air' | 'raider';
}

export interface BuildingDef {
  faction: Faction;
  name: string;
  w: number;
  h: number;
  hp: number;
  cost: number;
  buildTime: number;
  requires: string[];
  /** Power output (+) or drain (-). */
  power: number;
  vision: number;
  /** Builds structures. */
  hq?: boolean;
  /** Accepts shard deliveries. */
  refinery?: boolean;
  weapon?: WeaponDef;
  /** Defences go offline when power is low. */
  needsPower?: boolean;
  /** Superweapon: charge time in ticks. */
  superweapon?: { charge: number; damage: number; radius: number };
  tier: 1 | 2 | 3;
}

export const DAMAGE_PCT: Readonly<Record<DamageType, Readonly<Record<ArmorType, number>>>> = {
  pierce: { light: 100, heavy: 40, structure: 30, air: 100 },
  rocket: { light: 45, heavy: 150, structure: 80, air: 120 },
  blast: { light: 80, heavy: 90, structure: 150, air: 0 },
  claw: { light: 110, heavy: 80, structure: 60, air: 0 },
  // Small raiders' bites and slashes: deadly to infantry, little more than a nuisance to armour (BAL-3).
  bite: { light: 110, heavy: 40, structure: 50, air: 0 },
  beam: { light: 100, heavy: 100, structure: 100, air: 100 },
};

export const BUILDING_DEFS: Readonly<Record<string, BuildingDef>> = {
  // ---- Humans (Aegis Union): armoured, structured, combined arms ----
  hum_hq: { faction: 'human', name: 'Command Hub', w: 3, h: 3, hp: 1500, cost: 0, buildTime: 0, requires: [], power: 20, vision: 9, hq: true, tier: 1 },
  hum_reactor: { faction: 'human', name: 'Fusion Reactor', w: 2, h: 2, hp: 600, cost: 300, buildTime: 300, requires: ['hum_hq'], power: 70, vision: 5, tier: 1 },
  hum_refinery: { faction: 'human', name: 'Shard Refinery', w: 3, h: 2, hp: 900, cost: 600, buildTime: 500, requires: ['hum_reactor'], power: -15, vision: 6, refinery: true, tier: 1 },
  hum_barracks: { faction: 'human', name: 'Garrison', w: 2, h: 2, hp: 700, cost: 400, buildTime: 400, requires: ['hum_reactor'], power: -10, vision: 6, tier: 1 },
  hum_factory: { faction: 'human', name: 'Motor Pool', w: 3, h: 3, hp: 1100, cost: 900, buildTime: 700, requires: ['hum_refinery', 'hum_barracks'], power: -25, vision: 6, tier: 2 },
  hum_turret: {
    faction: 'human', name: 'Pulse Turret', w: 1, h: 1, hp: 500, cost: 450, buildTime: 350, requires: ['hum_barracks'], power: -15, vision: 8, needsPower: true, tier: 1,
    weapon: { damage: 22, range: 7, cooldown: 14, type: 'pierce', antiAir: true, antiGround: true },
  },
  hum_lab: { faction: 'human', name: 'Tech Lab', w: 2, h: 2, hp: 700, cost: 1100, buildTime: 800, requires: ['hum_factory'], power: -40, vision: 6, tier: 3 },
  hum_lance: {
    faction: 'human', name: 'Orbital Lance', w: 3, h: 3, hp: 1000, cost: 3000, buildTime: 1500, requires: ['hum_lab'], power: -90, vision: 6, needsPower: true, tier: 3,
    superweapon: { charge: 20 * 240, damage: 900, radius: 4 },
  },

  // ---- Aliens (Vrax Hive): fast, organic, regenerating ----
  ali_hq: { faction: 'alien', name: 'Hive Heart', w: 3, h: 3, hp: 1400, cost: 0, buildTime: 0, requires: [], power: 20, vision: 9, hq: true, tier: 1 },
  ali_generator: { faction: 'alien', name: 'Bio-Generator', w: 2, h: 2, hp: 500, cost: 250, buildTime: 260, requires: ['ali_hq'], power: 60, vision: 5, tier: 1 },
  ali_extractor: { faction: 'alien', name: 'Shard Extractor', w: 3, h: 2, hp: 800, cost: 550, buildTime: 450, requires: ['ali_generator'], power: -12, vision: 6, refinery: true, tier: 1 },
  ali_nest: { faction: 'alien', name: 'Spawn Nest', w: 2, h: 2, hp: 600, cost: 350, buildTime: 350, requires: ['ali_generator'], power: -8, vision: 6, tier: 1 },
  ali_pit: { faction: 'alien', name: 'Brood Pit', w: 3, h: 3, hp: 1000, cost: 850, buildTime: 650, requires: ['ali_extractor', 'ali_nest'], power: -22, vision: 6, tier: 2 },
  ali_spire: {
    faction: 'alien', name: 'Spine Spire', w: 1, h: 1, hp: 450, cost: 400, buildTime: 320, requires: ['ali_nest'], power: -12, vision: 8, needsPower: true, tier: 1,
    weapon: { damage: 32, range: 6.8, cooldown: 18, type: 'claw', antiAir: false, antiGround: true },
  },
  ali_evolver: { faction: 'alien', name: 'Evolution Chamber', w: 2, h: 2, hp: 650, cost: 1000, buildTime: 750, requires: ['ali_pit'], power: -35, vision: 6, tier: 3 },
  ali_rift: {
    faction: 'alien', name: 'Rift Maw', w: 3, h: 3, hp: 900, cost: 2800, buildTime: 1400, requires: ['ali_evolver'], power: -80, vision: 6, needsPower: true, tier: 3,
    superweapon: { charge: 20 * 220, damage: 800, radius: 5 },
  },
};

export const UNIT_DEFS: Readonly<Record<string, UnitDef>> = {
  // ---- Humans ----
  hum_hauler: { faction: 'human', name: 'Shard Hauler', speed: 30, hp: 400, radius: 96, vision: 6, cost: 400, buildTime: 450, builtAt: 'hum_factory', requires: ['hum_refinery'], armor: 'heavy', capacity: 200, role: 'harvester' },
  hum_rifleman: {
    faction: 'human', name: 'Rifleman', speed: 38, hp: 100, radius: 80, vision: 7, cost: 100, buildTime: 120, builtAt: 'hum_barracks', requires: [], armor: 'light', squad: 3, role: 'infantry',
    weapon: { damage: 7, range: 5, cooldown: 10, type: 'pierce', antiAir: true, antiGround: true },
  },
  hum_rocketeer: {
    faction: 'human', name: 'Rocketeer', speed: 34, hp: 100, radius: 80, vision: 7, cost: 250, buildTime: 200, builtAt: 'hum_barracks', requires: ['hum_factory'], armor: 'light', squad: 3, role: 'antiarmor',
    weapon: { damage: 38, range: 6, cooldown: 30, type: 'rocket', antiAir: true, antiGround: true, flight: 6 },
  },
  hum_buggy: {
    faction: 'human', name: 'Scout Buggy', speed: 70, hp: 160, radius: 80, vision: 11, cost: 250, buildTime: 220, builtAt: 'hum_factory', requires: [], armor: 'light', role: 'scout',
    weapon: { damage: 7, range: 4.5, cooldown: 8, type: 'pierce', antiAir: false, antiGround: true },
  },
  hum_tank: {
    faction: 'human', name: 'Bulwark Tank', speed: 34, hp: 550, radius: 104, vision: 7, cost: 800, buildTime: 450, builtAt: 'hum_factory', requires: [], armor: 'heavy', crusher: true, role: 'tank',
    weapon: { damage: 38, range: 6, cooldown: 25, type: 'rocket', antiAir: false, antiGround: true, flight: 3 },
  },
  hum_artillery: {
    faction: 'human', name: 'Hammer Artillery', speed: 24, hp: 250, radius: 100, vision: 8, cost: 900, buildTime: 520, builtAt: 'hum_factory', requires: ['hum_lab'], armor: 'heavy', role: 'artillery',
    weapon: { damage: 64, range: 11, cooldown: 60, type: 'blast', antiAir: false, antiGround: true, splash: 1.5, flight: 14, indirect: true },
  },
  // The Aegis hero (HERO-1): a giant four-legged assault walker whose cannons and missile pods engage ground and air alike; one at a
  // time, and it slowly repairs itself. Heroes fire slow, heavy shots that burst over an area (HERO-4).
  hum_paladin: {
    faction: 'human', name: 'Paladin', speed: 20, hp: 3000, radius: 180, vision: 9, cost: 2000, buildTime: 900, builtAt: 'hum_factory', requires: ['hum_lab'], armor: 'heavy', regen: 2, hero: true, crusher: true, turnRate: 2, role: 'tank',
    weapon: { damage: 110, range: 7, cooldown: 36, type: 'rocket', antiAir: true, antiGround: true, flight: 5, splash: 0.9 },
  },

  // ---- Aliens ----
  ali_gorger: { faction: 'alien', name: 'Gorger', speed: 34, hp: 350, radius: 96, vision: 6, cost: 350, buildTime: 420, builtAt: 'ali_pit', requires: ['ali_extractor'], armor: 'heavy', capacity: 200, regen: 2, role: 'harvester' },
  ali_skitter: {
    faction: 'alien', name: 'Skitterer', speed: 60, hp: 74, radius: 70, vision: 7, cost: 80, buildTime: 100, builtAt: 'ali_nest', requires: [], armor: 'light', regen: 1, squad: 3, role: 'raider',
    weapon: { damage: 7, range: 1.5, cooldown: 8, type: 'bite', antiAir: false, antiGround: true },
  },
  ali_spitter: {
    faction: 'alien', name: 'Spitter', speed: 40, hp: 82, radius: 76, vision: 7, cost: 220, buildTime: 200, builtAt: 'ali_nest', requires: ['ali_pit'], armor: 'light', regen: 1, squad: 3, role: 'antiarmor',
    weapon: { damage: 30, range: 6, cooldown: 26, type: 'rocket', antiAir: true, antiGround: true, flight: 6 },
  },
  ali_stalker: {
    faction: 'alien', name: 'Stalker', speed: 92, hp: 110, radius: 76, vision: 11, cost: 220, buildTime: 200, builtAt: 'ali_pit', requires: [], armor: 'light', regen: 2, role: 'scout',
    weapon: { damage: 8, range: 1.6, cooldown: 7, type: 'bite', antiAir: false, antiGround: true },
  },
  ali_brute: {
    faction: 'alien', name: 'Brute', speed: 33, hp: 620, radius: 112, vision: 6, cost: 830, buildTime: 500, builtAt: 'ali_pit', requires: [], armor: 'heavy', regen: 2, crusher: true, role: 'tank',
    weapon: { damage: 58, range: 1.9, cooldown: 20, type: 'claw', antiAir: false, antiGround: true },
  },
  ali_lobber: {
    faction: 'alien', name: 'Lobber', speed: 26, hp: 240, radius: 100, vision: 8, cost: 800, buildTime: 500, builtAt: 'ali_pit', requires: ['ali_evolver'], armor: 'heavy', regen: 2, role: 'artillery',
    weapon: { damage: 62, range: 10, cooldown: 56, type: 'blast', antiAir: false, antiGround: true, splash: 1.5, flight: 14, indirect: true },
  },
  // The Vrax hero (HERO-2): a towering six-legged bio-walker whose acid cannon hits ground and air; one at a time, and
  // it regenerates.
  ali_strider: {
    faction: 'alien', name: 'Dreadstrider', speed: 20, hp: 3000, radius: 150, vision: 10, cost: 2000, buildTime: 900, builtAt: 'ali_pit', requires: ['ali_evolver'], armor: 'heavy', regen: 3, hero: true, crusher: true, turnRate: 2, role: 'tank',
    weapon: { damage: 110, range: 7, cooldown: 36, type: 'rocket', antiAir: true, antiGround: true, flight: 5, splash: 0.9 },
  },
};

export const unitDef = (kind: string): UnitDef => {
  const d = UNIT_DEFS[kind];
  if (!d) throw new Error(`unknown unit kind: ${kind}`);
  return d;
};

/**
 * Whether a unit of kind `crusher` runs over an enemy unit of kind `victim` (BAL-1, BAL-10): every crusher flattens
 * infantry squads, and a hero flattens any ground unit but another hero. Aircraft are never crushed.
 */
export function canCrush(crusher: string, victim: string): boolean {
  const c = unitDef(crusher);
  const v = unitDef(victim);
  if (!c.crusher || v.air || v.hero) return false;
  return (v.squad ?? 1) > 1 || c.hero === true;
}

export const buildingDef = (kind: string): BuildingDef => {
  const d = BUILDING_DEFS[kind];
  if (!d) throw new Error(`unknown building kind: ${kind}`);
  return d;
};

export const isBuildingKind = (kind: string): boolean => kind in BUILDING_DEFS;

/** Unit kinds a building kind can train. */
export const trainableAt = (buildingKind: string): string[] => Object.keys(UNIT_DEFS).filter((k) => (UNIT_DEFS[k] as UnitDef).builtAt === buildingKind);

/** Structure kinds a faction can build with its headquarters. */
export const structuresOf = (faction: Faction): string[] => Object.keys(BUILDING_DEFS).filter((k) => (BUILDING_DEFS[k] as BuildingDef).faction === faction && !(BUILDING_DEFS[k] as BuildingDef).hq);

export const hqOf = (faction: Faction): string => (faction === 'human' ? 'hum_hq' : 'ali_hq');
export const refineryOf = (faction: Faction): string => (faction === 'human' ? 'hum_refinery' : 'ali_extractor');
