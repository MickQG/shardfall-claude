import { unitDef } from '../data/defs';
import { FP, isqrt, tileOf } from './fixed';
import { clearOrder, orderMove } from './movement';
import { isBlocked } from './path';
import type { State, Unit } from './state';
import { maxHpOf } from './units';

/**
 * The Field Mender's rules (CMB-15..17, SQD-3..6): a repair vehicle that mends one damaged friendly vehicle at a time and
 * itself, and carries one infantry squad. A passenger is taken out of `State.units` while inside, so nothing can target,
 * hit, splash, crush or push it; its carrier holds it in `cargo`, and it comes back with the same id, health and rank.
 * Integer arithmetic and a fixed iteration order only.
 */

/** Ticks between repairs: the hit points a second are applied once a second (CMB-16, CMB-17). */
export const REPAIR_EVERY = 20;
/** Ticks between choices of what to mend: the most damaged in reach is looked for again this often (CMB-16). */
export const MEND_PICK = 5;
/** How far beyond touching a boarding squad may be from its carrier to climb in, fixed-point (SQD-3). */
export const BOARD_SLACK = FP / 2;

/** Whether `kind` mends vehicles (CMB-16). */
export const isMender = (kind: string): boolean => unitDef(kind).repair !== undefined;

/** Whether `kind` is a vehicle a mender repairs (CMB-16): any ground unit that is not an infantry squad, heroes included. */
export function isVehicle(kind: string): boolean {
  const d = unitDef(kind);
  return (d.squad ?? 1) <= 1 && !d.air;
}

/** Whether a carrier of kind `carrier` takes a squad of kind `rider` aboard (SQD-3): only the kinds it lists, never a hero. */
export function mayCarry(carrier: string, rider: string): boolean {
  const c = unitDef(carrier).carries;
  return !!c && c.includes(rider) && !unitDef(rider).hero;
}

const edgeDist = (u: Unit, v: Unit): number => {
  const dx = v.x - u.x;
  const dy = v.y - u.y;
  return Math.max(0, isqrt(dx * dx + dy * dy) - unitDef(v.kind).radius);
};

/**
 * What mender `u` repairs (CMB-16): of its owner's damaged vehicles (not itself) within its repair range of its centre,
 * measured to their edge, the one with the smallest share of its maximum health left; ties go to the most hit points
 * missing, then the lowest id. Undefined when none is in reach.
 */
export function mendTarget(s: State, u: Unit): Unit | undefined {
  const r = unitDef(u.kind).repair;
  if (!r) return undefined;
  const reach = Math.round(r.range * FP);
  let best: Unit | undefined;
  let bMax = 1;
  for (const v of s.units) {
    if (v === u || v.owner !== u.owner || v.hp <= 0 || !isVehicle(v.kind)) continue;
    const max = maxHpOf(v.kind, v.rank);
    if (v.hp >= max || edgeDist(u, v) > reach) continue;
    if (best) {
      // Compare hp / max as cross products, in integers.
      const a = v.hp * bMax;
      const b = best.hp * max;
      if (a > b) continue;
      if (a === b && (max - v.hp < bMax - best.hp || (max - v.hp === bMax - best.hp && v.id > best.id))) continue;
    }
    best = v;
    bMax = max;
  }
  return best;
}

/** Board order (SQD-3): the player's listed squads that `carrier` may take head for it; nothing happens if it is full. */
export function boardUnits(s: State, player: number, ids: readonly number[], carrierId: number): void {
  const carrier = s.units.find((u) => u.id === carrierId && u.owner === player && u.hp > 0);
  if (!carrier || carrier.cargo) return;
  for (const u of s.units) {
    if (u.owner !== player || !ids.includes(u.id) || !mayCarry(carrier.kind, u.kind)) continue;
    u.auto = false;
    u.target = -1;
    u.amove = -1;
    u.mode = 'move';
    u.ride = carrier.id;
    orderMove(s, u, tileOf(carrier.y) * s.grid.width + tileOf(carrier.x), true);
  }
}

/** Unload order (SQD-6): each of the player's listed carriers lets its passenger out beside it. */
export function unloadUnits(s: State, player: number, ids: readonly number[]): void {
  for (const c of s.units.filter((u) => u.owner === player && ids.includes(u.id) && u.cargo)) unload(s, c);
}

/**
 * Let a carrier's squad out (SQD-6): it stands just beside the carrier, on the first open tile of eight directions
 * around it (in a fixed order), or where the carrier stands if all are blocked; it is idle, with no order.
 */
