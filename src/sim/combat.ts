import { buildingDef, DAMAGE_PCT, unitDef, type ArmorType, type WeaponDef } from '../data/defs';
import { FP, isqrt, tileOf } from './fixed';
import { VISIBLE } from './fog';
import { clearOrder, orderMove } from './movement';
import { isLowPower } from './economy';
import { removeBuilding } from './production';
import type { Building, State, Unit } from './state';
import { ELITE_REPAIR, MAX_RANK, maxHpOf, rankFor, unitDamage } from './units';

type Entity = Unit | Building;
const isBuilding = (e: Entity): e is Building => 'tx' in e;

/** Ticks between launching a superweapon and its impact. */
export const SUPERWEAPON_DELAY = 60;
/** Ticks without damage before regeneration starts. */
export const REGEN_DELAY = 100;

const rangeFp = (w: WeaponDef): number => Math.round(w.range * FP);

function pos(e: Entity): { x: number; y: number } {
  if (!isBuilding(e)) return { x: e.x, y: e.y };
  const d = buildingDef(e.kind);
  return { x: (e.tx + d.w / 2) * FP, y: (e.ty + d.h / 2) * FP };
}

const armorOf = (e: Entity): ArmorType => (isBuilding(e) ? 'structure' : unitDef(e.kind).armor);

/** Distance from a point to the edge of an entity, in fixed-point units (0 if inside). */
function distTo(ax: number, ay: number, e: Entity): number {
  if (isBuilding(e)) {
    const d = buildingDef(e.kind);
    const dx = Math.max(e.tx * FP - ax, ax - (e.tx + d.w) * FP, 0);
    const dy = Math.max(e.ty * FP - ay, ay - (e.ty + d.h) * FP, 0);
    return isqrt(dx * dx + dy * dy);
  }
  const dx = e.x - ax;
  const dy = e.y - ay;
  return Math.max(0, isqrt(dx * dx + dy * dy) - unitDef(e.kind).radius);
}

export function canHit(w: WeaponDef, e: Entity): boolean {
  return armorOf(e) === 'air' ? w.antiAir : w.antiGround;
}

/** Base damage scaled by the damage-type/armor matrix; at least 1 unless the matchup is immune. */
export function damageAgainst(w: Pick<WeaponDef, 'damage' | 'type'>, armor: ArmorType): number {
  const pct = DAMAGE_PCT[w.type][armor];
  if (pct === 0) return 0;
  return Math.max(1, Math.floor((w.damage * pct) / 100));
}

export function visibleTo(s: State, owner: number, e: Entity): boolean {
  const fog = s.fog[owner];
  if (!fog) return false;
  const W = s.grid.width;
  if (isBuilding(e)) {
    const d = buildingDef(e.kind);
    for (let y = e.ty; y < e.ty + d.h; y++) for (let x = e.tx; x < e.tx + d.w; x++) if ((fog[y * W + x] as number) & VISIBLE) return true;
    return false;
  }
  return ((fog[tileOf(e.y) * W + tileOf(e.x)] as number) & VISIBLE) !== 0;
}

/**
 * Deal `amount` damage to `e`. `attackerId` is who an idle victim may turn on; `credit` is the unit (if any) that earns the
 * damage as veterancy experience, ranking up with its maximum hit points scaled by the same share.
 */
function hurt(s: State, e: Entity, amount: number, attackerId: number, credit?: Entity): void {
  if (amount <= 0) return;
  const dealt = Math.min(amount, Math.max(0, e.hp));
  e.hp -= amount;
  if (credit && !isBuilding(credit) && credit.owner !== e.owner && dealt > 0) {
    credit.xp += dealt;
    const r = rankFor(credit.kind, credit.xp);
    if (r > credit.rank) {
      credit.hp = Math.floor((credit.hp * maxHpOf(credit.kind, r)) / maxHpOf(credit.kind, credit.rank));
      credit.rank = r;
    }
  }
  if (isBuilding(e)) return;
  e.sinceHurt = 0;
  // Retaliate if idle.
  if (e.mode === 'idle' && e.target < 0 && attackerId >= 0 && unitDef(e.kind).weapon) e.target = attackerId;
}

/** Fire `w` at `t`. A unit shooter fires its squad- and rank-adjusted damage and is credited with what it deals. */
function fire(s: State, shooter: { x: number; y: number; owner: number; id: number }, w: WeaponDef, t: Entity, unit?: Unit): void {
  const tp = pos(t);
  const damage = unit ? unitDamage(unit.kind, unit.hp, unit.rank) : w.damage;
  s.events.push({ t: 'shot', x: shooter.x, y: shooter.y, tx: tp.x, ty: tp.y, weapon: w.type, owner: shooter.owner, air: armorOf(t) === 'air', flight: w.flight ?? 0, src: shooter.id });
  if ((w.flight ?? 0) > 0) {
    s.projectiles.push({ hit: s.tick + (w.flight as number), x: tp.x, y: tp.y, targetId: t.id, owner: shooter.owner, damage, type: w.type, splash: w.splash ?? 0, air: armorOf(t) === 'air', shooter: unit ? unit.id : -1 });
  } else {
    hurt(s, t, damageAgainst({ damage, type: w.type }, armorOf(t)), shooter.id, unit);
  }
}

