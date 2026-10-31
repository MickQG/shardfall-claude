import { buildingDef, isBuildingKind, trainableAt, unitDef } from '../data/defs';

/** Why `kind` cannot be queued right now, or null when it can: a missing building first, then credits, then room. */
export function queueRefusal(kind: string, ownedKinds: readonly string[], credits: number, hasRoom: boolean): string | null {
  const d = isBuildingKind(kind) ? buildingDef(kind) : unitDef(kind);
  const needs = isBuildingKind(kind) ? d.requires : [unitDef(kind).builtAt, ...d.requires];
  const miss = needs.filter((k) => !ownedKinds.includes(k));
  if (miss.length > 0) return `Requires ${miss.map((k) => buildingDef(k).name).join(', ')}`;
  if (credits < d.cost) return 'Not enough credits';
  if (!hasRoom) return 'Queue full';
  return null;
}

/** Whether a superweapon can fire, and the label its button shows. */
export function fireState(charge: number, lowPower: boolean): { ready: boolean; label: string } {
  if (charge < 100) return { ready: false, label: `Charging ${charge}%` };
  if (lowPower) return { ready: false, label: 'Low power' };
  return { ready: true, label: 'Fire superweapon' };
}

/** One own superweapon as the console's superweapon panel shows it (UI-9). */
export interface SuperweaponRow {
  id: number;
  name: string;
  /** Charge, percent. */
  pct: number;
  ready: boolean;
  /** Waiting for the player to pick a target. */
  armed: boolean;
  /** The state line under the name. */
  state: string;
  /** The button's label. */
  button: string;
  /** Why the button cannot be used, shown when it is clicked anyway. */
  why: string;
}

/** The superweapon panel (UI-9): a row per own superweapon, with its charge, state and fire button. Pure. */
export function superweaponRows(mine: readonly { id: number; kind: string; charge: number }[], lowPower: boolean, targeting: number | null): SuperweaponRow[] {
  return mine
    .filter((b) => buildingDef(b.kind).superweapon)
    .map((b) => {
      const fs = fireState(b.charge, lowPower);
      const armed = targeting === b.id;
      return {
        id: b.id,
        name: buildingDef(b.kind).name,
        pct: b.charge,
        ready: fs.ready,
        armed,
        state: armed ? 'Pick a target on the map' : fs.ready ? 'Ready to fire' : fs.label,
        button: armed ? 'CANCEL' : fs.ready ? 'FIRE' : `${b.charge}%`,
        why: fs.ready ? '' : fs.label,
      };
    });
}

/** Buildings that train units have a rally point worth setting. */
export const rallyHint = (kind: string): boolean => trainableAt(kind).length > 0;

/** Two-click sell: the first click arms a confirmation for one building, a second within the window sells it. */
export class SellConfirm {
  private pending: { id: number; at: number } | null = null;

  constructor(private windowMs: number) {}

  armed(id: number, now: number): boolean {
    return !!this.pending && this.pending.id === id && now - this.pending.at <= this.windowMs;
  }

  click(id: number, now: number): 'confirm' | 'sell' {
    if (this.armed(id, now)) {
      this.pending = null;
      return 'sell';
    }
    this.pending = { id, at: now };
    return 'confirm';
  }
}
