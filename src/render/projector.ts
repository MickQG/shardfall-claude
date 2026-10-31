import { screenToWorld, worldToScreen, type Camera, type Viewport } from './camera';
import { screenToTile, tileToScreen, type Pt } from './iso';

/**
 * The one seam between a renderer's view and the input code (R3D-5): where a tile point appears on screen, and which
 * ground tile is under a screen point. Selection, orders, hit-testing, cursors and test hooks all go through it, so they
 * behave the same whichever renderer draws the world.
 */
export interface Projector {
  /** Screen pixel of fractional tile (tx, ty), lifted `liftPx` (isometric pixels at zoom 1) above the ground. */
  toScreen(tx: number, ty: number, liftPx?: number): Pt;
  /** Fractional ground tile under screen pixel (sx, sy). */
  toGround(sx: number, sy: number): Pt;
}

/** The classic isometric projection for the current camera. */
export function isoProjector(cam: Camera, vp: Viewport): Projector {
  return {
    toScreen: (tx, ty, liftPx = 0) => {
      const w = tileToScreen(tx, ty);
      return worldToScreen(cam, vp, w.x, w.y - liftPx);
    },
    toGround: (sx, sy) => {
      const w = screenToWorld(cam, vp, sx, sy);
      return screenToTile(w.x, w.y);
    },
  };
}
