import { FP, type Command } from '../sim';

/**
 * Acknowledgement (UI-13..15): the sight and sound shown to the player the moment they give a command, before it
 * takes effect (online, 100-200 ms later). Only on the giver's screen; nothing here reaches the simulation.
 */

/** How long a ground marker lasts (UI-13). */
export const ACK_MS = 600;
/** How long the ordered units' selection rings flash (UI-15). */
export const FLASH_MS = 350;

export const ACK_COLORS = {
  move: 0x5dff8a,
  attack: 0xff4a3a,
  harvest: 0xffd34a,
  place: 0x7ff5cd,
} as const;

/** The order sound (UI-14): `attack` for orders to fight, `order` for the rest. */
export type AckSound = 'order' | 'attack';

export interface Acknowledgement {
  /** Ground point in tiles, or null when the marker follows `target` (or there is no marker). */
  at: { x: number; y: number } | null;
  /** The unit or building attacked: the marker rides on it. */
  target: number | null;
  /** Marker colour, or null for no marker (a keyboard order). */
  color: number | null;
  /** Marker radius at its start, in tiles. */
  r: number;
  /** The units that were given the order: their rings flash. */
  units: readonly number[];
  sound: AckSound;
  born: number;
}

/**
 * The acknowledgement for `cmd` given at `now` (ms), or null for commands that are not orders on the map (production,
 * selling…: the console acknowledges those). `foot` is the footprint of a building being placed, in tiles.
 */
export function acknowledge(cmd: Command, now: number, rallyColor: number, foot?: { w: number; h: number }): Acknowledgement | null {
  const at = 'x' in cmd ? { x: cmd.x / FP, y: cmd.y / FP } : null;
  const units = 'units' in cmd ? cmd.units : [];
  const base = { at, target: null, units, born: now, r: 0.9 };
  switch (cmd.type) {
    case 'move':
      return { ...base, color: ACK_COLORS.move, sound: 'order' };
    case 'harvest':
      return { ...base, color: ACK_COLORS.harvest, sound: 'order' };
    case 'attackmove':
      return { ...base, color: ACK_COLORS.attack, sound: 'attack' };
    case 'attack':
      return { ...base, at: null, target: cmd.target, color: ACK_COLORS.attack, sound: 'attack' };
    case 'rally':
      return { ...base, color: rallyColor, sound: 'order' };
    case 'superweapon':
      return { ...base, color: ACK_COLORS.attack, sound: 'attack', r: 2 };
    case 'place': {
      const f = foot ?? { w: 1, h: 1 };
      return { ...base, at: { x: cmd.tx + f.w / 2, y: cmd.ty + f.h / 2 }, color: ACK_COLORS.place, sound: 'order', r: Math.max(f.w, f.h) * 0.6 };
    }
    case 'stop':
      return { ...base, color: null, sound: 'order' };
    default:
      return null;
  }
}

/** A marker to draw this frame: ground point in tiles, radius in tiles, and how far through its life it is (0..1). */
export interface AckMarker {
  x: number;
  y: number;
  r: number;
  color: number;
  k: number;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** The live acknowledgements: markers to draw and rings to flash. */
export class Acks {
  private list: Acknowledgement[] = [];
  /** The latest acknowledgement given, alive or not. */
  last: Acknowledgement | null = null;

  private prune(now: number): void {
    this.list = this.list.filter((a) => now - a.born < Math.max(ACK_MS, FLASH_MS));
  }

  add(a: Acknowledgement): void {
    this.last = a;
    this.list.push(a);
    if (this.list.length > 24) this.list.shift();
  }

  /**
   * Markers alive at `now`: each shrinks from its full radius to a third and is gone after ACK_MS. A marker on a
   * target follows it through `locate`; one whose target is gone is dropped.
   */
  markers(now: number, locate: (id: number) => { x: number; y: number } | null): AckMarker[] {
    this.prune(now);
    const out: AckMarker[] = [];
    for (const a of this.list) {
      // A frame's clock may run a little behind the click that made the acknowledgement: count that as its start.
      const k = Math.max(0, (now - a.born) / ACK_MS);
      if (a.color === null || k >= 1) continue;
      const p = a.target !== null ? locate(a.target) : a.at;
      if (!p) continue;
      out.push({ x: p.x, y: p.y, r: a.r * (1 - 0.65 * easeOut(k)), color: a.color, k });
    }
    return out;
  }

  /** Units whose rings flash at `now`, with the flash strength (1 at the order, fading to 0). */
  flashing(now: number): Map<number, number> {
    this.prune(now);
    const out = new Map<number, number>();
    for (const a of this.list) {
      const k = Math.max(0, (now - a.born) / FLASH_MS);
      if (k >= 1) continue;
      for (const id of a.units) out.set(id, Math.max(out.get(id) ?? 0, 1 - k));
    }
    return out;
  }
}
