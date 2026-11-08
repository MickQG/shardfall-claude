import { structuresOf, UNIT_DEFS, type Faction } from '../data/defs';
/**
 * The pure parts of the menu's live faction scene (MENU-10, MENU-11) and of the build-button pictures (UI-17): who stands
 * in the scene, the camera's orbit around the HQ, where the ring of units sits on screen, when the scene holds still, and the picture cache's
 * keys. No three.js here, so these are unit-tested without a GPU.
 */

export type SceneFaction = 'human' | 'alien';

const HQS: Record<SceneFaction, string> = { human: 'hum_hq', alien: 'ali_hq' };

/**
 * Who stands in the picked faction's scene (MENU-10), derived from the unit table so a new unit kind joins by itself: the
 * hero, every other unit kind of the faction, its hauler (which works the shard field) and the HQ behind them.
 */
export function sceneCast(f: SceneFaction): { hero: string; others: string[]; hauler: string; hq: string } {
  const kinds = Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k]!.faction === f);
  const hero = kinds.find((k) => UNIT_DEFS[k]!.hero)!;
  const hauler = kinds.find((k) => UNIT_DEFS[k]!.role === 'harvester')!;
  return { hero, others: kinds.filter((k) => k !== hero && k !== hauler), hauler, hq: HQS[f] };
}

export const SCENE_CAST: Readonly<Record<SceneFaction, { hero: string; others: readonly string[]; hauler: string; hq: string }>> = { human: sceneCast('human'), alien: sceneCast('alien') };

/** Every kind drawn in a faction's scene, hero first, then the others, the hauler and the HQ last. */
export const sceneKinds = (f: SceneFaction): string[] => [SCENE_CAST[f].hero, ...SCENE_CAST[f].others, SCENE_CAST[f].hauler, SCENE_CAST[f].hq];

/** Where a member of the scene stands (tiles; x right, z toward the camera) and which way it faces (radians, 0 = +x). */
export interface SceneSlot {
  x: number;
  z: number;
  heading: number;
}

/** The HQ stands at the centre of the scene (tiles; x right, z toward the camera at the start). */
export const HQ_SPOT = { x: 0, z: 0 } as const;
/** Radius of the ring the units stand on around the HQ, tiles (MENU-10: 4.5 to 6; small enough that the ring fits the free strip). */
export const RING_RADIUS = 4.8;
/** The hero's place on the ring (radians from +x toward +z): toward the camera at the start, a little to the right. */
export const HERO_ANGLE = Math.PI / 2 - 0.3;
/** Width of the arc the shard field takes, radians (about 90 degrees). */
export const FIELD_ARC = Math.PI / 2;
/** Six slots, evenly spaced over the arc the field leaves free; offsets from the field's centre. */
const SLOT_STEP = (Math.PI * 2 - FIELD_ARC) / 6;
const slotOffset = (i: number): number => FIELD_ARC / 2 + SLOT_STEP * (i + 0.5);
/** The slot the hero takes, and the order the other kinds take the rest (nearest the hero first, alternating sides). */
const HERO_SLOT = 2;
const OTHER_SLOTS: readonly number[] = [3, 1, 4, 0, 5];
/** Where the shard field is centred around the HQ: opposite the hero, a little turned. */
export const FIELD_ANGLE = HERO_ANGLE - slotOffset(HERO_SLOT);
/** The hero's clear radius for crystals, and the HQ's. */
export const HERO_CLEAR = 2.2;
export const HQ_CLEAR = 3.0;
/** The hauler stands in the shard field, at this radius from the HQ, facing out into it. */
export const HAULER_RADIUS = 4.7;

/** The slot of every unit kind in a faction's scene (hero, others, hauler): evenly spaced around the HQ, facing outward (MENU-10). Seeded jitter of a few hundredths keeps it loose. */
export function sceneSlots(f: SceneFaction): Record<string, SceneSlot> {
  const cast = SCENE_CAST[f];
  const r = stream(SHARD_SEEDS[f] ^ 0x51);
  const at = (a: number, rad: number, jitter: boolean): SceneSlot => {
    const aa = a + (jitter ? (r() - 0.5) * 0.1 : 0);
    const rr = rad + (jitter ? (r() - 0.5) * 0.4 : 0);
    return { x: HQ_SPOT.x + Math.cos(aa) * rr, z: HQ_SPOT.z + Math.sin(aa) * rr, heading: aa };
  };
  const out: Record<string, SceneSlot> = {};
  out[cast.hero] = at(FIELD_ANGLE + slotOffset(HERO_SLOT), RING_RADIUS, false);
  cast.others.forEach((k, i) => {
    out[k] = at(FIELD_ANGLE + slotOffset(OTHER_SLOTS[i % OTHER_SLOTS.length]!), RING_RADIUS, true);
  });
  out[cast.hauler] = at(FIELD_ANGLE, HAULER_RADIUS, false);
  return out;
}

/** One shard crystal: the in-game crystal model of `level` (1..4) and `variant` (0..2), at ground (x, z), turned by `yaw`. */
export interface ShardSpot {
  x: number;
  z: number;
  level: number;
  variant: number;
  yaw: number;
}

