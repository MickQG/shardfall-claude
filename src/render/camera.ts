import { TILE_H, TILE_W } from './iso';

export interface Camera {
  /** World-space (iso pixel) point at the screen centre. */
  x: number;
  y: number;
  zoom: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;

/** Iso-pixel bounds of a map of the given size. */
export function mapBounds(width: number, height: number): Bounds {
  return { minX: (-height * TILE_W) / 2, maxX: (width * TILE_W) / 2, minY: 0, maxY: ((width + height) * TILE_H) / 2 };
}

export function clampCamera(c: Camera, b: Bounds): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom));
  return { zoom, x: Math.min(b.maxX, Math.max(b.minX, c.x)), y: Math.min(b.maxY, Math.max(b.minY, c.y)) };
}

/** Pan by screen-space pixels. */
export function pan(c: Camera, dxScreen: number, dyScreen: number, b: Bounds): Camera {
  return clampCamera({ ...c, x: c.x + dxScreen / c.zoom, y: c.y + dyScreen / c.zoom }, b);
}

export interface Viewport {
  width: number;
  height: number;
}

export function screenToWorld(c: Camera, v: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - v.width / 2) / c.zoom + c.x, y: (sy - v.height / 2) / c.zoom + c.y };
}

export function worldToScreen(c: Camera, v: Viewport, wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - c.x) * c.zoom + v.width / 2, y: (wy - c.y) * c.zoom + v.height / 2 };
}

/** Zoom keeping the world point under the screen position fixed. */
export function zoomAt(c: Camera, v: Viewport, sx: number, sy: number, factor: number, b: Bounds): Camera {
  const before = screenToWorld(c, v, sx, sy);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor));
  const next: Camera = {
    zoom,
    x: before.x - (sx - v.width / 2) / zoom,
    y: before.y - (sy - v.height / 2) / zoom,
  };
  return clampCamera(next, b);
}
