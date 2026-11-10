import type { Camera } from '../render/camera';
import { MAX_ZOOM } from '../render/camera';
import { screenToTile } from '../render/iso';

/**
 * The 3D camera follows the same camera state as the isometric view (R3D-4): the screen-centre point and zoom. It looks
 * along the isometric heading (from +X +Z towards the target), at a pitch that follows the zoom (R3D-28), from a distance set by the zoom, so
 * panning, zooming, centring and the minimap keep working unchanged.
 */

/** Height per unit of offset along each ground axis (the camera sits diagonally, so the pitch is atan(rise / sqrt 2)): about 41 degrees, a classic RTS view. */
export const PITCH_RISE = 1.25;
/** Height per unit of offset at the closest zoom (about 27 degrees): a lower, more cinematic angle (R3D-28). */
export const CLOSE_RISE = 0.7;

/**
 * The pitch for a zoom (R3D-28): today's PITCH_RISE at the default zoom and when zoomed out, easing with a smoothstep down
 * to CLOSE_RISE at the closest zoom. Continuous and monotone. Pure.
 */
export function riseFor(zoom: number): number {
  const t = Math.min(1, Math.max(0, (zoom - 1) / (MAX_ZOOM - 1)));
  return PITCH_RISE + (CLOSE_RISE - PITCH_RISE) * (t * t * (3 - 2 * t));
}

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
  const rise = cam.rise ?? riseFor(cam.zoom);
  const len = Math.hypot(1, rise, 1);
  return { position: [t.x + d / len, (d * rise) / len, t.y + d / len], target: [t.x, 0, t.y] };
}
