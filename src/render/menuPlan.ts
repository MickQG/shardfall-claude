import { structuresOf, UNIT_DEFS, type Faction } from '../data/defs';
/**
 * The pure parts of the menu's live faction scene (MENU-10, MENU-11) and of the build-button pictures (UI-17): who stands
 * in the scene, the camera's dolly, where the hero sits on screen, when the scene holds still, and the picture cache's
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

/** Facing the camera, a little to the left. */
export const FACE = Math.PI / 2 - 0.4;
/** Where the hero stands (the same for both factions), and the radius kept clear of crystals and other units. */
export const HERO_SPOT = { x: 1.4, z: 1.2 } as const;
export const HERO_CLEAR = 2.2;
/** The HQ stands behind the hero; the hauler works at the near edge of the shard field, facing into it. */
export const HQ_SPOT = { human: { x: 0.6, z: -4.2 }, alien: { x: 0.6, z: -4.4 } } as const;
export const HAULER_SPOT: SceneSlot = { x: 3.7, z: -0.1, heading: 0.1 };

type Class = 'vehicle' | 'scout' | 'infantry';
/** Formation slots by kind of unit: vehicles and artillery to the sides, scouts at the flanks, squads in front. */
const FORMATION: Record<Class, readonly SceneSlot[]> = {
  vehicle: [
    { x: -3.0, z: 0.1, heading: FACE + 0.5 },
    { x: -2.6, z: -2.0, heading: FACE + 0.3 },
    { x: -4.6, z: -2.6, heading: FACE + 0.6 },
  ],
  scout: [
    { x: -2.4, z: 2.3, heading: FACE + 0.7 },
    { x: 6.2, z: 3.4, heading: FACE - 0.6 },
  ],
  infantry: [
    { x: 0.3, z: 3.9, heading: FACE + 0.35 },
    { x: 3.8, z: 3.7, heading: FACE - 0.5 },
    { x: -3.6, z: 3.2, heading: FACE + 0.5 },
  ],
};

const classOf = (kind: string): Class => {
  const d = UNIT_DEFS[kind]!;
  return d.role === 'scout' ? 'scout' : (d.squad ?? 1) > 1 ? 'infantry' : 'vehicle';
};

/**
 * The slot of every unit kind in a faction's scene (hero, others, hauler). Seeded jitter of a few tenths of a tile keeps the
 * formation loose; a kind with no free slot in its class stands in a seeded spot on the ground behind the others.
 */
