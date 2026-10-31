import { box, createModel, cylinder, sphere, topLayer, type Material, type VoxelModel } from './model';
import { NEXT_BUILDING_MODELS } from './nextModels';
import { renderStyle } from './style';

const mat = (color: number, o: Partial<Material> = {}): Material => ({ color, ...o });

// Human palette (index order in `H`): 1 concrete, 2 panel, 3 dark, 4 team, 5 glass, 6 warm, 7 roof, 8 hazard, 9 pipe.
const H: readonly Material[] = [
  mat(0x6b7a8c),
  mat(0x8394a8, { metal: true }),
  mat(0x39434f),
  mat(0xffffff, { team: true }),
  mat(0x7fd6ff, { glow: true }),
  mat(0xffb347, { glow: true }),
  mat(0x9aaabd, { metal: true }),
  mat(0xe0b43a),
  mat(0xaeb9c6, { metal: true }),
];
const [CON, PAN, DRK, TEAM, GLS, WRM, ROOF, HAZ, PIPE] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

// Alien palette: 1 flesh, 2 dark flesh, 3 light flesh, 4 glowing sac, 5 bone, 6 team, 7 vein glow.
const A: readonly Material[] = [mat(0x6a4390), mat(0x3d2552), mat(0xa176cc), mat(0xb6ff5c, { glow: true }), mat(0xe6dcc8), mat(0xffffff, { team: true }), mat(0xe0508c, { glow: true })];
const [FLE, FLD, FLL, SAC, BON, ATEAM, VEIN] = [1, 2, 3, 4, 5, 6, 7];

/** Buildings are authored at half-size voxels: 16 per tile edge. Forward faces are +x (right-down) and +y (left-down). */
const model = (tw: number, th: number, sz: number, mats: readonly Material[]): VoxelModel => createModel(tw * 16, th * 16, sz, mats, 0.5);

/** A row of window slits along the +x and +y faces of a block (x0..x1, y0..y1, z0..z1 is the block's extent). */
function windows(m: VoxelModel, x0: number, y0: number, x1: number, y1: number, z: number, h: number, step: number, mat_: number): void {
  for (let i = x0 + 3; i + 2 < x1; i += step) box(m, i, y1 - 1, z, 2, 1, h, mat_);
  for (let j = y0 + 3; j + 2 < y1; j += step) box(m, x1 - 1, j, z, 1, 2, h, mat_);
}

/** A one-layer ring of `mat_` at radius r and width w, leaving the inside as `inner` (so a team band does not paint the whole top). */
function band(m: VoxelModel, cx: number, cy: number, z: number, r: number, w: number, mat_: number, inner: number): void {
  cylinder(m, cx, cy, z, r, 1, mat_);
  cylinder(m, cx, cy, z, r - w, 1, inner);
}

/** n small boxes spaced evenly on a circle. */
function around(m: VoxelModel, cx: number, cy: number, r: number, n: number, z: number, w: number, d: number, h: number, mat_: number, phase = 0): void {
  for (let k = 0; k < n; k++) {
    const a = phase + (k / n) * Math.PI * 2;
    box(m, Math.round(cx + Math.cos(a) * r - w / 2), Math.round(cy + Math.sin(a) * r - d / 2), z, w, d, h, mat_);
  }
}

// ---------------------------------------------------------------- Humans

function humHq(): VoxelModel {
  const m = model(3, 3, 46, H);
  box(m, 2, 2, 0, 44, 44, 2, DRK);
  box(m, 5, 5, 2, 38, 38, 12, CON); // main block
  box(m, 3, 14, 2, 4, 20, 6, PAN); // side wing
  box(m, 41, 14, 2, 4, 20, 6, PAN);
  box(m, 5, 5, 13, 38, 38, 1, TEAM); // team band
  box(m, 11, 11, 14, 26, 26, 8, PAN); // upper tier
  box(m, 11, 11, 21, 26, 26, 1, ROOF);
  box(m, 17, 17, 22, 14, 14, 6, CON); // command deck
  box(m, 17, 17, 27, 14, 14, 1, ROOF);
  windows(m, 5, 5, 43, 43, 5, 4, 5, GLS);
  windows(m, 11, 11, 37, 37, 16, 3, 4, GLS);
  box(m, 42, 20, 2, 1, 8, 6, DRK); // door
  box(m, 20, 42, 2, 8, 1, 6, DRK);
  box(m, 23, 23, 28, 2, 2, 12, DRK); // mast
  box(m, 21, 23, 33, 6, 2, 1, PIPE);
  box(m, 23, 21, 36, 2, 6, 1, PIPE);
  box(m, 23, 23, 40, 2, 2, 2, WRM);
  around(m, 24, 24, 20, 4, 14, 2, 2, 4, PAN, Math.PI / 4); // corner turrets
  return m;
}

