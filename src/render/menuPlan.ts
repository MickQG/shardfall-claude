import { structuresOf, UNIT_DEFS, type Faction } from '../data/defs';
/**
 * The pure parts of the menu's live faction scene (MENU-10, MENU-11) and of the build-button pictures (UI-17): who stands
 * in the scene, the camera's dolly, where the hero sits on screen, when the scene holds still, and the picture cache's
 * keys. No three.js here, so these are unit-tested without a GPU.
 */

export type SceneFaction = 'human' | 'alien';

/** The picked faction's hero and three other units standing in front of its HQ (MENU-10). */
export const SCENE_CAST: Readonly<Record<SceneFaction, { hero: string; others: readonly string[]; hq: string }>> = {
  human: { hero: 'hum_paladin', others: ['hum_tank', 'hum_rocketeer', 'hum_rifleman'], hq: 'hum_hq' },
  alien: { hero: 'ali_strider', others: ['ali_brute', 'ali_spitter', 'ali_skitter'], hq: 'ali_hq' },
};

/** Every kind drawn in a faction's scene, hero first and the HQ last. */
export const sceneKinds = (f: SceneFaction): string[] => [SCENE_CAST[f].hero, ...SCENE_CAST[f].others, SCENE_CAST[f].hq];

/** One pass of the camera's dolly, one way, seconds (MENU-10: 20 to 30 s). A full there-and-back takes two passes. */
export const DOLLY_PASS_S = 24;
/** Camera distance from its target at the two ends of the dolly, tiles (far, near). */
export const DOLLY_FAR = 23;
export const DOLLY_NEAR = 18.5;

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
