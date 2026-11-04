import { unitDef } from '../data/defs';
import { isqrt } from './fixed';
import type { State, Unit } from './state';
import { gainXp } from './units';

/** Whether `u` is a heavy vehicle that crushes infantry (BAL-1). */
export const isCrusher = (u: Unit): boolean => unitDef(u.kind).crusher === true;

/** Whether `v` is an infantry squad that a crusher of another owner flattens (BAL-1). */
export const crushable = (crusher: Unit, v: Unit): boolean => v.owner !== crusher.owner && (unitDef(v.kind).squad ?? 1) > 1;

/**
 * Crushing (BAL-1): a crusher that moved this tick flattens every enemy infantry squad whose centre lies inside its body.
 * The whole squad dies at once, and the crusher earns its remaining hit points as veterancy experience. `moved` holds
 * the crushers that travelled this tick (standing still, firing or turning in place crushes nothing).
 */
export function crush(s: State, moved: ReadonlySet<number>): void {
  if (moved.size === 0) return;
  const dead = new Set<number>();
  for (const c of s.units) {
    if (!moved.has(c.id) || c.hp <= 0) continue;
    const r = unitDef(c.kind).radius;
    for (const v of s.units) {
      if (dead.has(v.id) || v.hp <= 0 || !crushable(c, v)) continue;
      const dx = v.x - c.x;
      const dy = v.y - c.y;
      if (Math.abs(dx) >= r || Math.abs(dy) >= r || isqrt(dx * dx + dy * dy) >= r) continue;
      gainXp(c, v.hp);
      v.hp = 0;
      dead.add(v.id);
      s.events.push({ t: 'die', x: v.x, y: v.y, big: false, owner: v.owner, id: v.id, kind: v.kind, crushed: true });
      const p = s.players[v.owner];
      if (p) p.stats.unitsLost++;
    }
  }
  if (dead.size > 0) s.units = s.units.filter((u) => !dead.has(u.id));
}