function land(s: State, p: { x: number; y: number; targetId: number; owner: number; damage: number; type: string; splash: number; shooter: number }, byId: Map<number, Entity>): void {
  const credit = p.shooter >= 0 ? byId.get(p.shooter) : undefined;
  const w = { damage: p.damage, type: p.type as WeaponDef['type'] };
  if (p.splash > 0) {
    s.events.push({ t: 'boom', x: p.x, y: p.y, r: p.splash });
    const R = Math.round(p.splash * FP);
    for (const e of byId.values()) {
      if (e.owner === p.owner || armorOf(e) === 'air') continue;
      const d = distTo(p.x, p.y, e);
      if (d > R) continue;
      const fall = 100 - Math.floor((50 * d) / R);
      hurt(s, e, Math.max(1, Math.floor((damageAgainst(w, armorOf(e)) * fall) / 100)), -1, credit);
    }
    return;
  }
  const t = byId.get(p.targetId);
  if (t) hurt(s, t, damageAgainst(w, armorOf(t)), -1, credit);
}

/** Best visible enemy this weapon can hit within `reach` (fixed-point): armed targets first, then nearest. */
function acquire(s: State, owner: number, x: number, y: number, w: WeaponDef, reach: number): number {
  let best = -1;
  let bs = Infinity;
  const consider = (e: Entity, armed: boolean): void => {
    if (e.owner === owner || !canHit(w, e)) return;
    const d = distTo(x, y, e);
    if (d > reach || !visibleTo(s, owner, e)) return;
    const score = d + (armed ? 0 : isBuilding(e) ? 6 * FP : 3 * FP);
    if (score < bs || (score === bs && e.id < best)) {
      bs = score;
      best = e.id;
    }
  };
  for (const u of s.units) consider(u, !!unitDef(u.kind).weapon);
  for (const b of s.buildings) consider(b, !!buildingDef(b.kind).weapon);
  return best;
}

function chase(s: State, u: Unit, t: Entity): void {
  const p = pos(t);
  const tx = Math.max(0, Math.min(s.grid.width - 1, tileOf(p.x)));
  const ty = Math.max(0, Math.min(s.grid.height - 1, tileOf(p.y)));
  orderMove(s, u, ty * s.grid.width + tx);
}

function tickUnit(s: State, u: Unit, byId: Map<number, Entity>): void {
  const def = unitDef(u.kind);
  if (u.cooldown > 0) u.cooldown--;
  u.sinceHurt = Math.min(u.sinceHurt + 1, 100000);
  if (u.mode === 'move' && u.path.length === 0 && !u.waiting) u.mode = 'idle';
  const w = def.weapon;
  if (!w || u.mode === 'move') {
    if (u.mode === 'move') u.target = -1;
    return;
  }

  let t = u.target >= 0 ? byId.get(u.target) : undefined;
  if (t && (t.owner === u.owner || !canHit(w, t) || !visibleTo(s, u.owner, t))) {
    t = undefined;
    u.target = -1;
  }
  if (!t && u.target >= 0) u.target = -1;
  if (!t && u.mode === 'attack') {
    u.mode = 'idle';
    clearOrder(u);
  }

  if (!t && (u.mode === 'idle' || u.mode === 'amove') && (s.tick + u.id) % 5 === 0) {
    const bonus = u.mode === 'amove' ? 4 : 2;
    const id = acquire(s, u.owner, u.x, u.y, w, rangeFp(w) + bonus * FP);
    if (id >= 0) {
      u.target = id;
      t = byId.get(id);
    }
  }

  if (!t) {
    if (u.mode === 'amove' && u.path.length === 0 && !u.waiting) {
      const goalX = u.amove % s.grid.width;
      const goalY = Math.floor(u.amove / s.grid.width);
      if (Math.abs(tileOf(u.x) - goalX) + Math.abs(tileOf(u.y) - goalY) <= 1) {
        u.mode = 'idle';
        u.amove = -1;
      } else orderMove(s, u, u.amove);
    }
    return;
  }

  const d = distTo(u.x, u.y, t);
  if (d <= rangeFp(w)) {
    if (u.path.length > 0 || u.waiting) {
      u.path = [];
      u.waiting = false;
    }
    if (u.cooldown === 0) {
      fire(s, { x: u.x, y: u.y, owner: u.owner, id: u.id }, w, t, u);
      u.cooldown = w.cooldown;
    }
  } else if (u.mode === 'idle' && d > rangeFp(w) + 6 * FP) {
    u.target = -1;
    clearOrder(u);
  } else if ((s.tick + u.id) % 10 === 0 || (u.path.length === 0 && !u.waiting)) {
    chase(s, u, t);
  }
}

