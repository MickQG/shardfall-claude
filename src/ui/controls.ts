import { unitDef } from '../data/defs';
import { FP } from '../sim';

/** Ids of the player's living combat units (units with a weapon; harvesters are not combat units). */
export function combatUnitIds(units: readonly { id: number; owner: number; kind: string }[], player: number): number[] {
  return units.filter((u) => u.owner === player && unitDef(u.kind).weapon !== undefined).map((u) => u.id);
}

/** The combat units among `selected`: the only ones an attack-move is given to. */
export function attackMoveIds(units: readonly { id: number; owner: number; kind: string }[], selected: readonly number[], player: number): number[] {
  return combatUnitIds(units.filter((u) => selected.includes(u.id)), player);
}

/** With attack-move armed, a right-click (button 2) orders it; a left-click disarms and then acts as a normal left-click. */
export function amoveClick(button: number): 'order' | 'disarm' {
  return button === 2 ? 'order' : 'disarm';
}

/** What a minimap click does: an armed mode fires there; otherwise left moves the camera and right gives an order. */
export function minimapClick(button: number, modes: { amove: boolean; targeting: boolean }): 'attackmove' | 'superweapon' | 'camera' | 'order' {
  if (modes.targeting) return 'superweapon';
  if (modes.amove) return 'attackmove';
  return button === 2 ? 'order' : 'camera';
}

/** Tile at the middle of some units (fixed-point positions), or null for none. */
export function centroid(units: readonly { x: number; y: number }[]): { x: number; y: number } | null {
  if (units.length === 0) return null;
  return { x: units.reduce((a, u) => a + u.x, 0) / units.length / FP, y: units.reduce((a, u) => a + u.y, 0) / units.length / FP };
}

/** Detects a second press of the same key within `windowMs`. */
export class KeyTap {
  private last = { key: '', at: -Infinity };

  constructor(private windowMs: number) {}

  press(key: string, now: number): boolean {
    const hit = key === this.last.key && now - this.last.at <= this.windowMs;
    this.last = hit ? { key: '', at: -Infinity } : { key, at: now };
    return hit;
  }
}

/** Detects a second press within `windowMs` of the previous one. */
export class DoubleTap {
  private last = -Infinity;

  constructor(private windowMs: number) {}

  press(now: number): boolean {
    const hit = now - this.last <= this.windowMs;
    this.last = hit ? -Infinity : now;
    return hit;
  }
}