function humReactor(): VoxelModel {
  const m = model(2, 2, 26, H);
  box(m, 2, 2, 0, 28, 28, 2, DRK);
  box(m, 5, 5, 2, 22, 22, 4, CON);
  cylinder(m, 10, 10, 6, 6, 14, PAN); // cooling towers
  cylinder(m, 22, 22, 6, 6, 14, PAN);
  cylinder(m, 10, 10, 12, 6.3, 1, TEAM);
  cylinder(m, 22, 22, 12, 6.3, 1, TEAM);
  cylinder(m, 10, 10, 20, 5, 1, ROOF);
  cylinder(m, 22, 22, 20, 5, 1, ROOF);
  cylinder(m, 10, 10, 21, 3, 1, GLS);
  cylinder(m, 22, 22, 21, 3, 1, GLS);
  box(m, 13, 13, 6, 6, 6, 5, GLS); // reactor core
  box(m, 12, 12, 11, 8, 8, 1, ROOF);
  box(m, 16, 5, 4, 2, 22, 1, PIPE); // coolant pipes
  box(m, 5, 16, 5, 22, 2, 1, PIPE);
  box(m, 26, 10, 2, 1, 4, 3, DRK);
  return m;
}

function humRefinery(): VoxelModel {
  const m = model(3, 2, 22, H);
  box(m, 2, 2, 0, 44, 28, 2, DRK);
  box(m, 3, 4, 2, 26, 24, 8, CON); // processing hall
  box(m, 3, 4, 9, 26, 24, 1, TEAM);
  box(m, 5, 6, 10, 22, 20, 3, ROOF);
  windows(m, 3, 4, 29, 28, 5, 3, 5, GLS);
  cylinder(m, 37, 9, 2, 6, 14, PAN); // storage silos
  cylinder(m, 37, 23, 2, 6, 14, PAN);
  cylinder(m, 37, 9, 9, 6.3, 1, TEAM);
  cylinder(m, 37, 23, 9, 6.3, 1, TEAM);
  cylinder(m, 37, 9, 16, 5, 1, ROOF);
  cylinder(m, 37, 23, 16, 5, 1, ROOF);
  box(m, 29, 14, 7, 8, 2, 2, PIPE); // feed pipes
  box(m, 29, 20, 7, 8, 2, 2, PIPE);
  box(m, 12, 6, 13, 3, 3, 8, DRK); // flue
  box(m, 12, 6, 21, 3, 3, 1, WRM);
  box(m, 30, 12, 2, 14, 8, 1, HAZ); // unloading bay marking
  box(m, 32, 14, 2, 10, 4, 1, DRK);
  box(m, 29, 3, 2, 1, 6, 5, DRK);
  return m;
}

function humBarracks(): VoxelModel {
  const m = model(2, 2, 22, H);
  box(m, 2, 2, 0, 28, 28, 2, DRK);
  box(m, 3, 3, 2, 26, 26, 8, CON);
  box(m, 3, 3, 9, 26, 26, 1, TEAM);
  box(m, 5, 5, 10, 22, 22, 2, ROOF);
  box(m, 8, 8, 12, 16, 16, 1, ROOF);
  windows(m, 3, 3, 29, 29, 5, 3, 5, GLS);
  box(m, 28, 12, 2, 1, 6, 5, DRK); // doors
  box(m, 12, 28, 2, 6, 1, 5, DRK);
  box(m, 29, 12, 7, 1, 6, 1, HAZ);
  box(m, 3, 28, 2, 1, 1, 18, DRK); // flagpole
  box(m, 4, 28, 14, 5, 1, 4, TEAM);
  box(m, 24, 4, 12, 3, 3, 3, PAN); // vent
  return m;
}

