import type { Faction } from '../data/defs';
import { MAX_RANK } from '../sim';

/**
 * The veterancy badge over a unit (VET-3): none, one or two marks below the top rank, and a top-rank emblem. Aegis
 * units wear gold chevrons and a gold star; Vrax units acid-green thorns and a slit-pupilled eye.
 */
export type RankBadge = { kind: 'chevrons' | 'thorns'; count: number; color: number } | { kind: 'star' | 'eye'; color: number } | null;

/** Badge colours per faction, and the dark outline (and the eye's pupil), both views. */
export const BADGE_GOLD = 0xffd34a;
export const BADGE_ACID = 0xb6ff5c;
export const BADGE_EDGE = 0x04130d;

/** How far the badge floats up and down, tiles (3D) and pixels (classic), and how long one bob takes, ms (VET-3). */
export const BADGE_BOB_TILES = 0.05;
export const BADGE_BOB_PX = 2;
export const BADGE_BOB_MS = 1800;

/**
 * Which badge a unit of `faction` and `rank` shows (VET-3): none at rank 0; below the top rank a chevron (Aegis) or a
 * thorn (Vrax) per rank; at the top rank a star (Aegis) or an eye (Vrax).
 */
export function rankBadge(rank: number, faction: Faction): RankBadge {
  if (rank <= 0) return null;
  const alien = faction === 'alien';
  const color = alien ? BADGE_ACID : BADGE_GOLD;
  if (rank >= MAX_RANK) return { kind: alien ? 'eye' : 'star', color };
  return { kind: alien ? 'thorns' : 'chevrons', count: rank, color };
}

/**
 * The badge's float, -1..1 (VET-3): a slow sine bob, offset per unit so a ranked group does not bob in step; 0 when
 * motion is reduced.
 */
export function badgeBob(timeMs: number, id: number, motion: boolean): number {
  if (!motion) return 0;
  return Math.sin(((timeMs + id * 397) / BADGE_BOB_MS) * Math.PI * 2);
}

/** One chevron pointing up, one unit wide, its tip at y = +0.5 and its arms down to y = -0.1, as a closed outline. */
export const CHEVRON: readonly (readonly [number, number])[] = [
  [-0.5, -0.1],
  [0, 0.32],
  [0.5, -0.1],
  [0.5, 0.14],
  [0, 0.56],
  [-0.5, 0.14],
];

/** A five-pointed star one unit across (outer radius 0.5), point up, as a closed outline. */
export const STAR: readonly (readonly [number, number])[] = Array.from({ length: 10 }, (_, i) => {
  const r = i % 2 === 0 ? 0.5 : 0.21;
  const a = Math.PI / 2 + (i * Math.PI) / 5;
  return [Math.cos(a) * r, Math.sin(a) * r] as const;
});

/** Vertical gap between stacked chevrons, in chevron widths. */
export const CHEVRON_STEP = 0.36;

/** One curved thorn, point up and leaning right, about 0.45 of a unit wide and 0.75 tall, centred, as a closed outline. */
export const THORN: readonly (readonly [number, number])[] = [
  [-0.22, -0.32],
  [0.22, -0.32],
  [0.1, -0.02],
  [0.18, 0.43],
  [-0.05, 0.06],
];

/** Gap between side-by-side thorns, in units. */
export const THORN_STEP = 0.44;

/** An almond eye one unit wide and half a unit tall, centred, as a closed outline; with its slit pupil (drawn on top). */
export const EYE: readonly (readonly [number, number])[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  // A lens: the corners pinch to points, the middle bulges.
  return [0.5 * Math.cos(a), 0.25 * Math.sin(a) * Math.abs(Math.sin(a)) ** 0.2] as const;
});
export const PUPIL: readonly (readonly [number, number])[] = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return [0.07 * Math.cos(a) * Math.abs(Math.cos(a)) ** 0.3, 0.22 * Math.sin(a)] as const;
});

/** The outline shapes a badge is built from. */
export type BadgeShape = 'chevron' | 'star' | 'thorn' | 'eye' | 'pupil';
export const BADGE_SHAPES: Record<BadgeShape, readonly (readonly [number, number])[]> = { chevron: CHEVRON, star: STAR, thorn: THORN, eye: EYE, pupil: PUPIL };

/** One piece of a badge: a shape at an offset (in badge widths, y up) and its colour; `edge` pieces get a dark outline. */
export interface BadgePiece {
  shape: BadgeShape;
  x: number;
  y: number;
  color: number;
  edge: boolean;
}

/**
 * The pieces a badge is drawn from, both views (VET-3): chevrons stacked upward, thorns side by side, a star, or an eye
 * with its dark slit pupil on top. Empty for no badge.
 */
export function badgePieces(b: RankBadge): BadgePiece[] {
  if (!b) return [];
  switch (b.kind) {
    case 'chevrons':
      return Array.from({ length: b.count }, (_, i) => ({ shape: 'chevron' as const, x: 0, y: i * CHEVRON_STEP, color: b.color, edge: true }));
    case 'thorns':
      return Array.from({ length: b.count }, (_, i) => ({ shape: 'thorn' as const, x: (i - (b.count - 1) / 2) * THORN_STEP, y: 0, color: b.color, edge: true }));
    case 'star':
      return [{ shape: 'star', x: 0, y: 0, color: b.color, edge: true }];
    case 'eye':
      return [
        { shape: 'eye', x: 0, y: 0, color: b.color, edge: true },
        { shape: 'pupil', x: 0, y: 0, color: BADGE_EDGE, edge: false },
      ];
  }
}
