import { box, createModel, cylinder, sphere, type Material, type VoxelModel } from './model';

/** Shared palette. Material ids in each model index into its own list. */
export const PAL = {
  steel: { color: 0x8a97a6, metal: true } as Material,
  steelDark: { color: 0x4d5966, metal: true } as Material,
  rubber: { color: 0x222a33 } as Material,
  team: { color: 0xffffff, team: true } as Material,
  glass: { color: 0x7fd6ff, glow: true } as Material,
  warm: { color: 0xffb347, glow: true } as Material,
};

/** Bulwark Tank: tracks, a sloped hull, a round turret and a long barrel pointing along +x. */
export function tankModel(): VoxelModel {
  const m = createModel(14, 8, 7, [PAL.steel, PAL.steelDark, PAL.rubber, PAL.team, PAL.warm]);
  // Tracks and road wheels.
  box(m, 1, 0, 0, 11, 2, 2, 3);
  box(m, 1, 6, 0, 11, 2, 2, 3);
  box(m, 0, 0, 0, 1, 2, 1, 3);
  box(m, 0, 6, 0, 1, 2, 1, 3);
  box(m, 12, 0, 0, 1, 2, 1, 3);
  box(m, 12, 6, 0, 1, 2, 1, 3);
  // Hull with a sloped glacis at the front and a rear deck.
  box(m, 1, 2, 1, 11, 4, 2, 2);
  box(m, 1, 2, 3, 6, 4, 1, 1);
  box(m, 8, 2, 3, 3, 4, 1, 1);
  box(m, 11, 2, 2, 1, 4, 1, 1);
  // Team stripe along the sides of the hull.
  box(m, 2, 2, 2, 8, 1, 1, 4);
  box(m, 2, 5, 2, 8, 1, 1, 4);
  // Turret and gun.
  cylinder(m, 6.5, 4, 4, 2.6, 2, 1);
  cylinder(m, 6.5, 4, 6, 1.4, 1, 2);
  box(m, 9, 3, 5, 5, 2, 1, 2);
  box(m, 13, 3, 5, 1, 2, 1, 5);
  // Rear exhaust glow.
  box(m, 1, 3, 3, 1, 2, 1, 5);
  return m;
}

/** Skitterer: a low insectoid body on splayed legs. Placeholder-quality until the full roster lands. */
export function skitterModel(): VoxelModel {
  const hive: Material = { color: 0x8a56b8 };
  const dark: Material = { color: 0x3d2552 };
  const m = createModel(10, 8, 6, [hive, dark, PAL.team, PAL.warm]);
  sphere(m, 5, 4, 3, 2.4, 1);
  box(m, 6, 3, 3, 3, 2, 2, 1);
  for (const y of [0, 7]) for (const x of [2, 4, 6]) box(m, x, y, 0, 1, 1, 2, 2);
  for (const y of [1, 6]) for (const x of [2, 4, 6]) box(m, x, y, 1, 1, 1, 1, 2);
  box(m, 8, 3, 4, 1, 1, 1, 3);
  box(m, 8, 4, 4, 1, 1, 1, 3);
  box(m, 4, 3, 5, 2, 2, 1, 3);
  return m;
}

export const SPRITE_MODELS: Record<string, () => VoxelModel> = {
  hum_tank: tankModel,
  ali_skitter: skitterModel,
};
