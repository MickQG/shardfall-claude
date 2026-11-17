import { unitDef } from '../data/defs';

/** A Field Mender's repair reach ring (R3D-38): green-blue, as its repair stream. */
export const MEND_RING = 0x4fffd0;
/** A hero's aura ring (HERO-9): gold. */
export const AURA_RING = 0xffd34a;

/**
 * The rings a selected unit of `kind` shows on the ground around it, both views: a Field Mender's repair reach
 * (R3D-38) and a hero's aura (HERO-9), each with its radius in tiles from the unit's centre. Empty for other units.
 */
export function selectedRings(kind: string): { range: number; color: number }[] {
  const d = unitDef(kind);
  const out: { range: number; color: number }[] = [];
  if (d.repair) out.push({ range: d.repair.range, color: MEND_RING });
  if (d.aura) out.push({ range: d.aura.range, color: AURA_RING });
  return out;
}
