import { box, createModel, cylinder, sphere, type Material, type VoxelModel } from './model';

/** A unit is a hull plus an optional turret that turns independently about `pivot` (voxels from the hull's centre, z up). */
export interface UnitModel {
  hull: VoxelModel;
  turret?: { model: VoxelModel; pivot: { x: number; y: number; z: number } };
  /** Height in px at which an overlay (rotor, wings) sits above the ground centre. */
  overlayY?: number;
  /** Where hauled shards show, in voxels from the hull's centre. */
  loadPivot?: { x: number; y: number; z: number };
}

const mat = (color: number, o: Partial<Material> = {}): Material => ({ color, ...o });

// Human palette.
const STEEL = mat(0x8a97a6, { metal: true });
const STEEL_D = mat(0x4d5966, { metal: true });
const RUBBER = mat(0x222a33);
const TEAM = mat(0xffffff, { team: true });
const GLASS = mat(0x7fd6ff, { glow: true });
const WARM = mat(0xffb347, { glow: true });
const HELMET = mat(0xcdd8e4);
const GUN = mat(0x222c36);
const CARGO = mat(0x35e0a1, { glow: true });
// Alien palette.
const HIVE = mat(0x8a56b8);
const HIVE_D = mat(0x3d2552);
const HIVE_L = mat(0xb184dc);
const SAC = mat(0xb6ff5c, { glow: true });
const BONE = mat(0xe6dcc8);

/** Unit models are authored at half-size voxels (16 per tile) for finer detail. */
const unit = (sx: number, sy: number, sz: number, mats: readonly Material[]): VoxelModel => createModel(sx, sy, sz, mats, 0.5);

/** Forward is +x; y is the unit's left (screen left-down); z is up. */

function rifleman(rocket: boolean): UnitModel {
  const m = unit(10, 8, 13, [STEEL, STEEL_D, RUBBER, TEAM, HELMET, GLASS, GUN, WARM]);
  box(m, 3, 2, 0, 2, 2, 5, 3); // legs
  box(m, 3, 4, 0, 2, 2, 5, 3);
  box(m, 2, 2, 5, 4, 4, 4, 1); // torso
  box(m, 2, 2, 5, 4, 4, 1, 2); // belt
  box(m, 1, 3, 5, 1, 2, 3, 4); // team backpack
  box(m, 3, 1, 6, 2, 1, 3, 1); // arms
  box(m, 3, 6, 6, 2, 1, 3, 1);
  box(m, 3, 3, 9, 3, 3, 3, 5); // helmet
  box(m, 6, 3, 10, 1, 3, 1, 6); // visor
  if (rocket) {
    box(m, 0, 5, 8, 9, 2, 2, 2); // shoulder launcher
    box(m, 9, 5, 8, 1, 2, 2, 8);
  } else {
    box(m, 5, 6, 6, 5, 1, 1, 7); // rifle
    box(m, 4, 5, 6, 1, 1, 1, 7);
  }
  return { hull: m };
}

function buggy(): UnitModel {
  const m = unit(16, 10, 9, [STEEL, STEEL_D, RUBBER, TEAM, GLASS, GUN]);
  for (const x of [2, 10]) for (const y of [0, 8]) box(m, x, y, 0, 4, 2, 4, 3); // wheels
  box(m, 2, 2, 2, 12, 6, 2, 1); // chassis
  box(m, 11, 2, 4, 4, 6, 1, 4); // team hood
  box(m, 5, 2, 4, 1, 1, 3, 2); // roll cage
  box(m, 5, 7, 4, 1, 1, 3, 2);
  box(m, 9, 2, 4, 1, 1, 3, 2);
  box(m, 9, 7, 4, 1, 1, 3, 2);
  box(m, 5, 2, 7, 5, 1, 1, 2);
  box(m, 5, 7, 7, 5, 1, 1, 2);
  box(m, 6, 3, 4, 3, 4, 1, 5); // seat
  box(m, 3, 4, 4, 2, 2, 3, 2); // gun mount
  box(m, 5, 4, 6, 7, 1, 1, 6);
  box(m, 5, 5, 6, 7, 1, 1, 6);
  return { hull: m };
}