export function sceneSlots(f: SceneFaction): Record<string, SceneSlot> {
  const cast = SCENE_CAST[f];
  const r = stream(SHARD_SEEDS[f] ^ 0x51);
  const out: Record<string, SceneSlot> = { [cast.hero]: { x: HERO_SPOT.x, z: HERO_SPOT.z, heading: FACE }, [cast.hauler]: { ...HAULER_SPOT } };
  const used: Record<Class, number> = { vehicle: 0, scout: 0, infantry: 0 };
  for (const k of cast.others) {
    const c = classOf(k);
    const base = FORMATION[c][used[c]++] ?? { x: -7 + r() * 14, z: -6 - r() * 2, heading: FACE };
    out[k] = { x: base.x + (r() - 0.5) * 0.3, z: base.z + (r() - 0.5) * 0.3, heading: base.heading + (r() - 0.5) * 0.3 };
  }
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

/** Crystals in the shard field beside the HQ, and loose ones scattered nearer the camera (MENU-10). */
export const SHARD_FIELD_COUNT = 32;
export const SHARD_LOOSE_COUNT = 7;
/** Seed of each faction's placement (pure, so a scene looks the same on every visit). */
export const SHARD_SEEDS: Readonly<Record<SceneFaction, number>> = { human: 0x5ad1, alien: 0x7e0b };

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

/** Round zones (x, z, radius) crystals keep out of: the hero, every unit's formation slot and the HQ. */
function keepClear(f: SceneFaction): (readonly [number, number, number])[] {
  const slots = Object.entries(sceneSlots(f)).filter(([k]) => k !== SCENE_CAST[f].hauler);
  return [
    [HERO_SPOT.x, HERO_SPOT.z, HERO_CLEAR],
    ...slots.map(([, s]) => [s.x, s.z, 1.2] as const),
    [HQ_SPOT[f].x, HQ_SPOT[f].z, 2.7],
    [HAULER_SPOT.x, HAULER_SPOT.z, 1.3],
  ];
}

/**
 * The scene's crystals for a faction: a dense field right of the HQ, where the hauler works (higher crystals toward its
 * middle), and a few loose ones across the ground in front. Seeded, and clear of every unit and the HQ.
 */
export function shardPlan(f: SceneFaction): { field: ShardSpot[]; loose: ShardSpot[] } {
  const r = stream(SHARD_SEEDS[f]);
  const zones = keepClear(f);
  const clear = (x: number, z: number): boolean => zones.every(([cx, cz, rad]) => Math.hypot(x - cx, z - cz) > rad);
  const spot = (x: number, z: number, level: number): ShardSpot => ({ x, z, level, variant: Math.floor(r() * 3), yaw: r() * Math.PI * 2 });
  const field: ShardSpot[] = [];
  for (let guard = 0; field.length < SHARD_FIELD_COUNT && guard < 4000; guard++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r());
    const x = 4.4 + Math.cos(a) * d * 2.3;
    const z = -2.3 + Math.sin(a) * d * 1.9;
    if (!clear(x, z)) continue;
    field.push(spot(x, z, d < 0.4 ? 3 + Math.floor(r() * 2) : d < 0.75 ? 2 + Math.floor(r() * 2) : 1 + Math.floor(r() * 2)));
  }
  const loose: ShardSpot[] = [];
  for (let guard = 0; loose.length < SHARD_LOOSE_COUNT && guard < 4000; guard++) {
    const x = -6 + r() * 13;
    const z = 2.5 + r() * 4.5;
    if (!clear(x, z)) continue;
    loose.push(spot(x, z, 1 + Math.floor(r() * 2)));
  }
  return { field, loose };
}

/** One pass of the camera's dolly, one way, seconds (MENU-10: 20 to 30 s). A full there-and-back takes two passes. */
export const DOLLY_PASS_S = 24;
/** Camera distance from its target at the two ends of the dolly, tiles (far, near). */
export const DOLLY_FAR = 25;
export const DOLLY_NEAR = 20.5;

const ease = (x: number): number => x * x * (3 - 2 * x);

/** The dolly's progress at `t` seconds, 0 (far) to 1 (near), eased at both ends and going back and forth. Pure. */
export function dollyAt(t: number): number {
  const phase = ((t / DOLLY_PASS_S) % 2 + 2) % 2;
  return ease(phase < 1 ? phase : 2 - phase);
}

/** Camera distance at `t` seconds. */
export const dollyDistance = (t: number): number => DOLLY_FAR + (DOLLY_NEAR - DOLLY_FAR) * dollyAt(t);

/** The menu panel's right edge at screen width `w`: the 300 px rail, the main area's padding and the 860 px panel (MENU-11). */
export const panelRight = (w: number): number => 300 + Math.min(56, Math.max(20, 0.04 * w)) + 860;

/**
 * Where the hero stands horizontally on screen, in px from the left (MENU-11). From 1600 px up, the middle of the free
 * strip to the right of the panel; on narrower screens the scene shows through the panel's glass, so the hero sits a
 * little right of centre.
 */
export const heroScreenX = (w: number): number => (w >= 1600 ? (panelRight(w) + w) / 2 : w * 0.62);

/** How far to shift the projection to the right so the hero (drawn at the middle) lands on `heroScreenX`, px. */
export const heroShift = (w: number): number => heroScreenX(w) - w / 2;

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
