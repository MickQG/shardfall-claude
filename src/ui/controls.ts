import { unitDef } from '../data/defs';

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