function tank(): UnitModel {
  const h = unit(20, 12, 5, [STEEL, STEEL_D, RUBBER, TEAM, WARM]);
  for (const y of [0, 9]) {
    box(h, 1, y, 0, 18, 3, 3, 3); // tracks
    box(h, 0, y, 0, 1, 3, 2, 3);
    box(h, 19, y, 0, 1, 3, 2, 3);
    box(h, 1, y, 3, 18, 3, 1, 2); // track guards
  }
  box(h, 2, 3, 1, 16, 6, 3, 1); // hull
  box(h, 15, 3, 4, 3, 6, 1, 1); // glacis
  box(h, 17, 3, 3, 2, 6, 1, 1);
  box(h, 2, 4, 4, 5, 4, 1, 2); // engine deck
  box(h, 1, 4, 3, 1, 1, 1, 5); // exhaust
  box(h, 1, 7, 3, 1, 1, 1, 5);
  box(h, 4, 3, 2, 10, 1, 1, 4); // team stripes
  box(h, 4, 8, 2, 10, 1, 1, 4);
  const t = unit(14, 10, 6, [STEEL, STEEL_D, TEAM, WARM]);
  cylinder(t, 7, 5, 0, 4.2, 2, 1);
  cylinder(t, 7, 5, 2, 3, 1, 1);
  cylinder(t, 5.5, 5, 3, 1.2, 1, 2);
  box(t, 8, 3, 0, 1, 4, 3, 1); // mantlet
  box(t, 9, 4, 1, 5, 2, 2, 2); // barrel
  box(t, 13, 4, 1, 1, 2, 2, 4); // muzzle
  box(t, 5, 1, 1, 3, 1, 1, 3); // team band
  box(t, 5, 8, 1, 3, 1, 1, 3);
  return { hull: h, turret: { model: t, pivot: { x: -1, y: 0, z: 4 } } };
}

/** The Paladin hero (HERO-1): bigger than the tank, with twin barrels and a missile pod each side of its turret. */
function paladin(): UnitModel {
  const h = unit(24, 14, 6, [STEEL, STEEL_D, RUBBER, TEAM, WARM]);
  for (const y of [0, 11]) {
    box(h, 1, y, 0, 22, 3, 3, 3); // tracks
    box(h, 0, y, 0, 1, 3, 2, 3);
    box(h, 23, y, 0, 1, 3, 2, 3);
    box(h, 1, y, 3, 22, 3, 1, 2); // track guards
  }
  box(h, 2, 3, 1, 20, 8, 4, 1); // hull
  box(h, 18, 3, 5, 4, 8, 1, 2); // glacis armour
  box(h, 2, 4, 5, 6, 6, 1, 2); // engine deck
  box(h, 4, 3, 3, 14, 1, 1, 4); // team stripes
  box(h, 4, 10, 3, 14, 1, 1, 4);
  const t = unit(18, 14, 7, [STEEL, STEEL_D, TEAM, WARM]);
  cylinder(t, 8, 7, 0, 5, 3, 1);
  cylinder(t, 8, 7, 3, 3.6, 1, 3);
  box(t, 3, 1, 0, 8, 2, 3, 2); // missile pods
  box(t, 3, 11, 0, 8, 2, 3, 2);
  box(t, 10, 5, 1, 2, 4, 3, 1); // twin mantlet
  box(t, 12, 5, 1, 6, 1, 2, 2); // twin barrels
  box(t, 12, 8, 1, 6, 1, 2, 2);
  box(t, 17, 5, 1, 1, 4, 2, 4); // muzzles
  return { hull: h, turret: { model: t, pivot: { x: -1, y: 0, z: 5 } } };
}

function artillery(): UnitModel {
  const h = unit(22, 12, 5, [STEEL, STEEL_D, RUBBER, TEAM, WARM]);
  for (const y of [0, 9]) {
    box(h, 1, y, 0, 20, 3, 3, 3);
    box(h, 1, y, 3, 20, 3, 1, 2);
  }
  box(h, 2, 3, 1, 18, 6, 3, 1);
  box(h, 0, 2, 1, 2, 8, 2, 2); // rear spade
  box(h, 4, 3, 2, 11, 1, 1, 4);
  box(h, 4, 8, 2, 11, 1, 1, 4);
  box(h, 16, 4, 4, 3, 4, 1, 2);
  const t = unit(22, 10, 12, [STEEL, STEEL_D, TEAM, WARM]);
  cylinder(t, 8, 5, 0, 3.8, 3, 1);
  box(t, 5, 2, 3, 6, 6, 3, 2); // breech housing
  box(t, 6, 2, 3, 4, 1, 1, 3);
  for (let i = 0; i < 4; i++) box(t, 9 + i * 3, 4, 4 + i, 3, 2, 1, 2); // rising barrel
  box(t, 21, 3, 8, 1, 4, 2, 4);
  return { hull: h, turret: { model: t, pivot: { x: -2, y: 0, z: 4 } } };
}

