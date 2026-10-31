import type { Camera } from '../render/camera';
import { screenToTile } from '../render/iso';

/**
 * The 3D camera follows the same camera state as the isometric view (R3D-4): the screen-centre point and zoom. It looks
 * along the isometric heading (from +X +Z towards the target), at a fixed pitch, from a distance set by the zoom, so
 * panning, zooming, centring and the minimap keep working unchanged.
 */

/** Height per unit of offset along each ground axis (the camera sits diagonally, so the pitch is atan(rise / sqrt 2)): about 41 degrees, a classic RTS view. */
export const PITCH_RISE = 1.25;
/** Distance from the target at zoom 1, in tiles. */
export const BASE_DISTANCE = 24;
export const FOV = 40;
/** World units of height per isometric pixel of lift (one tile edge is about 45 px on screen). */
export const PX_PER_UNIT = 45;

export interface Pose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Camera position and look-at point in world units (X = tile x, Y = up, Z = tile y). Pure. */
export function cameraPose(cam: Camera): Pose {
  const t = screenToTile(cam.x, cam.y);
  const d = BASE_DISTANCE / cam.zoom;
  const len = Math.hypot(1, PITCH_RISE, 1);
  return { position: [t.x + d / len, (d * PITCH_RISE) / len, t.y + d / len], target: [t.x, 0, t.y] };
}
