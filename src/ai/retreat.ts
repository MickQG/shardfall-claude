/**
 * Retreat (AI-37): where an overwhelmed group falls back to, and the steps of a fighting retreat. Pure; positions in tiles.
 */

/** A fighting retreat falls back in hops of RETREAT_HOP tiles, holding its concave RETREAT_HOLD ticks between them (AI-37). */
export const RETREAT_HOP = 3;
export const RETREAT_HOLD = 20;
/** A hop that has not arrived within this many ticks is over anyway (a unit stuck behind others must not stall the rest). */
export const RETREAT_HOP_MAX = 60;
/** A fighting retreat ends when no enemy has been within its units' reach + RETREAT_CLEAR_R tiles for RETREAT_CLEAR ticks (AI-37). */
export const RETREAT_CLEAR = 60;
export const RETREAT_CLEAR_R = 2;
/** A retreat has reached friendly strength once its centre is within this many tiles of its fallback point. */
export const RETREAT_ARRIVED = 3;
/** A fallback point must lie at least this far (tiles) from the group, and farther from the enemy than the group is (AI-34, AI-37). */
export const FALLBACK_AWAY = 6;

export interface Point {
  x: number;
  y: number;
}

export type FallbackKind = 'staging' | 'defence' | 'base';

/**
 * The nearest friendly strength (AI-37), in this order: the staging point when reinforcements or Menders are gathering
 * there (`staging` non-null), the nearest of its defence buildings' spots (`defences`), the base (`base`). Each must lie at
 * least FALLBACK_AWAY tiles from the group and farther from the enemy than the group is; the base is taken anyway when
 * `lastResort`, else null when none qualifies.
 */
export function chooseFallback(
  group: Point,
  enemy: Point | null,
  o: { staging: Point | null; defences: readonly Point[]; base: Point; lastResort?: boolean },
): { at: Point; kind: FallbackKind } | null {
  const ok = (p: Point): boolean => Math.hypot(p.x - group.x, p.y - group.y) >= FALLBACK_AWAY && (enemy === null || Math.hypot(p.x - enemy.x, p.y - enemy.y) > Math.hypot(group.x - enemy.x, group.y - enemy.y));
  if (o.staging && ok(o.staging)) return { at: o.staging, kind: 'staging' };
  let best: Point | null = null;
  let bd = Infinity;
  for (const d of o.defences) {
    const dd = Math.hypot(d.x - group.x, d.y - group.y);
    if (ok(d) && dd < bd) {
      bd = dd;
      best = d;
    }
  }
  if (best) return { at: best, kind: 'defence' };
  if (ok(o.base) || o.lastResort) return { at: o.base, kind: 'base' };
  return null;
}

/** A point `step` tiles from `from` toward `to`, or `to` itself when nearer. */
export function toward(from: Point, to: Point, step: number): Point {
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (d <= step) return { ...to };
  return { x: from.x + ((to.x - from.x) * step) / d, y: from.y + ((to.y - from.y) * step) / d };
}

/** A fighting retreat's state (AI-37): hopping toward its fallback point or holding its concave, since when. */
export interface FightingRetreat {
  phase: 'hop' | 'hold';
  since: number;
  hop: Point;
  /** The last tick an enemy was within its units' reach + RETREAT_CLEAR_R tiles. */
  lastNear: number;
}

/**
 * One step of a fighting retreat (AI-37): what to do now. 'done' once its centre is within RETREAT_ARRIVED tiles of the
 * fallback point or no enemy has been near for RETREAT_CLEAR ticks; 'hop' to a point RETREAT_HOP tiles nearer the
 * fallback point once a hold is over (or at the start); 'hold' (form the concave) once a hop has arrived or run out of
 * time (with no enemy in reach it hops on at once, 2 * RETREAT_HOP tiles); null to carry on with the current phase. Updates the state.
 */
export function retreatStep(s: FightingRetreat, tick: number, centre: Point, to: Point, enemyNear: boolean, hopOn = true): { act: 'hop'; to: Point } | { act: 'hold' } | { act: 'done' } | null {
  if (enemyNear) s.lastNear = tick;
  if (Math.hypot(centre.x - to.x, centre.y - to.y) <= RETREAT_ARRIVED || tick - s.lastNear >= RETREAT_CLEAR) return { act: 'done' };
  if (s.phase === 'hop') {
    if (Math.hypot(centre.x - s.hop.x, centre.y - s.hop.y) <= 1.5 || tick - s.since >= RETREAT_HOP_MAX) {
      // No pursuer in reach: no point holding to fire, it hops on, twice as far.
      if (hopOn && !enemyNear) {
        s.since = tick;
        s.hop = toward(centre, to, 2 * RETREAT_HOP);
        return { act: 'hop', to: s.hop };
      }
      s.phase = 'hold';
      s.since = tick;
      return { act: 'hold' };
    }
    return null;
  }
  if (tick - s.since < RETREAT_HOLD) return null;
  s.phase = 'hop';
  s.since = tick;
  s.hop = toward(centre, to, RETREAT_HOP);
  return { act: 'hop', to: s.hop };
}