/** Crystals in the shard field beside the HQ, and loose ones scattered farther out (MENU-10). */
export const SHARD_FIELD_COUNT = 32;
export const SHARD_LOOSE_COUNT = 7;
/** Seed of each faction's placement (pure, so a scene looks the same on every visit). */
export const SHARD_SEEDS: Readonly<Record<SceneFaction, number>> = { human: 0x5ad1, alien: 0x7e0b };
/** The shard field's reach from the HQ, tiles. */
export const FIELD_INNER = 3.4;
export const FIELD_OUTER = 8.2;

/** A seeded stream of numbers in [0, 1). Pure. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Round zones (x, z, radius) crystals keep out of: the HQ, the hero and every other unit's slot, and the hauler. */
function keepClear(f: SceneFaction): (readonly [number, number, number])[] {
  const cast = SCENE_CAST[f];
  return [
    [HQ_SPOT.x, HQ_SPOT.z, HQ_CLEAR],
    ...Object.entries(sceneSlots(f)).map(([k, s]) => [s.x, s.z, k === cast.hero ? HERO_CLEAR : k === cast.hauler ? 1.3 : 1.2] as const),
  ];
}

/**
 * The scene's crystals for a faction: a dense field over an arc of about 90 degrees beside the HQ, where the hauler works
 * (higher crystals toward its middle), and a few loose ones scattered farther out. Seeded, and clear of every unit and the HQ.
 */
export function shardPlan(f: SceneFaction): { field: ShardSpot[]; loose: ShardSpot[] } {
  const r = stream(SHARD_SEEDS[f]);
  const zones = keepClear(f);
  const clear = (x: number, z: number): boolean => zones.every(([cx, cz, rad]) => Math.hypot(x - cx, z - cz) > rad);
  const spot = (x: number, z: number, level: number): ShardSpot => ({ x, z, level, variant: Math.floor(r() * 3), yaw: r() * Math.PI * 2 });
  const field: ShardSpot[] = [];
  for (let guard = 0; field.length < SHARD_FIELD_COUNT && guard < 4000; guard++) {
    const u = (r() - 0.5) * 2; // across the arc, -1..1
    const a = FIELD_ANGLE + u * (FIELD_ARC / 2) * 0.96;
    const d = FIELD_INNER + r() * (FIELD_OUTER - FIELD_INNER);
    const x = HQ_SPOT.x + Math.cos(a) * d;
    const z = HQ_SPOT.z + Math.sin(a) * d;
    if (!clear(x, z)) continue;
    const mid = Math.max(Math.abs(u), Math.abs((d - 5.8) / 2.4));
    field.push(spot(x, z, mid < 0.4 ? 3 + Math.floor(r() * 2) : mid < 0.75 ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2)));
  }
  const loose: ShardSpot[] = [];
  for (let guard = 0; loose.length < SHARD_LOOSE_COUNT && guard < 4000; guard++) {
    const a = r() * Math.PI * 2;
    const d = 8.6 + r() * 3.5;
    const x = HQ_SPOT.x + Math.cos(a) * d;
    const z = HQ_SPOT.z + Math.sin(a) * d;
    if (!clear(x, z)) continue;
    loose.push(spot(x, z, 1 + Math.floor(r() * 2)));
  }
  return { field, loose };
}

/** One full turn of the camera around the HQ, seconds (MENU-10: 60 to 90 s), at constant speed. */
export const ORBIT_PERIOD_S = 75;
/** The camera's angle around the HQ (radians from +x toward +z) at `t` seconds: it starts with the hero in front, a little to the side, and turns at a constant rate. Pure. */
export const orbitAngleAt = (t: number): number => HERO_ANGLE + 0.3 + (t / ORBIT_PERIOD_S) * Math.PI * 2;
/** The angle the camera holds on Low quality or with reduced motion: the hero in front. */
export const STILL_ANGLE = orbitAngleAt(0);
/** The camera angle to use at `t` seconds: the orbit, or the flattering fixed angle when holding still. */
export const cameraAngle = (t: number, still: boolean): number => (still ? STILL_ANGLE : orbitAngleAt(t));

/** The menu panel's right edge at screen width `w`: the 300 px rail, the main area's padding and the 860 px panel (MENU-11). */
export const panelRight = (w: number): number => 300 + Math.min(56, Math.max(20, 0.04 * w)) + 860;

/** From this screen width up the HQ stands in the free strip right of the panel (MENU-11); from CLEAR_UNITS_WIDTH up the whole ring stays clear of the panel too. */
export const CLEAR_MIN_WIDTH = 1600;
export const CLEAR_UNITS_WIDTH = 1920;
/** Room kept between the panel's edge (and the screen's right edge) and the nearest unit, px. */
export const PANEL_MARGIN = 16;

/** The scene camera's fixed angles (shared with the three.js scene): vertical field of view and pitch (about 36 degrees). */
export const SCENE_FOV = 32;
export const SCENE_PITCH = 0.63;
/** Height of the point the camera looks at (tiles above the HQ's centre on the ground). */
export const TARGET_HEIGHT = 1.2;
/** The camera's distance per pixel of screen height where the scene is not fitted to the free strip (below 1920 px). */
export const DIST_PER_HEIGHT = 0.0323;

