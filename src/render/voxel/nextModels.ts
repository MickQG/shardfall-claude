import { box, createModel, cylinder, setVoxel, sphere, type Material, type VoxelModel } from './model';
import type { UnitModel } from './models';

/**
 * Showcase ("next" style) models for the graphics mockup: the slice units at quarter-size voxels (32 per tile) and the
 * slice buildings restyled. Aegis Union is heavy industrial military (gunmetal, off-white plate, hazard stripes, blue
 * lights); Vrax Hive is organic (dark chitin, ribs, acid-green veins). Original designs.
 */

const mat = (color: number, o: Partial<Material> = {}): Material => ({ color, ...o });

// Aegis Union.
const GUNMETAL = mat(0x4a5561, { metal: true });
const PLATE = mat(0xd9d4c6);
const PLATE_D = mat(0x9b968a);
const HAZ_Y = mat(0xe3b02c);
const HAZ_K = mat(0x24282d);
const RUBBER = mat(0x1c2126);
const TEAM = mat(0xffffff, { team: true });
const BLUE = mat(0x62d4ff, { glow: true });
const LAMP = mat(0xffcf7a, { glow: true });
const CONCRETE = mat(0x8b8a84);
const CONCRETE_D = mat(0x5f5f5b);
// Vrax Hive.
const CHITIN = mat(0x3d2536);
const CHITIN_L = mat(0x6a4058);
const RIB = mat(0x24151f);
const VEIN = mat(0x9dff3c, { glow: true });
const BONE = mat(0xd8cbb0);
const FLESH = mat(0x7a3c58);

/** Units at quarter-size voxels: 32 per tile edge. Forward is +x, y is the unit's left, z is up. */
const unit = (sx: number, sy: number, sz: number, mats: readonly Material[]): VoxelModel => createModel(sx, sy, sz, mats, 0.25);

/** An axis-aligned ellipsoid with radii (rx, ry, rz) centred on (cx, cy, cz). */
function ellipsoid(m: VoxelModel, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, id: number): void {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 + ((z + 0.5 - cz) / rz) ** 2 <= 1) setVoxel(m, x, y, z, id);
}

/** Alternating two-material stripes along x (hazard markings). */
function stripes(m: VoxelModel, x: number, y: number, z: number, w: number, d: number, h: number, a: number, b: number, period = 2): void {
  for (let i = 0; i < w; i++) box(m, x + i, y, z, 1, d, h, Math.floor(i / period) % 2 === 0 ? a : b);
}

// ---------------------------------------------------------------- Aegis Union units

/** One rifleman figure (squads draw three). Armoured plate over a dark undersuit, team chest band, blue visor and pack light. */
function rifleman(): UnitModel {
  const m = unit(22, 16, 27, [GUNMETAL, PLATE, PLATE_D, RUBBER, TEAM, BLUE, HAZ_K]);
  const [G, P, PD, R, T, B, K] = [1, 2, 3, 4, 5, 6, 7];
  box(m, 6, 4, 0, 4, 3, 2, R); // boots
  box(m, 6, 9, 0, 4, 3, 2, R);
  box(m, 7, 4, 2, 3, 3, 8, K); // legs
  box(m, 7, 9, 2, 3, 3, 8, K);
  box(m, 8, 4, 4, 2, 3, 4, PD); // knee plates
  box(m, 8, 9, 4, 2, 3, 4, PD);
  box(m, 5, 3, 10, 8, 10, 2, G); // belt
  box(m, 5, 3, 12, 8, 10, 7, P); // chest plate
  box(m, 12, 4, 14, 1, 8, 2, T); // team chest band
  box(m, 1, 4, 11, 4, 8, 8, G); // backpack
  box(m, 1, 7, 15, 1, 2, 2, B); // pack light
  box(m, 6, 1, 13, 4, 2, 6, PD); // shoulder pads
  box(m, 6, 13, 13, 4, 2, 6, PD);
  box(m, 9, 1, 10, 3, 2, 4, K); // forearms
  box(m, 9, 13, 10, 3, 2, 4, K);
  ellipsoid(m, 9, 8, 22, 4, 4, 3.6, P); // helmet
  box(m, 12, 5, 21, 1, 6, 2, B); // visor
  box(m, 6, 7, 25, 2, 2, 2, PD); // helmet crest
  box(m, 10, 12, 11, 12, 2, 2, G); // rifle
  box(m, 10, 12, 13, 3, 2, 1, G);
  box(m, 19, 12, 11, 3, 2, 2, K);
  return { hull: m };
}