function humFactory(): VoxelModel {
  const m = model(3, 3, 30, H);
  box(m, 2, 2, 0, 44, 44, 2, DRK);
  box(m, 4, 4, 2, 40, 40, 12, CON); // hangar
  box(m, 4, 4, 13, 40, 40, 1, TEAM);
  for (let i = 0; i < 4; i++) {
    box(m, 6, 6 + i * 9, 14, 36, 5, 3, ROOF); // sawtooth roof
    box(m, 6, 6 + i * 9, 17, 36, 1, 2, GLS);
  }
  box(m, 43, 12, 2, 1, 22, 9, DRK); // bay door
  box(m, 43, 12, 10, 1, 22, 1, HAZ);
  for (let i = 0; i < 5; i++) box(m, 43, 14 + i * 4, 3, 1, 1, 7, PAN);
  windows(m, 4, 4, 44, 44, 5, 3, 6, GLS);
  cylinder(m, 10, 40, 14, 2.5, 10, DRK); // chimney
  cylinder(m, 10, 40, 24, 2.7, 1, WRM);
  box(m, 8, 8, 20, 32, 2, 1, PIPE); // gantry
  box(m, 8, 8, 14, 1, 2, 6, PIPE);
  box(m, 39, 8, 14, 1, 2, 6, PIPE);
  box(m, 20, 6, 21, 4, 4, 2, PAN);
  return m;
}

function humTurret(): VoxelModel {
  const m = model(1, 1, 22, H);
  box(m, 2, 2, 0, 12, 12, 3, DRK);
  cylinder(m, 8, 8, 3, 4.5, 3, PAN);
  cylinder(m, 8, 8, 6, 3.5, 1, TEAM);
  sphere(m, 8, 8, 10, 4.5, PAN); // emitter dome
  around(m, 8, 8, 4.5, 4, 9, 2, 2, 2, GLS); // four pulse emitters, so it reads the same from every side
  sphere(m, 8, 8, 14, 1.8, WRM);
  box(m, 7, 7, 15, 2, 2, 6, DRK); // antenna
  box(m, 7, 7, 21, 2, 2, 1, WRM);
  return m;
}

function humLab(): VoxelModel {
  const m = model(2, 2, 30, H);
  box(m, 2, 2, 0, 28, 28, 2, DRK);
  box(m, 4, 4, 2, 24, 24, 9, CON);
  box(m, 4, 4, 10, 24, 24, 1, TEAM);
  windows(m, 4, 4, 28, 28, 5, 4, 5, GLS);
  sphere(m, 16, 16, 11, 9, PAN); // observatory dome
  cylinder(m, 16, 16, 11, 9.2, 1, TEAM);
  box(m, 11, 15, 16, 10, 2, 3, GLS); // slit
  box(m, 15, 15, 20, 2, 2, 8, DRK); // dish mast
  cylinder(m, 16, 16, 27, 4, 1, ROOF);
  box(m, 8, 8, 11, 2, 2, 4, PIPE);
  box(m, 22, 22, 11, 2, 2, 4, PIPE);
  return m;
}

function humLance(): VoxelModel {
  const m = model(3, 3, 46, H);
  box(m, 2, 2, 0, 44, 44, 3, DRK);
  cylinder(m, 24, 24, 3, 20, 3, PAN);
  cylinder(m, 24, 24, 6, 16, 3, CON);
  cylinder(m, 24, 24, 6, 16.3, 1, TEAM);
  cylinder(m, 24, 24, 9, 7, 28, PAN); // pylon
  for (let z = 12; z < 36; z += 6) cylinder(m, 24, 24, z, 7.4, 1, GLS);
  cylinder(m, 24, 24, 37, 5, 2, ROOF);
  sphere(m, 24, 24, 41, 3.6, GLS); // emitter
  around(m, 24, 24, 17, 4, 6, 4, 4, 9, PAN, Math.PI / 4); // support pylons
  around(m, 24, 24, 17, 4, 15, 4, 4, 1, TEAM, Math.PI / 4);
  box(m, 41, 21, 3, 4, 6, 3, DRK);
  return m;
}

// ---------------------------------------------------------------- Aliens

