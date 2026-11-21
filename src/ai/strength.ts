import { buildingDef, UNIT_DEFS, unitDef } from '../data/defs';
import { FP, maxHpOf, RANK_BONUS } from '../sim';

/**
 * Judging strength (AI-35, AI-36): pure functions of what the AI has seen. A unit's power is its cost scaled by its health
 * as a share of its real maximum health (veterancy included); the enemy force near a group counts only what was seen
 * lately, plus defences.
 */

/** Enemy units count toward the force near a group only when seen within this many ticks (AI-35: 10 game seconds). */
export const FRESH_SIGHT = 200;
/** Defence buildings count at this multiple of their cost (AI-35). */
export const DEFENCE_WEIGHT = 1.5;
/** A group is overwhelmed when the enemy power within OVERWHELM_R tiles of its centre is at least OVERWHELM_RATIO times its own (AI-36). */
export const OVERWHELM_R = 11;
export const OVERWHELM_RATIO = 1.5;

/** Distance (tiles) from a point to the nearest part of a building's footprint. */
export const edgeDist = (b: { tx: number; ty: number; kind: string }, x: number, y: number): number => {
  const d = buildingDef(b.kind);
  const dx = Math.max(b.tx - x, 0, x - (b.tx + d.w));
  const dy = Math.max(b.ty - y, 0, y - (b.ty + d.h));
  return Math.hypot(dx, dy);
};

/**
 * A unit's power (AI-35): its cost scaled by its health over its real maximum health (veterancy included), and by its
 * rank: each rank adds RANK_BONUS percent to both its maximum health and its damage (VET-2), so a ranked unit at full
 * health counts for (1 + rank bonus) squared times its cost.
 */
export function unitPower(kind: string, hp: number, rank = 0): number {
  const d = unitDef(kind);
  const vet = (100 + RANK_BONUS * rank) / 100;
  return (d.cost * vet * vet * Math.max(0, hp)) / maxHpOf(kind, rank);
}

/** The power of a set of units (AI-35). */
export function armyPower(units: Iterable<{ kind: string; hp: number; rank?: number }>): number {
  let p = 0;
  for (const u of units) p += unitPower(u.kind, u.hp, u.rank ?? 0);
  return p;
}

/** A sighting of an enemy unit as the AI remembers it: where (fixed point), when, and its health and rank when known. */
export interface Sighting {
  kind: string;
  x: number;
  y: number;
  t: number;
  hp?: number;
  rank?: number;
}

/**
 * The enemy force near a point (AI-35): armed enemy units (haulers apart) seen within FRESH_SIGHT ticks and within `r`
 * tiles, each at its power when last seen (its full cost if its health is unknown), plus armed enemy buildings within
 * `r` tiles at DEFENCE_WEIGHT times their cost.
 */
export function freshEnemyPower(sightings: Iterable<Sighting>, enemyBuildings: Iterable<{ tx: number; ty: number; kind: string }>, tick: number, x: number, y: number, r: number): number {
  let p = 0;
  for (const e of sightings) {
    const d = UNIT_DEFS[e.kind];
    if (!d?.weapon || d.capacity !== undefined || tick - e.t > FRESH_SIGHT) continue;
    if (Math.hypot(e.x / FP - x, e.y / FP - y) > r) continue;
    p += e.hp === undefined ? d.cost : unitPower(e.kind, e.hp, e.rank ?? 0);
  }
  return p + defencePower(enemyBuildings, x, y, r);
}

/** Armed buildings within `r` tiles of a point, at DEFENCE_WEIGHT times their cost (AI-35, AI-36). */
export function defencePower(buildings: Iterable<{ tx: number; ty: number; kind: string }>, x: number, y: number, r: number): number {
  let p = 0;
  for (const b of buildings) {
    const d = buildingDef(b.kind);
    if (d.weapon && edgeDist(b, x, y) <= r) p += d.cost * DEFENCE_WEIGHT;
  }
  return p;
}

/** Overwhelmed (AI-36): the enemy power near a group is at least OVERWHELM_RATIO times the group's power plus its own defences there. */
export function isOverwhelmed(own: number, ownDefences: number, enemy: number): boolean {
  return enemy > 0 && enemy >= OVERWHELM_RATIO * (own + ownDefences);
}

/** Whether a group can outrun its chasers (AI-34, AI-37): its slowest unit is faster than the fastest of them. */
export function canOutrun(group: Iterable<{ kind: string }>, chasers: Iterable<{ kind: string }>): boolean {
  let slow = Infinity;
  let fast = 0;
  for (const u of group) slow = Math.min(slow, unitDef(u.kind).speed);
  for (const u of chasers) fast = Math.max(fast, unitDef(u.kind).speed);
  return slow !== Infinity && slow > fast;
}