/** The Bulwark tank: wide tracks under off-white side skirts with hazard noses, an angular turret and a long barrel. */
function tank(): UnitModel {
  const h = unit(42, 26, 11, [GUNMETAL, PLATE, PLATE_D, RUBBER, TEAM, BLUE, HAZ_Y, HAZ_K, LAMP]);
  const [G, P, PD, R, T, B, Y, K, L] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const y of [0, 19]) {
    box(h, 2, y, 0, 38, 7, 5, R); // tracks
    for (let x = 4; x < 38; x += 5) box(h, x, y === 0 ? 0 : 25, 1, 3, 1, 3, G); // road wheels
    box(h, 1, y, 5, 40, 7, 2, P); // side skirts
    stripes(h, 36, y, 5, 5, 7, 2, Y, K);
    box(h, 1, y === 0 ? 0 : 25, 5, 40, 1, 1, PD);
  }
  box(h, 4, 7, 2, 34, 12, 6, G); // hull
  box(h, 30, 7, 7, 9, 12, 2, P); // glacis
  box(h, 37, 7, 6, 3, 12, 1, P);
  box(h, 5, 8, 8, 12, 10, 2, PD); // engine deck
  for (let x = 6; x < 16; x += 3) box(h, x, 9, 10, 2, 8, 1, K); // vents
  box(h, 4, 10, 8, 1, 6, 1, B); // engine glow
  box(h, 10, 7, 6, 18, 1, 2, T); // team bands
  box(h, 10, 18, 6, 18, 1, 2, T);
  box(h, 39, 8, 4, 1, 2, 2, L); // headlights
  box(h, 39, 16, 4, 1, 2, 2, L);
  const t = unit(34, 22, 12, [GUNMETAL, PLATE, PLATE_D, TEAM, HAZ_K, BLUE]);
  const [tG, tP, tPD, tT, tK, tB] = [1, 2, 3, 4, 5, 6];
  box(t, 3, 3, 0, 18, 16, 6, tP); // turret body
  box(t, 5, 5, 6, 13, 12, 2, tPD); // stepped roof
  box(t, 19, 5, 1, 4, 12, 4, tP); // front wedge
  box(t, 1, 4, 1, 3, 14, 4, tG); // bustle
  box(t, 3, 3, 3, 18, 1, 2, tT); // team bands
  box(t, 3, 18, 3, 18, 1, 2, tT);
  box(t, 22, 9, 2, 10, 4, 3, tG); // barrel
  box(t, 30, 8, 1, 4, 6, 5, tK); // muzzle brake
  box(t, 22, 8, 1, 3, 6, 5, tPD); // mantlet
  cylinder(t, 9, 13, 8, 2.2, 1, tPD); // hatch
  box(t, 4, 6, 8, 1, 1, 4, tK); // antenna
  box(t, 4, 6, 11, 1, 1, 1, tB);
  return { hull: h, turret: { model: t, pivot: { x: -2, y: 0, z: 8 } } };
}

// ---------------------------------------------------------------- Vrax Hive units

/** One skitterer: a low segmented chitin body on six jointed legs, a glowing vein along the back, bone mandibles. */
function skitter(): UnitModel {
  const m = unit(30, 26, 15, [CHITIN, CHITIN_L, RIB, VEIN, BONE, TEAM]);
  const [C, CL, RB, V, BN, T] = [1, 2, 3, 4, 5, 6];
  ellipsoid(m, 11, 13, 7, 7, 5.5, 4.2, C); // abdomen
  ellipsoid(m, 19, 13, 7.5, 4.5, 4.2, 3.6, CL); // thorax
  ellipsoid(m, 24, 13, 7, 3, 3, 2.6, C); // head
  for (let x = 6; x <= 16; x += 3) box(m, x, 9, 10, 1, 8, 1, RB); // ribs
  box(m, 6, 12, 11, 13, 2, 1, V); // back vein
  for (const x of [9, 14, 19]) {
    for (const s of [-1, 1]) {
      const y0 = s < 0 ? 7 : 18;
      box(m, x, s < 0 ? y0 - 4 : y0 + 1, 6, 2, 4, 2, CL); // upper leg
      box(m, x, s < 0 ? 0 : 23, 0, 2, 3, 6, RB); // lower leg
    }
  }
  box(m, 26, 10, 5, 4, 1, 2, BN); // mandibles
  box(m, 26, 15, 5, 4, 1, 2, BN);
  box(m, 26, 11, 8, 1, 1, 1, T); // team eyes
  box(m, 26, 14, 8, 1, 1, 1, T);
  return { hull: m };
}

