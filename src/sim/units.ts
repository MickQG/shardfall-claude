import { unitDef } from '../data/defs';
import type { Unit } from './state';

/** Veterancy: experience (damage dealt) needed for each rank, as multiples of the unit's cost. */
export const RANK_XP = [1, 3, 6] as const;
export const MAX_RANK = RANK_XP.length;
/** Percent added to damage and maximum hit points per rank. */
export const RANK_BONUS = 10;
/** Top-rank units heal this percent of their maximum hit points per second out of combat. */
export const ELITE_REPAIR = 1;

/** Rank (0..MAX_RANK) reached with `xp` damage dealt by a unit of `kind`. */
export function rankFor(kind: string, xp: number): number {
  const cost = unitDef(kind).cost;
  let r = 0;
  while (r < MAX_RANK && xp >= (RANK_XP[r] as number) * cost) r++;
  return r;
}

/** Maximum hit points of a unit of `kind` at `rank`. */
export const maxHpOf = (kind: string, rank: number): number => Math.floor((unitDef(kind).hp * (100 + RANK_BONUS * rank)) / 100);

/** Squad figures still standing: one per equal share of maximum health, at least one while alive; 1 for non-squad units. */
export function squadAlive(kind: string, hp: number, maxHp: number): number {
  const size = unitDef(kind).squad ?? 1;
  if (size <= 1) return 1;
  return Math.max(1, Math.min(size, Math.ceil((size * Math.max(0, hp)) / maxHp)));
}

/** Damage per shot of a unit: base damage scaled by squad figures left and by rank. */
export function unitDamage(kind: string, hp: number, rank: number): number {
  const d = unitDef(kind);
  const base = d.weapon?.damage ?? 0;
  const size = d.squad ?? 1;
  const alive = squadAlive(kind, hp, maxHpOf(kind, rank));
  return Math.max(1, Math.floor((base * alive * (100 + RANK_BONUS * rank)) / (size * 100)));
}

/** Damage of one missile of a unit's second weapon: base scaled by rank (HERO-7). */
export function missileDamage(kind: string, rank: number): number {
  return Math.max(1, Math.floor(((unitDef(kind).weapon2?.damage ?? 0) * (100 + RANK_BONUS * rank)) / 100));
}

/** Credit `u` with `dealt` damage to an enemy as experience (VET-1), ranking it up with its hit points scaled to match. */
export function gainXp(u: Unit, dealt: number): void {
  if (dealt <= 0) return;
  u.xp += dealt;
  const r = rankFor(u.kind, u.xp);
  if (r > u.rank) {
    u.hp = Math.floor((u.hp * maxHpOf(u.kind, r)) / maxHpOf(u.kind, u.rank));
    u.rank = r;
  }
}