export function unload(s: State, c: Unit): void {
  const r = c.cargo;
  if (!r) return;
  c.cargo = null;
  const off = unitDef(c.kind).radius + unitDef(r.kind).radius;
  const g = s.grid;
  let x = c.x;
  let y = c.y;
  const dirs: [number, number][] = [[-1, 0], [0, 1], [0, -1], [1, 0], [-1, 1], [-1, -1], [1, 1], [1, -1]];
  for (const [dx, dy] of dirs) {
    const px = c.x + dx * off;
    const py = c.y + dy * off;
    const tx = tileOf(px);
    const ty = tileOf(py);
    if (tx < 0 || ty < 0 || tx >= g.width || ty >= g.height || isBlocked(g, tx, ty)) continue;
    x = px;
    y = py;
    break;
  }
  r.x = x;
  r.y = y;
  clearOrder(r);
  r.queued = false;
  r.urgent = false;
  r.mode = 'idle';
  r.target = -1;
  r.amove = -1;
  r.ride = -1;
  s.units.push(r);
  s.events.push({ t: 'board', x: c.x, y: c.y, owner: c.owner, id: c.id, rider: r.id, on: false });
}

/**
 * A carrier was destroyed (SQD-5): its passenger dies with it, as a loss of its owner. Called wherever a unit is removed
 * for good (combat deaths, crushing).
 */
export function loseCargo(s: State, c: Unit): void {
  const r = c.cargo;
  if (!r) return;
  c.cargo = null;
  r.hp = 0;
  s.events.push({ t: 'die', x: c.x, y: c.y, big: false, owner: r.owner, id: r.id, kind: r.kind });
  const p = s.players[r.owner];
  if (p) p.stats.unitsLost++;
}

/** Take squad `u` into carrier `c` (SQD-3): out of the unit list and every route queue, its orders dropped. */
function climbIn(s: State, c: Unit, u: Unit): void {
  clearOrder(u);
  const drop = (q: number[]): void => {
    const i = q.indexOf(u.id);
    if (i >= 0) q.splice(i, 1);
  };
  drop(s.orderQueue);
  drop(s.pathQueue);
  u.queued = false;
  u.urgent = false;
  u.ride = -1;
  u.target = -1;
  u.mode = 'idle';
  u.x = c.x;
  u.y = c.y;
  c.cargo = u;
  s.events.push({ t: 'board', x: c.x, y: c.y, owner: c.owner, id: c.id, rider: u.id, on: true });
}

/**
 * One tick of carriers and menders, after combat: boarding squads walk to their carrier and the first to reach it climbs
 * in (SQD-3), passengers ride along (SQD-4), and menders pick what to mend and, once a second, mend it and themselves
 * (CMB-16, CMB-17).
 */
export function tickCarriers(s: State): void {
  const byId = new Map<number, Unit>();
  for (const u of s.units) byId.set(u.id, u);
  const find = (id: number): Unit | undefined => byId.get(id);
  const boarded = new Set<number>();
  for (const u of s.units) {
    if (u.ride >= 0) {
      const c = find(u.ride);
      if (!c || c.owner !== u.owner || c.hp <= 0 || c.cargo || !mayCarry(c.kind, u.kind)) {
        // Gone or taken: the squad stops where it is (SQD-3).
        u.ride = -1;
        u.mode = 'idle';
        clearOrder(u);
      } else {
        const dx = c.x - u.x;
        const dy = c.y - u.y;
        const reach = unitDef(c.kind).radius + unitDef(u.kind).radius + BOARD_SLACK;
        if (Math.abs(dx) <= reach && Math.abs(dy) <= reach && isqrt(dx * dx + dy * dy) <= reach) {
          climbIn(s, c, u);
          boarded.add(u.id);
        } else {
          u.mode = 'move';
          const goal = tileOf(c.y) * s.grid.width + tileOf(c.x);
          if ((u.path.length === 0 && !u.waiting) || ((s.tick + u.id) % 10 === 0 && u.goal !== goal)) orderMove(s, u, goal);
        }
      }
    }
    if (u.cargo) {
      // The passenger rides along: where it is drawn from and fires from (SQD-4).
      u.cargo.x = u.x;
      u.cargo.y = u.y;
    }
  }
  if (boarded.size > 0) s.units = s.units.filter((u) => !boarded.has(u.id));

  for (const u of s.units) {
    const r = unitDef(u.kind).repair;
    if (!r) continue;
    const cur = u.mend >= 0 ? find(u.mend) : undefined;
    const valid = cur && cur.hp > 0 && cur.owner === u.owner && cur.hp < maxHpOf(cur.kind, cur.rank) && edgeDist(u, cur) <= Math.round(r.range * FP);
    if (!valid || (s.tick + u.id) % MEND_PICK === 0) u.mend = mendTarget(s, u)?.id ?? -1;
    if (s.tick % REPAIR_EVERY !== 0) continue;
    const t = u.mend >= 0 ? find(u.mend) : undefined;
    if (t) {
      t.hp = Math.min(maxHpOf(t.kind, t.rank), t.hp + r.rate);
      s.events.push({ t: 'mend', x: t.x, y: t.y, owner: u.owner, id: u.id, to: t.id });
      if (t.hp >= maxHpOf(t.kind, t.rank)) u.mend = -1;
    }
    // It mends itself at all times, also while it mends another (CMB-17).
    const max = maxHpOf(u.kind, u.rank);
    if (u.hp < max) u.hp = Math.min(max, u.hp + r.self);
  }
}