function hauler(): UnitModel {
  const m = unit(24, 12, 10, [STEEL, STEEL_D, RUBBER, TEAM, GLASS, CARGO, WARM]);
  for (const x of [3, 9, 18]) for (const y of [0, 10]) box(m, x, y, 0, 4, 2, 4, 3);
  box(m, 2, 2, 2, 20, 8, 2, 2); // chassis
  box(m, 15, 2, 4, 7, 8, 4, 1); // cab
  box(m, 21, 3, 6, 1, 6, 2, 5); // windshield
  box(m, 15, 2, 8, 7, 8, 1, 4); // team roof
  box(m, 2, 2, 4, 13, 8, 1, 1); // bed
  box(m, 2, 2, 5, 13, 1, 3, 1);
  box(m, 2, 9, 5, 13, 1, 3, 1);
  box(m, 2, 2, 5, 1, 8, 3, 1);
  box(m, 14, 2, 5, 1, 8, 3, 1);
  box(m, 3, 3, 5, 11, 6, 1, 7); // load bay light
  box(m, 22, 3, 2, 1, 1, 1, 7); // headlights
  box(m, 22, 8, 2, 1, 1, 1, 7);
  return { hull: m, loadPivot: { x: -4, y: 0, z: 6 } };
}

function gorger(): UnitModel {
  const m = unit(24, 16, 12, [HIVE, HIVE_D, HIVE_L, SAC, TEAM, BONE]);
  sphere(m, 6, 8, 5, 4.6, 1);
  sphere(m, 12, 8, 5, 5, 1);
  sphere(m, 18, 8, 5, 3.4, 3);
  sphere(m, 8, 8, 9, 3, 4); // glowing sac
  for (const x of [6, 10, 14]) {
    box(m, x, 1, 0, 1, 3, 3, 2);
    box(m, x, 12, 0, 1, 3, 3, 2);
    box(m, x, 0, 0, 2, 1, 1, 2);
    box(m, x, 15, 0, 2, 1, 1, 2);
  }
  box(m, 20, 5, 3, 3, 1, 1, 6); // mandibles
  box(m, 20, 10, 3, 3, 1, 1, 6);
  box(m, 20, 6, 6, 1, 1, 1, 5); // team eyes
  box(m, 20, 9, 6, 1, 1, 1, 5);
  return { hull: m };
}

function skitter(): UnitModel {
  const m = unit(14, 12, 8, [HIVE, HIVE_D, TEAM, SAC, HIVE_L]);
  sphere(m, 6, 6, 4, 3.2, 1);
  sphere(m, 10, 6, 4, 2.2, 5);
  for (const x of [4, 6, 8]) {
    box(m, x, 0, 0, 1, 1, 3, 2);
    box(m, x, 11, 0, 1, 1, 3, 2);
    box(m, x, 1, 2, 1, 2, 1, 2);
    box(m, x, 9, 2, 1, 2, 1, 2);
  }
  box(m, 12, 4, 3, 2, 1, 1, 4); // claws
  box(m, 12, 7, 3, 2, 1, 1, 4);
  box(m, 11, 5, 5, 1, 1, 1, 3); // team eyes
  box(m, 11, 6, 5, 1, 1, 1, 3);
  box(m, 5, 6, 7, 1, 1, 1, 2); // spines
  box(m, 7, 6, 7, 1, 1, 1, 2);
  return { hull: m };
}

function spitter(): UnitModel {
  const m = unit(12, 10, 13, [HIVE, HIVE_D, HIVE_L, SAC, TEAM]);
  sphere(m, 5, 5, 5, 3.4, 1);
  box(m, 6, 4, 7, 2, 2, 3, 3); // neck
  sphere(m, 9, 5, 10, 2.2, 3);
  box(m, 10, 4, 8, 2, 2, 1, 4); // glowing mouth
  sphere(m, 3, 5, 9, 2.6, 4); // acid sac
  for (const [x, y] of [[3, 2], [3, 7], [7, 2], [7, 7]] as const) box(m, x, y, 0, 1, 1, 4, 2);
  box(m, 10, 4, 11, 1, 1, 1, 5);
  box(m, 10, 6, 11, 1, 1, 1, 5);
  return { hull: m };
}

