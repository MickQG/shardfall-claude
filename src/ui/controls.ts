import { unitDef } from '../data/defs';

/** Ids of the player's living combat units (units with a weapon; harvesters are not combat units). */
export function combatUnitIds(units: readonly { id: number; owner: number; kind: string }[], player: number): number[] {
  return units.filter((u) => u.owner === player && unitDef(u.kind).weapon !== undefined).map((u) => u.id);
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
