import type { Camera } from './camera';
import { screenToTile, tileToScreen } from './iso';
import { BASE_DISTANCE, FOV, riseFor } from '../render3d/camera3d';

/**
 * The fly-in (CAM-4..8, glossary): the camera sweep that opens every match, and the pure rules around it. Nothing here
 * touches the simulation, WebGL or the DOM, so it can be tested without a browser.
 */

/** How long the fly-in lasts, ms: the same for both players online, and for the fade of reduced motion and the classic view (CAM-4, CAM-6, CAM-8). */
export const FLY_MS = 4000;

/** Height per unit of ground offset at the top of the sweep (a steep, near top-down pitch of about 59 degrees), easing to the pitch of the end camera's zoom (R3D-28). */
export const START_RISE = 2.4;
/** The whole map fits within this fraction of the half-view at the start of the sweep. */
const FIT_MARGIN = 0.9;

/** Smootherstep: 0 to 1 with zero speed and zero acceleration at both ends. */
export function smootherstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** What the fly-in looks like in this session (CAM-8): a camera sweep, or a still view fading in from black. */
export type FlyMode = 'sweep' | 'fade';

/** The fade replaces the sweep when the system asks for reduced motion and in the classic view (CAM-8). Pure. */
export function flyMode(o: { reducedMotion: boolean; classic: boolean }): FlyMode {
  return o.reducedMotion || o.classic ? 'fade' : 'sweep';
}

/** The test-and-development switch `?flyin=0`, which skips the fly-in; never shown to players, never a setting. */
export function flyEnabled(param: string | null): boolean {
  return param !== '0';
}

/**
 * The hold at the start of a match (CAM-5, CAM-6): from the moment the battlefield is shown until the fly-in ends,
 * game time does not run and no command is accepted. Single-player can skip it; online it cannot, and it lasts FLY_MS
 * whatever the renderer or motion setting. Pure: time is passed in.
 */
export class FlyIn {
  readonly mode: FlyMode;
  /** Single-player only (CAM-6). */
  readonly skippable: boolean;
  readonly ms = FLY_MS;
  private startedAt: number | null = null;
  private skipped: boolean;

  constructor(o: { online: boolean; reducedMotion: boolean; classic: boolean; enabled?: boolean }) {
    this.mode = flyMode(o);
    this.skippable = !o.online;
    this.skipped = o.enabled === false;
  }

  /** The battlefield is on screen: the clock starts. */
  start(now: number): void {
    this.startedAt ??= now;
  }

  /** Any key or click; ends the fly-in at once where that is allowed (CAM-6). Returns whether it did. */
  skip(now: number): boolean {
    if (!this.skippable || this.startedAt === null || this.finished(now)) return false;
    this.skipped = true;
    return true;
  }

  /** 0 at the start of the fly-in, 1 once it has ended. */
  progress(now: number): number {
    if (this.skipped) return 1;
    if (this.startedAt === null) return 0;
    return Math.min(1, Math.max(0, (now - this.startedAt) / this.ms));
  }

  /** Whether the fly-in has ended: only then may game time run and commands be given (CAM-5). */
  finished(now: number): boolean {
    return this.progress(now) >= 1;
  }
}

/** The camera pose of the sweep is a camera (centre, zoom) and a pitch (`rise`), so the heading never changes. */
export interface MapSize {
  width: number;
  height: number;
}

const fits = new Map<string, number>();

/**
 * The camera distance (in tiles) at which all four corners of the map are within view from straight above its middle,
 * for the viewport's aspect ratio and the steep starting pitch. Pure.
 */
function fitDistance(map: MapSize, aspect: number): number {
  const key = `${map.width}x${map.height}@${aspect.toFixed(3)}`;
  const known = fits.get(key);
  if (known !== undefined) return known;
  const tanV = Math.tan((FOV * Math.PI) / 360);
  const tanH = tanV * aspect;
  const len = Math.hypot(1, START_RISE, 1);
  const f = [-1 / len, -START_RISE / len, -1 / len];
  const right = [1 / Math.SQRT2, 0, -1 / Math.SQRT2];
  const up = [right[1]! * f[2]! - right[2]! * f[1]!, right[2]! * f[0]! - right[0]! * f[2]!, right[0]! * f[1]! - right[1]! * f[0]!];
  const cx = map.width / 2;
  const cz = map.height / 2;
  const corners = [
    [0, 0],
    [map.width, 0],
    [map.width, map.height],
    [0, map.height],
  ];
  const visible = (d: number): boolean => {
    const pos = [cx + (d * 1) / len, (d * START_RISE) / len, cz + d / len];
    return corners.every(([x, z]) => {
      const v = [x! - pos[0]!, -pos[1]!, z! - pos[2]!];
      const depth = v[0]! * f[0]! + v[1]! * f[1]! + v[2]! * f[2]!;
      if (depth <= 0.5) return false;
      const sx = (v[0]! * right[0]! + v[1]! * right[1]! + v[2]! * right[2]!) / depth;
      const sy = (v[0]! * up[0]! + v[1]! * up[1]! + v[2]! * up[2]!) / depth;
      return Math.abs(sx) <= FIT_MARGIN * tanH && Math.abs(sy) <= FIT_MARGIN * tanV;
    });
  };
  let lo = 4;
  let hi = 1200;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (visible(mid)) hi = mid;
    else lo = mid;
  }
  fits.set(key, hi);
  return hi;
}

/**
 * The fly-in's camera at `t01` (0..1) of its length (CAM-4): from high above the middle of the map, steeply pitched and
 * with the whole map in view, easing in and out (smootherstep) down to `end`, the pose a match starts with. At 1 it is
 * `end` exactly. The heading is the isometric heading throughout; only the position, zoom and pitch ease. Pure.
 */
export function flyPose(t01: number, map: MapSize, end: Camera, aspect = 16 / 9): Camera {
  if (t01 >= 1) return { ...end };
  const e = smootherstep(t01);
  const z0 = BASE_DISTANCE / fitDistance(map, aspect);
  const to = screenToTile(end.x, end.y);
  const tx = map.width / 2 + (to.x - map.width / 2) * e;
  const ty = map.height / 2 + (to.y - map.height / 2) * e;
  const p = tileToScreen(tx, ty);
  const zoom = Math.exp(Math.log(z0) + (Math.log(end.zoom) - Math.log(z0)) * e);
  return { x: p.x, y: p.y, zoom, rise: START_RISE + (riseFor(end.zoom) - START_RISE) * e };
}

/** How far the unexplored darkness is lifted during the sweep (CAM-4): fully at the first frame, gone by 60% of the way down, so the play look is back before the camera arrives. */
export function flyFogLift(t01: number): number {
  return 1 - smootherstep(t01 / 0.6);
}

/**
 * The HUD's style while the fly-in plays and as it ends (CAM-5). Hiding with `opacity: 0` alone leaves the browser
 * compositing both panels as translucent layers over the full-screen WebGL canvas, which cost about 35 ms a frame on a
 * 1080p GPU; `visibility: hidden` as well takes them out of painting (CAM-4: the sweep must be smooth). Opacity stays 0 so
 * the HUD still fades in when the class is removed.
 */
export const FLY_HUD_CSS = '#hud,#sidebar{transition:opacity .7s ease-out}body.flyin #hud,body.flyin #sidebar{opacity:0!important;visibility:hidden!important;pointer-events:none!important}';
