import { unitDef } from '../data/defs';
import { FP } from '../sim';
import { armyPower } from './strength';

/**
 * Harassment (AI-39, AI-40): telling a harasser from a real fight, and who may chase it. Pure, but for KiteWatch, which
 * remembers what it saw at earlier decisions.
 */

/** An enemy group within HARASS_R tiles of an AI army may be a harasser (AI-39). */
export const HARASS_R = 12;
/** It kited when it moved away from the army while firing within the last KITE_WINDOW ticks (AI-39: 3 seconds). */
export const KITE_WINDOW = 60;
/** It out-ranges the army when its longest gun reaches at least OUTRANGE tiles farther than theirs: a tile's difference is no harassment. */
export const OUTRANGE = 1.5;
/** Chasers need CHASE_RATIO times the harassers' power (AI-40). */
export const CHASE_RATIO = 1.5;
/** A standing or gathering army answering harassers goes no farther than HARASS_LEASH tiles from where it stood (AI-40). */
export const HARASS_LEASH = 8;
/** Harassers not pushed off within HARASS_PATIENCE ticks while the army still loses value: it falls back (AI-40: 10 seconds). */
export const HARASS_PATIENCE = 200;

export interface Seen {
  id: number;
  kind: string;
  /** Fixed-point position, health and rank, as in a snapshot. */
  x: number;
  y: number;
  hp: number;
  rank?: number;
  /** What it is firing at, or -1. */
  target: number;
}

interface Pos {
  kind: string;
  x: number;
  y: number;
  hp: number;
  rank?: number;
}

const range = (kind: string): number => Math.max(unitDef(kind).weapon?.range ?? 0, unitDef(kind).weapon2?.range ?? 0);
const speed = (kind: string): number => unitDef(kind).speed;
/** A unit's longest gun (tiles). */
export const reachOf = range;
/**
 * A harasser that holds fire while it moves (CMB-4) must stop to shoot, so it is in motion only part of the time while
 * kiting: KITE_DUTY of it, a conservative share (AI-40).
 */
export const KITE_DUTY = 0.6;
/** How fast a harasser really gets away (AI-40): full speed for one that fires on the move (SKM-3), else KITE_DUTY of it. */
export const effectiveSpeed = (kind: string): number => (unitDef(kind).firesMoving ? speed(kind) : speed(kind) * KITE_DUTY);

/**
 * Which enemy units kited lately (AI-39): at each decision, an enemy unit that is firing (it has a target) and is farther
 * from the nearest of the AI's armed units than at the previous decision moved away while firing.
 */
export class KiteWatch {
  private last = new Map<number, { x: number; y: number }>();
  private kitedAt = new Map<number, number>();

  /** Record one decision: the enemy units it sees and its own armed units (fixed point). */
  see(tick: number, foes: readonly Seen[], own: readonly { x: number; y: number }[]): void {
    const now = new Map<number, { x: number; y: number }>();
    const nearest = (x: number, y: number): number => {
      let d = Infinity;
      for (const u of own) d = Math.min(d, Math.hypot(u.x - x, u.y - y));
      return d;
    };
    for (const f of foes) {
      if (!unitDef(f.kind).weapon) continue;
      now.set(f.id, { x: f.x, y: f.y });
      const was = this.last.get(f.id);
      if (was === undefined || f.target < 0 || own.length === 0) continue;
      // Its own move took it away from the AI's units where they stand now: the AI backing off is no kiting.
      if (nearest(f.x, f.y) > nearest(was.x, was.y) + FP / 16) this.kitedAt.set(f.id, tick);
    }
    this.last = now;
    for (const [id, t] of this.kitedAt) if (tick - t > KITE_WINDOW) this.kitedAt.delete(id);
  }

  /** Whether this enemy unit kited within KITE_WINDOW ticks of `tick`. */
  kited(id: number, tick: number): boolean {
    const t = this.kitedAt.get(id);
    return t !== undefined && tick - t <= KITE_WINDOW;
  }
}

/**
 * The units that make up most of an army's power (AI-39): its units from the most powerful down, until they hold more
 * than half its power.
 */
export function mainUnits<T extends Pos>(army: readonly T[]): T[] {
  const total = armyPower(army);
  const sorted = [...army].sort((a, b) => armyPower([b]) - armyPower([a]));
  const out: T[] = [];
  let p = 0;
  for (const u of sorted) {
    out.push(u);
    p += armyPower([u]);
    if (p > total / 2) break;
  }
  return out;
}

/**
 * Whether an enemy group is a harasser of an army (AI-39): it is weaker than the army, and it out-ranges (by OUTRANGE tiles) the units that
 * make up most of the army's power, or it is faster than them and one of it kited lately. An empty group is not.
 */
export function isHarasser(group: readonly Seen[], army: readonly Pos[], kited: (id: number) => boolean): boolean {
  if (group.length === 0 || army.length === 0 || armyPower(group) >= armyPower(army)) return false;
  const main = mainUnits(army);
  const theirSpeed = Math.max(...group.map((f) => speed(f.kind)));
  if (outranges(group, army)) return true;
  return theirSpeed > Math.max(...main.map((u) => speed(u.kind))) && group.some((f) => kited(f.id));
}

/** Whether a group out-ranges the units making up most of an army's power by OUTRANGE tiles or more (AI-39). */
export function outranges(group: readonly { kind: string }[], army: readonly Pos[]): boolean {
  if (group.length === 0 || army.length === 0) return false;
  return Math.max(...group.map((f) => range(f.kind))) >= Math.max(...mainUnits(army).map((u) => range(u.kind))) + OUTRANGE;
}

/** The units of an army that can catch or reach a group (AI-40): as fast as its fastest really gets away (effectiveSpeed), or with at least its longest range. */
export function catchers<T extends Pos>(army: readonly T[], group: readonly { kind: string }[]): T[] {
  if (group.length === 0) return [];
  const s = Math.max(...group.map((f) => speed(f.kind)));
  const r = Math.max(...group.map((f) => range(f.kind)));
  return army.filter((u) => speed(u.kind) >= s || range(u.kind) >= r);
}

/** How an army answers harassers (AI-40): chase with its catchers when they have CHASE_RATIO times the harassers' power, else push as one body. */
export function harassAnswer<T extends Pos>(army: readonly T[], group: readonly Pos[]): { mode: 'chase'; chasers: T[] } | { mode: 'push' } {
  const ch = catchers(army, group);
  return ch.length > 0 && armyPower(ch) >= CHASE_RATIO * armyPower(group) ? { mode: 'chase', chasers: ch } : { mode: 'push' };
}

/** A point at most `leash` tiles from `home` toward `p` (tiles). */
export function leashed(home: { x: number; y: number }, p: { x: number; y: number }, leash = HARASS_LEASH): { x: number; y: number } {
  const d = Math.hypot(p.x - home.x, p.y - home.y);
  const k = d > leash ? leash / d : 1;
  return { x: home.x + (p.x - home.x) * k, y: home.y + (p.y - home.y) * k };
}