/** The brute: a hunched armoured mass with a ribbed glowing back, two crushing bone claws and thick legs. */
function brute(): UnitModel {
  const m = unit(42, 38, 38, [CHITIN, CHITIN_L, RIB, VEIN, BONE, TEAM, FLESH]);
  const [C, CL, RB, V, BN, T, F] = [1, 2, 3, 4, 5, 6, 7];
  box(m, 12, 10, 0, 7, 6, 12, RB); // legs
  box(m, 12, 22, 0, 7, 6, 12, RB);
  ellipsoid(m, 15, 19, 18, 12, 11, 10, C); // body
  ellipsoid(m, 13, 19, 25, 10, 9, 8, CL); // hunched shell
  for (let x = 6; x <= 20; x += 4) box(m, x, 11, 30, 2, 17, 2, RB); // shell ribs
  for (let x = 8; x <= 20; x += 4) box(m, x, 18, 32, 1, 3, 1, V); // vein glow between ribs
  box(m, 7, 18, 28, 14, 3, 1, V);
  ellipsoid(m, 27, 19, 20, 5, 5.5, 5, F); // head
  box(m, 31, 16, 22, 1, 2, 1, T); // team eyes
  box(m, 31, 21, 22, 1, 2, 1, T);
  for (const y of [5, 33]) {
    ellipsoid(m, 20, y, 22, 5, 4, 5, CL); // shoulders
    box(m, 22, y - 2, 8, 6, 4, 12, C); // arms
    box(m, 27, y - 3, 4, 10, 6, 5, BN); // claws
    box(m, 35, y - 3, 6, 3, 2, 3, BN);
  }
  for (const [x, z] of [[8, 33], [12, 35], [16, 36]] as const) box(m, x, 19, z, 2, 2, 3, BN); // back spikes
  return { hull: m };
}

// ---------------------------------------------------------------- Buildings (16 voxels per tile edge)

const building = (tw: number, th: number, sz: number, mats: readonly Material[]): VoxelModel => createModel(tw * 16, th * 16, sz, mats, 0.5);
const HUM_B = [CONCRETE, CONCRETE_D, GUNMETAL, PLATE, TEAM, BLUE, LAMP, HAZ_Y, HAZ_K] as const;
const [bC, bCD, bG, bP, bT, bB, bL, bY, bK] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Lit window slits along the camera-facing (+x, +y) walls of a block. */
function litWindows(m: VoxelModel, x0: number, y0: number, x1: number, y1: number, z: number, h: number, step: number, id: number): void {
  for (let i = x0 + 2; i + 2 < x1; i += step) box(m, i, y1 - 1, z, 2, 1, h, id);
  for (let j = y0 + 2; j + 2 < y1; j += step) box(m, x1 - 1, j, z, 1, 2, h, id);
}

/** Aegis Command Hub: stepped concrete-and-steel blocks, lit windows, a landing pad with hazard edge and a comms mast. */
function humHq(): VoxelModel {
  const m = building(3, 3, 48, HUM_B);
  box(m, 1, 1, 0, 46, 46, 2, bCD); // apron
  stripes(m, 1, 46, 0, 46, 1, 2, bY, bK, 3);
  box(m, 4, 4, 2, 40, 40, 11, bC); // base block
  box(m, 4, 4, 12, 40, 40, 1, bT); // team band
  litWindows(m, 4, 4, 44, 44, 5, 4, 4, bL);
  box(m, 9, 9, 13, 30, 30, 9, bG); // steel tier
  litWindows(m, 9, 9, 39, 39, 15, 3, 3, bB);
  box(m, 9, 9, 21, 30, 30, 1, bP);
  box(m, 26, 26, 22, 12, 12, 2, bP); // landing pad
  stripes(m, 26, 37, 22, 12, 1, 2, bY, bK, 2);
  cylinder(m, 32, 32, 24, 3.5, 1, bB);
  box(m, 12, 12, 22, 11, 11, 8, bC); // command deck
  litWindows(m, 12, 12, 23, 23, 25, 2, 2, bB);
  box(m, 16, 16, 30, 3, 3, 14, bG); // mast
  box(m, 13, 17, 38, 9, 1, 1, bP);
  box(m, 17, 13, 41, 1, 9, 1, bP);
  box(m, 16, 16, 44, 3, 3, 2, bL);
  for (const [x, y] of [[5, 40], [40, 5], [40, 40]] as const) {
    box(m, x, y, 13, 4, 4, 4, bG); // corner gun pods
    box(m, x + 3, y + 1, 15, 3, 2, 1, bK);
  }
  return m;
}