function aliHq(): VoxelModel {
  const m = model(3, 3, 42, A);
  cylinder(m, 24, 24, 0, 22, 2, FLD);
  const tiers: [number, number, number, number][] = [[2, 20, 4, FLE], [6, 17, 4, FLE], [10, 14, 4, FLE], [14, 10, 4, FLL], [18, 6, 4, FLE]];
  for (const [z, r, h, mt] of tiers) cylinder(m, 24, 24, z, r, h, mt);
  cylinder(m, 24, 24, 8, 17.4, 1, ATEAM);
  sphere(m, 24, 24, 24, 6, SAC); // the heart
  sphere(m, 24, 24, 24, 3, VEIN);
  around(m, 24, 24, 18, 6, 6, 2, 2, 9, BON, 0.3); // tusks
  around(m, 24, 24, 10, 5, 14, 2, 2, 7, BON, 0.9);
  box(m, 41, 20, 2, 6, 8, 6, FLD); // maw entrance
  box(m, 42, 22, 2, 5, 4, 4, SAC);
  around(m, 24, 24, 12, 8, 17, 1, 1, 1, VEIN, 0.5);
  return m;
}

function aliGenerator(): VoxelModel {
  const m = model(2, 2, 24, A);
  cylinder(m, 16, 16, 0, 14, 3, FLD);
  cylinder(m, 16, 16, 3, 11, 2, FLE);
  for (const [x, y, z, r] of [[10, 10, 7, 6], [22, 12, 6, 5], [14, 22, 8, 6]] as const) {
    box(m, x - 1, y - 1, 5, 2, 2, z - 4, FLL); // stem
    sphere(m, x, y, z + 3, r, SAC);
    sphere(m, x, y, z + 3, r - 3, VEIN);
  }
  around(m, 16, 16, 12, 6, 3, 1, 1, 6, BON, 0.2);
  band(m, 16, 16, 4, 11.5, 1.2, ATEAM, FLE);
  return m;
}

function aliExtractor(): VoxelModel {
  const m = model(3, 2, 22, A);
  cylinder(m, 16, 16, 0, 14, 2, FLD);
  cylinder(m, 16, 16, 2, 11, 12, FLE); // pumping bulb
  cylinder(m, 16, 16, 12, 9, 4, FLL);
  sphere(m, 16, 16, 16, 7, SAC);
  box(m, 24, 6, 2, 22, 20, 2, FLD); // collecting platform
  cylinder(m, 36, 16, 4, 9, 6, FLE);
  cylinder(m, 36, 16, 7, 6, 4, 0); // gaping maw
  cylinder(m, 36, 16, 5, 5, 1, SAC);
  box(m, 22, 14, 6, 10, 4, 3, FLL); // feeding tube
  around(m, 36, 16, 8, 8, 9, 1, 1, 4, BON);
  cylinder(m, 16, 16, 6, 11.4, 1, ATEAM);
  return m;
}

function aliNest(): VoxelModel {
  const m = model(2, 2, 20, A);
  cylinder(m, 16, 16, 0, 14, 2, FLD);
  sphere(m, 10, 10, 8, 6, FLL);
  sphere(m, 22, 10, 7, 5, FLL);
  sphere(m, 16, 22, 9, 6.5, FLL);
  sphere(m, 17, 14, 11, 5, FLE);
  for (const [x, y, z] of [[10, 10, 8], [22, 10, 7], [16, 22, 9]] as const) {
    sphere(m, x + 3, y + 3, z + 2, 2, FLD); // hatch holes
    sphere(m, x + 3, y + 3, z + 2, 1, VEIN);
  }
  band(m, 16, 16, 1, 13.5, 1.2, ATEAM, FLD);
  around(m, 16, 16, 13, 6, 2, 2, 2, 5, BON, 0.1);
  return m;
}

function aliPit(): VoxelModel {
  const m = model(3, 3, 26, A);
  cylinder(m, 24, 24, 0, 22, 8, FLD);
  cylinder(m, 24, 24, 4, 22.3, 1, ATEAM);
  cylinder(m, 24, 24, 8, 20, 2, FLE);
  cylinder(m, 24, 24, 2, 15, 8, 0); // crater
  cylinder(m, 24, 24, 2, 14, 1, SAC);
  cylinder(m, 24, 24, 3, 9, 1, VEIN);
  around(m, 24, 24, 18, 12, 10, 3, 3, 9, BON);
  around(m, 24, 24, 18, 12, 10, 2, 2, 14, FLL, Math.PI / 12);
  box(m, 44, 20, 2, 3, 8, 5, FLD);
  return m;
}