/** Ground radius, in tiles, that covers a kind's model and its squad's wander: a conservative footprint (MENU-11). */
export function footprintOf(kind: string): number {
  const d = UNIT_DEFS[kind];
  if (!d) return 2.3; // buildings: the HQ is 3 x 3 tiles
  if (d.hero) return 1.5;
  if (d.role === 'scout') return 0.8;
  if ((d.squad ?? 1) > 1) return 1.0;
  return 1.1;
}

/** Horizontal screen extent of a kind's footprint seen from camera `angle` and `dist` tiles out, px relative to the screen's middle, before the projection shift. */
export function projectedSpan(f: SceneFaction, kind: string, angle: number, dist: number, h: number): [number, number] {
  const s = kind === SCENE_CAST[f].hq ? HQ_SPOT : sceneSlots(f)[kind]!;
  const r = footprintOf(kind);
  const right = (s.x - HQ_SPOT.x) * Math.sin(angle) - (s.z - HQ_SPOT.z) * Math.cos(angle);
  const toward = (s.x - HQ_SPOT.x) * Math.cos(angle) + (s.z - HQ_SPOT.z) * Math.sin(angle);
  // Depth along the view: nearer units look bigger, so the footprint is measured at its nearest point.
  const depth = dist - toward * Math.cos(SCENE_PITCH) + TARGET_HEIGHT * Math.sin(SCENE_PITCH) - r;
  const fpx = h / 2 / Math.tan((SCENE_FOV * Math.PI) / 360);
  return [((right - r) / depth) * fpx, ((right + r) / depth) * fpx];
}

/** The angles sampled around the orbit when fitting and testing the framing. */
export const ORBIT_SAMPLES = 12;

/** Every unit in a faction's scene (the HQ stands at the middle). */
export const castKinds = (f: SceneFaction): string[] => sceneKinds(f).filter((k) => k !== SCENE_CAST[f].hq);

/**
 * The scene's framing at screen `w` by `h` (MENU-11): the camera's distance from the HQ, tiles, and how far the projection
 * shifts right, px. From 1600 px up the HQ sits in the middle of the free strip between the panel and the screen's right
 * edge, and from 1920 px up the camera stands far enough out that the whole ring clears the panel at every angle of the
 * orbit. Below 1600 px the scene shows through the glass, the HQ a little right of centre. Pure.
 */
export function sceneFraming(f: SceneFaction, w: number, h: number): { dist: number; shift: number } {
  const wide = h * DIST_PER_HEIGHT;
  if (w < CLEAR_MIN_WIDTH) return { dist: wide, shift: w * 0.62 - w / 2 };
  const left = panelRight(w) + PANEL_MARGIN;
  const right = w - PANEL_MARGIN;
  const shift = (left + right) / 2 - w / 2;
  const half = (right - left) / 2;
  let dist = 80;
  for (let d = 20; d < 80; d += 0.1) {
    let reach = 0;
    for (let i = 0; i < ORBIT_SAMPLES; i++) {
      for (const k of castKinds(f)) {
        const [lo, hi] = projectedSpan(f, k, (i / ORBIT_SAMPLES) * Math.PI * 2, d, h);
        reach = Math.max(reach, -lo, hi);
      }
    }
    if (reach <= half) {
      dist = d;
      break;
    }
  }
  return { dist: w < CLEAR_UNITS_WIDTH ? Math.min(dist, wide) : dist, shift };
}

/** Whether the scene is drawn once and held still: Low quality, or the system asks for reduced motion (MENU-10). */
export const holdStill = (quality: 'high' | 'low', reducedMotion: boolean): boolean => quality === 'low' || reducedMotion;

/** How long the crossfade to the other faction's scene takes, ms: out, swap, in (MENU-10: within 600). */
export const FADE_OUT_MS = 250;
export const FADE_IN_MS = 250;

/** The key of a build-button picture in the cache (UI-17): one per kind and team colour. */
export const iconKey = (kind: string, team: number): string => `${kind}|${team.toString(16)}`;

/** Pictures kept per kind and team colour; drawn once while the game loads (UI-17). */
export class IconCache {
  private pics = new Map<string, string>();

  get(kind: string, team: number): string | undefined {
    return this.pics.get(iconKey(kind, team));
  }

  set(kind: string, team: number, url: string): void {
    this.pics.set(iconKey(kind, team), url);
  }

  has(kind: string, team: number): boolean {
    return this.pics.has(iconKey(kind, team));
  }

  get size(): number {
    return this.pics.size;
  }

  /** The kinds in `kinds` with no picture yet for `team`. */
  missing(kinds: readonly string[], team: number): string[] {
    return kinds.filter((k) => !this.has(k, team));
  }
}

/** The kinds that have a build or train button in a faction's sidebar (UI-17): its structures, then its units. */
export const buttonKinds = (faction: Faction): string[] => [...structuresOf(faction), ...Object.keys(UNIT_DEFS).filter((k) => UNIT_DEFS[k]!.faction === faction)];
