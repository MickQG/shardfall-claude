import { buildingDef } from '../data/defs';
import { FP } from '../sim';

export interface RallyLine {
  from: { tx: number; ty: number };
  to: { tx: number; ty: number };
}

/** The line to draw from a selected building to its explicit rally point, or null when there is nothing to show. */
export function rallyLine(b: { id: number; kind: string; tx: number; ty: number; rally?: [number, number] | null }, selected: number | null): RallyLine | null {
  if (selected !== b.id || !b.rally) return null;
  const d = buildingDef(b.kind);
  return { from: { tx: b.tx + d.w / 2, ty: b.ty + d.h / 2 }, to: { tx: Math.floor(b.rally[0] / FP), ty: Math.floor(b.rally[1] / FP) } };
}