function aliSpire(): VoxelModel {
  const m = model(1, 1, 30, A);
  cylinder(m, 8, 8, 0, 6.5, 3, FLD);
  const rings: [number, number, number][] = [[3, 5, 4], [7, 4, 5], [12, 3, 6], [18, 2, 6]];
  for (const [z, r, h] of rings) cylinder(m, 8, 8, z, r, h, FLE);
  cylinder(m, 8, 8, 5, 5.3, 1, ATEAM);
  cylinder(m, 8, 8, 24, 1.2, 4, BON);
  sphere(m, 8, 8, 25, 1.6, SAC);
  around(m, 8, 8, 4.5, 4, 3, 1, 1, 5, BON, 0.4);
  return m;
}

function aliEvolver(): VoxelModel {
  const m = model(2, 2, 34, A);
  cylinder(m, 16, 16, 0, 14, 3, FLD);
  cylinder(m, 16, 16, 3, 10, 22, SAC); // glowing vat
  cylinder(m, 16, 16, 3, 5, 20, VEIN);
  for (const z of [3, 10, 17, 24]) cylinder(m, 16, 16, z, 10.6, 2, FLE);
  sphere(m, 16, 16, 25, 9, FLL);
  sphere(m, 16, 16, 28, 4, SAC);
  cylinder(m, 16, 16, 10, 10.8, 1, ATEAM);
  around(m, 16, 16, 12, 5, 3, 2, 2, 12, BON, 0.2);
  return m;
}

function aliRift(): VoxelModel {
  const m = model(3, 3, 52, A);
  cylinder(m, 24, 24, 0, 22, 8, FLD);
  cylinder(m, 24, 24, 4, 22.3, 1, ATEAM);
  cylinder(m, 24, 24, 2, 16, 8, 0);
  cylinder(m, 24, 24, 2, 15, 1, VEIN);
  cylinder(m, 24, 24, 3, 11, 1, SAC);
  around(m, 24, 24, 19, 12, 8, 3, 3, 14, BON);
  around(m, 24, 24, 19, 12, 8, 2, 2, 20, BON, Math.PI / 12);
  cylinder(m, 24, 24, 3, 3.4, 34, SAC); // rift column
  sphere(m, 24, 24, 40, 5, SAC);
  sphere(m, 24, 24, 40, 2.5, VEIN);
  around(m, 24, 24, 8, 6, 12, 2, 2, 2, VEIN, 0.4);
  return m;
}

export const BUILDING_MODELS: Readonly<Record<string, () => VoxelModel>> = {
  hum_hq: humHq,
  hum_reactor: humReactor,
  hum_refinery: humRefinery,
  hum_barracks: humBarracks,
  hum_factory: humFactory,
  hum_turret: humTurret,
  hum_lab: humLab,
  hum_lance: humLance,
  ali_hq: aliHq,
  ali_generator: aliGenerator,
  ali_extractor: aliExtractor,
  ali_nest: aliNest,
  ali_pit: aliPit,
  ali_spire: aliSpire,
  ali_evolver: aliEvolver,
  ali_rift: aliRift,
};

const heights = new Map<string, number>();

/** The model maker for a building kind in the current art style (the next style overrides the showcase buildings). */
export function buildingModel(kind: string): (() => VoxelModel) | undefined {
  return (renderStyle.current === 'next' ? NEXT_BUILDING_MODELS[kind] : undefined) ?? BUILDING_MODELS[kind];
}

/** Height in px of a building's roof above its footprint, from its model (for overlays, bars and picking). */

export function buildingHeightPx(kind: string): number {
  let h = heights.get(`${renderStyle.current}|${kind}`);
  if (h === undefined) {
    const make = buildingModel(kind);
    if (!make) return 28;
    const m = make();
    h = (topLayer(m) + 1) * 4 * m.scale;
    heights.set(`${renderStyle.current}|${kind}`, h);
  }
  return h;
}