/** Aegis Motor Pool: a wide steel hangar with a hazard-striped door, a gantry crane and roof vents. */
function humFactory(): VoxelModel {
  const m = building(3, 3, 34, HUM_B);
  box(m, 1, 1, 0, 46, 46, 2, bCD);
  box(m, 4, 4, 2, 40, 40, 14, bG); // hangar
  box(m, 4, 4, 16, 40, 40, 4, bP); // roof
  box(m, 4, 4, 15, 40, 40, 1, bT);
  box(m, 43, 12, 2, 1, 24, 12, bK); // door
  for (let z = 2; z < 14; z += 2) stripes(m, 43, 12, z, 1, 24, 1, bY, bK, 3);
  box(m, 43, 12, 14, 1, 24, 1, bL);
  litWindows(m, 4, 4, 44, 44, 9, 3, 5, bB);
  for (let x = 8; x < 40; x += 6) box(m, x, 10, 20, 3, 28, 2, bCD); // roof vents
  box(m, 8, 4, 20, 2, 2, 12, bC); // gantry
  box(m, 8, 40, 20, 2, 2, 12, bC);
  box(m, 8, 4, 31, 2, 38, 2, bC);
  box(m, 8, 20, 26, 2, 4, 5, bY); // crane hook
  return m;
}

const ALI_B = [CHITIN, CHITIN_L, RIB, VEIN, BONE, TEAM, FLESH] as const;
const [aC, aCL, aR, aV, aB, aT, aF] = [1, 2, 3, 4, 5, 6, 7];

/** Vrax Hive Heart: a grown dome of chitin plates on living ground, ribbed spires and pulsing veins. */
function aliHq(): VoxelModel {
  const m = building(3, 3, 46, ALI_B);
  cylinder(m, 24, 24, 0, 23, 1, aF); // living ground
  cylinder(m, 24, 24, 0, 23.5, 1, aR);
  cylinder(m, 24, 24, 0, 22, 1, aF);
  ellipsoid(m, 24, 24, 8, 18, 18, 14, aC); // dome
  ellipsoid(m, 24, 24, 12, 13, 13, 12, aCL);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.round(24 + Math.cos(a) * 17);
    const y = Math.round(24 + Math.sin(a) * 17);
    box(m, x - 1, y - 1, 0, 2, 2, 14, aR); // ribs
    box(m, x, y, 2, 1, 1, 10, aV);
  }
  box(m, 22, 22, 22, 4, 4, 16, aR); // central spire
  box(m, 23, 23, 30, 2, 2, 14, aB);
  sphere(m, 24, 24, 36, 3.2, aV); // heart glow
  for (const [x, y] of [[8, 36], [36, 8], [38, 36]] as const) {
    ellipsoid(m, x, y, 4, 4, 4, 5, aCL); // pods
    box(m, x, y, 8, 1, 1, 2, aV);
  }
  cylinder(m, 24, 24, 14, 13.5, 1, aT); // team ring
  cylinder(m, 24, 24, 14, 12.5, 1, aCL);
  return m;
}

/** Vrax Brood Pit: a sunken ring of chitin around a glowing brood pool, with curved bone tusks. */
function aliPit(): VoxelModel {
  const m = building(3, 3, 30, ALI_B);
  cylinder(m, 24, 24, 0, 23, 1, aF);
  cylinder(m, 24, 24, 0, 22, 10, aC); // ring wall
  cylinder(m, 24, 24, 9, 22.4, 1, aT);
  cylinder(m, 24, 24, 2, 15, 9, aF); // pit
  cylinder(m, 24, 24, 8, 13, 1, aV); // brood pool
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    const x = Math.round(24 + Math.cos(a) * 19);
    const y = Math.round(24 + Math.sin(a) * 19);
    box(m, x - 1, y - 1, 10, 3, 3, 10, aB); // tusks
    box(m, Math.round(24 + Math.cos(a) * 16), Math.round(24 + Math.sin(a) * 16), 20, 2, 2, 6, aB);
  }
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    box(m, Math.round(24 + Math.cos(a) * 21), Math.round(24 + Math.sin(a) * 21), 3, 1, 1, 6, aV); // veins on the wall
  }
  ellipsoid(m, 24, 24, 13, 5, 5, 4, aCL); // egg mass
  box(m, 23, 23, 16, 2, 2, 2, aV);
  return m;
}

export const NEXT_UNIT_MODELS: Readonly<Record<string, () => UnitModel>> = {
  hum_rifleman: rifleman,
  hum_tank: tank,
  ali_skitter: skitter,
  ali_brute: brute,
};

export const NEXT_BUILDING_MODELS: Readonly<Record<string, () => VoxelModel>> = {
  hum_hq: humHq,
  hum_factory: humFactory,
  ali_hq: aliHq,
  ali_pit: aliPit,
};