function tickBuilding(s: State, b: Building, byId: Map<number, Entity>): void {
  const d = buildingDef(b.kind);
  const low = isLowPower(s, b.owner);
  if (d.superweapon && !low && b.charge < d.superweapon.charge) b.charge++;
  const w = d.weapon;
  if (!w) return;
  if (b.cooldown > 0) b.cooldown--;
  if (d.needsPower && low) return;
  let t = b.target >= 0 ? byId.get(b.target) : undefined;
  const c = pos(b);
  if (t && (t.owner === b.owner || !canHit(w, t) || !visibleTo(s, b.owner, t) || distTo(c.x, c.y, t) > rangeFp(w))) {
    t = undefined;
    b.target = -1;
  }
  if (!t && (s.tick + b.id) % 5 === 0) {
    const id = acquire(s, b.owner, c.x, c.y, w, rangeFp(w));
    if (id >= 0) {
      b.target = id;
      t = byId.get(id);
    }
  }
  if (t && b.cooldown === 0) {
    fire(s, { x: c.x, y: c.y, owner: b.owner, id: b.id }, w, t);
    b.cooldown = w.cooldown;
  }
}

export function fireSuperweapon(s: State, player: number, buildingId: number, x: number, y: number): void {
  const b = s.buildings.find((q) => q.id === buildingId);
  if (!b || b.owner !== player) return;
  const sw = buildingDef(b.kind).superweapon;
  if (!sw || b.charge < sw.charge || isLowPower(s, player)) return;
  b.charge = 0;
  const c = pos(b);
  s.events.push({ t: 'launch', x: c.x, y: c.y, tx: x, ty: y, owner: player, kind: b.kind, delay: SUPERWEAPON_DELAY });
  s.strikes.push({ kind: b.kind, hit: s.tick + SUPERWEAPON_DELAY, x, y, owner: player, damage: sw.damage, radius: Math.round(sw.radius * FP) });
}

/** One tick of combat: targeting, firing, projectiles, superweapons, regeneration, deaths and the win check. */
export function tickCombat(s: State): void {
  const byId = new Map<number, Entity>();
  for (const u of s.units) byId.set(u.id, u);
  for (const b of s.buildings) byId.set(b.id, b);

  for (const u of s.units) tickUnit(s, u, byId);
  for (const b of s.buildings) tickBuilding(s, b, byId);

  if (s.projectiles.length > 0) {
    const due = s.projectiles.filter((p) => p.hit <= s.tick + 0);
    s.projectiles = s.projectiles.filter((p) => p.hit > s.tick);
    for (const p of due) land(s, p, byId);
  }
  if (s.strikes.length > 0) {
    const due = s.strikes.filter((k) => k.hit <= s.tick);
    s.strikes = s.strikes.filter((k) => k.hit > s.tick);
    for (const k of due) {
      s.events.push({ t: 'strike', x: k.x, y: k.y, owner: k.owner, kind: k.kind, r: k.radius / FP });
      for (const e of byId.values()) {
        const d = distTo(k.x, k.y, e);
        if (d > k.radius) continue;
        hurt(s, e, Math.max(1, Math.floor((k.damage * (100 - Math.floor((70 * d) / k.radius))) / 100)), -1);
      }
    }
  }

  // Deaths.
  const deadUnits = s.units.filter((u) => u.hp <= 0);
  if (deadUnits.length > 0) {
    for (const u of deadUnits) {
      s.events.push({ t: 'die', x: u.x, y: u.y, big: unitDef(u.kind).armor === 'heavy', owner: u.owner, id: u.id, kind: u.kind });
      const p = s.players[u.owner];
      if (p) p.stats.unitsLost++;
    }
    s.units = s.units.filter((u) => u.hp > 0);
  }
  for (const b of s.buildings.filter((q) => q.hp <= 0)) {
    const c = pos(b);
    s.events.push({ t: 'die', x: c.x, y: c.y, big: true, owner: b.owner, id: b.id, kind: b.kind });
    const p = s.players[b.owner];
    if (p) p.stats.buildingsLost++;
    removeBuilding(s, b);
  }

  // Regeneration.
  if (s.tick % 20 === 0) {
    for (const u of s.units) {
      const d = unitDef(u.kind);
      const max = maxHpOf(u.kind, u.rank);
      // Top-rank units repair themselves; regenerating kinds keep the faster of the two.
      const heal = Math.max(d.regen ?? 0, u.rank >= MAX_RANK ? Math.ceil((max * ELITE_REPAIR) / 100) : 0);
      if (heal > 0 && u.sinceHurt >= REGEN_DELAY && u.hp < max) u.hp = Math.min(max, u.hp + heal);
    }
  }

  checkWin(s);
}

function checkWin(s: State): void {
  if (s.over || (s.cfg.buildings?.length ?? 0) === 0) return;
  const alive = s.players.map((_, i) => s.buildings.some((b) => b.owner === i));
  const n = alive.filter(Boolean).length;
  if (n <= 1 && s.players.length >= 2) {
    s.over = true;
    s.winner = n === 1 ? alive.indexOf(true) : null;
  }
}
