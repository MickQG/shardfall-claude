import { bakeModel, type Sprite } from './bake';
import type { UnitModel } from './models';

/** One baked layer of a unit, positioned by where its anchor falls relative to the hull's anchor. */
export interface Layer {
  sprite: Sprite;
  dx: number;
  dy: number;
}

const PX_X = 4;
const PX_Y = 2;
const PX_Z = 4;

/** Screen offset (px) from the hull's ground-centre anchor of a point given in voxels from the hull's centre, once the hull is turned. */
export function localOffset(scale: number, p: { x: number; y: number; z: number }, hullFacing: number, facings = 16): { dx: number; dy: number } {
  const theta = (((hullFacing % facings) + facings) % facings) * ((Math.PI * 2) / facings);
  const rx = p.x * Math.cos(theta) - p.y * Math.sin(theta);
  const ry = p.x * Math.sin(theta) + p.y * Math.cos(theta);
  return { dx: (rx - ry) * PX_X * scale, dy: (rx + ry) * PX_Y * scale - p.z * PX_Z * scale };
}

/**
 * Bakes a unit: the hull at its heading facing, and the turret (if any) at its aim facing, placed at the hull's pivot
 * (which turns with the hull).
 */
export function composeUnit(u: UnitModel, team: number, hullFacing: number, aimFacing: number, facings = 16): Layer[] {
  const layers: Layer[] = [{ sprite: bakeModel(u.hull, { team, facing: hullFacing, facings }), dx: 0, dy: 0 }];
  if (u.turret) layers.push({ sprite: bakeModel(u.turret.model, { team, facing: aimFacing, facings }), ...localOffset(u.hull.scale, u.turret.pivot, hullFacing, facings) });
  return layers;
}