function stalker(): UnitModel {
  const m = unit(24, 10, 10, [HIVE, HIVE_D, HIVE_L, TEAM, BONE]);
  sphere(m, 6, 5, 4, 2.8, 1);
  sphere(m, 11, 5, 4, 3.1, 1);
  sphere(m, 16, 5, 4, 2.5, 1);
  sphere(m, 20, 5, 5, 2.2, 3);
  for (const x of [8, 12, 16]) {
    box(m, x, 1, 0, 1, 1, 5, 2);
    box(m, x, 8, 0, 1, 1, 5, 2);
  }
  box(m, 22, 3, 3, 2, 1, 1, 5); // blades
  box(m, 22, 6, 3, 2, 1, 1, 5);
  box(m, 0, 5, 3, 5, 1, 1, 2); // tail
  box(m, 21, 4, 6, 1, 1, 1, 4);
  box(m, 21, 6, 6, 1, 1, 1, 4);
  return { hull: m };
}

function brute(): UnitModel {
  const m = unit(20, 18, 19, [HIVE, HIVE_D, HIVE_L, TEAM, BONE]);
  sphere(m, 9, 9, 10, 6, 1);
  sphere(m, 9, 3, 14, 3.2, 3);
  sphere(m, 9, 15, 14, 3.2, 3);
  sphere(m, 14, 9, 15, 3, 3);
  box(m, 8, 1, 4, 3, 3, 9, 1); // arms
  box(m, 8, 14, 4, 3, 3, 9, 1);
  sphere(m, 9, 2, 3, 2.4, 2);
  sphere(m, 9, 16, 3, 2.4, 2);
  box(m, 6, 5, 0, 4, 3, 6, 2); // legs
  box(m, 6, 10, 0, 4, 3, 6, 2);
  for (const [x, z] of [[4, 15], [6, 17], [8, 18]] as const) box(m, x, 9, z, 1, 1, 3, 5); // back spikes
  box(m, 13, 6, 17, 1, 1, 3, 5); // horns
  box(m, 13, 11, 17, 1, 1, 3, 5);
  box(m, 16, 8, 15, 1, 2, 1, 4); // team eyes
  return { hull: m };
}

function lobber(): UnitModel {
  const m = unit(22, 16, 17, [HIVE, HIVE_D, HIVE_L, SAC, TEAM]);
  sphere(m, 8, 8, 5, 5, 1);
  sphere(m, 8, 8, 11, 5, 4); // bulging acid sac
  sphere(m, 15, 8, 5, 2.5, 3);
  for (const x of [5, 8, 11]) {
    box(m, x, 1, 0, 1, 3, 3, 2);
    box(m, x, 12, 0, 1, 3, 3, 2);
  }
  box(m, 17, 7, 6, 4, 2, 2, 2); // spout
  box(m, 17, 7, 7, 1, 2, 1, 5);
  return { hull: m };
}

/** The Dreadstrider (HERO-2): a carapace raised high on six long, splayed legs, with bone plates and an acid sac. */
function strider(): UnitModel {
  const m = unit(26, 22, 24, [HIVE, HIVE_D, HIVE_L, TEAM, BONE, SAC]);
  for (const x of [5, 13, 21]) {
    for (const y of [1, 20]) box(m, x, y, 0, 1, 1, 12, 2); // legs to the ground
    box(m, x, 2, 11, 1, 5, 1, 2); // upper legs out to the knees
    box(m, x, 15, 11, 1, 5, 1, 2);
  }
  sphere(m, 13, 11, 15, 7, 1); // carapace
  sphere(m, 13, 11, 13, 6, 2); // belly
  sphere(m, 22, 11, 13, 3, 3); // head
  box(m, 24, 9, 12, 1, 1, 1, 6); // eyes
  box(m, 24, 12, 12, 1, 1, 1, 6);
  for (const x of [8, 12, 16]) box(m, x, 10, 20, 2, 3, 2, 5); // bone plates
  box(m, 10, 6, 17, 6, 1, 1, 4); // team blazes
  box(m, 10, 15, 17, 6, 1, 1, 4);
  sphere(m, 4, 11, 13, 2.5, 6); // acid sac
  box(m, 19, 10, 8, 5, 2, 2, 3); // acid cannon
  return { hull: m };
}

export const UNIT_MODELS: Readonly<Record<string, () => UnitModel>> = {
  hum_rifleman: () => rifleman(false),
  hum_rocketeer: () => rifleman(true),
  hum_buggy: buggy,
  hum_tank: tank,
  hum_artillery: artillery,
  hum_hauler: hauler,
  hum_paladin: paladin,
  ali_gorger: gorger,
  ali_skitter: skitter,
  ali_spitter: spitter,
  ali_stalker: stalker,
  ali_brute: brute,
  ali_lobber: lobber,
  ali_strider: strider,
};
