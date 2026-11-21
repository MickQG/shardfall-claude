import { unitDef } from '../data/defs';

/**
 * Army ball and concave (AI-41, AI-42): pure geometry. Positions are in tiles (fractional); slots are tiles.
 */

/** The army forms a concave when a known enemy force is within this many tiles of its centre (AI-42). */
export const CONCAVE_R = 12;
/** Distance (tiles) between neighbouring slots in a row, between rows, and the most slots in one row. */
export const SLOT_GAP = 1.4;
export const ROW_GAP = 1.6;
export const ROW_MAX = 12;
/** How far the ends of a row bend toward the enemy, as a share of its half width. */
export const CONCAVE_BEND = 0.5;
/** A unit more than this many tiles from its slot is sent to it (AI-42); one fighting is left alone up to SLOT_ENGAGED tiles off. */
export const SLOT_SLACK = 1.5;
export const SLOT_ENGAGED = 4;
/** Ball (AI-41): a unit farther than BALL_BASE + √n tiles from its group's centre is a straggler. */
export const BALL_BASE = 4;

export interface FormUnit {
  id: number;
  kind: string;
  x: number;
  y: number;
}

export interface Tile {
  tx: number;
  ty: number;
}

/** A heavy unit, for the front of the concave (AI-42): heavy armour that is not artillery: tanks, Brutes, Skimmers, the heroes. */
export const isFrontLine = (kind: string): boolean => {
  const d = unitDef(kind);
  return d.armor === 'heavy' && d.role !== 'artillery' && d.role !== 'support' && d.role !== 'harvester';
};

/** The spread at which a group counts as strung out (AI-11, AI-41): BALL_BASE + √n tiles. */
export const ballRadius = (n: number): number => BALL_BASE + Math.sqrt(n);

/** The middle of a set of units, in tiles. */
export const middleOf = (us: readonly { x: number; y: number }[]): { x: number; y: number } => ({ x: us.reduce((s, u) => s + u.x, 0) / us.length, y: us.reduce((s, u) => s + u.y, 0) / us.length });

/** Ball stragglers (AI-41): the units more than ballRadius(n) tiles from the group's centre, in id order. */
export function ballStragglers(units: readonly FormUnit[], centre = middleOf(units)): number[] {
  if (units.length === 0) return [];
  const r = ballRadius(units.length);
  return units
    .filter((u) => Math.hypot(u.x - centre.x, u.y - centre.y) > r)
    .map((u) => u.id)
    .sort((a, b) => a - b);
}

/**
 * Concave slots (AI-42). The front row stands at `anchor`, across the line from `anchor` to `facing` (the enemy's centre);
 * each row is an arc whose ends bend toward the enemy. Heavy units (isFrontLine) fill the first rows, dearest first; the
 * other units stand in the rows behind, each row staggered by half a slot so they shoot through the gaps, and a row behind
 * is at least as wide as the row ahead of it. Within a row units take slots in the order they stand across the line, so
 * no paths cross; ties go by id. A slot on ground `open` rejects moves to the nearest open tile not already taken.
 * Deterministic: the same inputs always give the same slots.
 */
export function concaveSlots(units: readonly FormUnit[], anchor: { x: number; y: number }, facing: { x: number; y: number }, open: (tx: number, ty: number) => boolean): Map<number, Tile> {
  const out = new Map<number, Tile>();
  if (units.length === 0) return out;
  let fx = facing.x - anchor.x;
  let fy = facing.y - anchor.y;
  const len = Math.hypot(fx, fy);
  if (len < 1e-6) {
    fx = 1;
    fy = 0;
  } else {
    fx /= len;
    fy /= len;
  }
  // Across the line, to the left looking at the enemy.
  const vx = fy;
  const vy = -fx;
  const across = (u: FormUnit): number => (u.x - anchor.x) * vx + (u.y - anchor.y) * vy;
  const dearFirst = (a: FormUnit, b: FormUnit): number => unitDef(b.kind).cost - unitDef(a.kind).cost || a.id - b.id;
  const heavy = units.filter((u) => isFrontLine(u.kind)).sort(dearFirst);
  const rest = units.filter((u) => !isFrontLine(u.kind)).sort(dearFirst);
  const rows: FormUnit[][] = [];
  for (const group of [heavy, rest]) for (let i = 0; i < group.length; i += ROW_MAX) rows.push(group.slice(i, i + ROW_MAX));
  const taken = new Set<number>();
  const key = (t: Tile): number => t.ty * 100000 + t.tx;
  let width = 0;
  rows.forEach((row, r) => {
    const n = row.length;
    // A row behind is at least as wide as the one ahead, so its units see past the ends of it.
    const gap = r > 0 && n > 1 ? Math.max(SLOT_GAP, width / (n - 1)) : SLOT_GAP;
    const half = ((n - 1) * gap) / 2;
    width = Math.max(width, 2 * half);
    const stagger = r % 2 === 1 ? gap / 2 : 0;
    const offsets = row.map((_, i) => -half + i * gap + stagger);
    const order = [...row].sort((a, b) => across(a) - across(b) || a.id - b.id);
    order.forEach((u, i) => {
      const s = offsets[i] as number;
      const fwd = -r * ROW_GAP + (half > 0 ? (CONCAVE_BEND * s * s) / Math.max(half, 1) : 0);
      const px = anchor.x + vx * s + fx * fwd;
      const py = anchor.y + vy * s + fy * fwd;
      const t = nearestOpen(Math.floor(px), Math.floor(py), open, (q) => !taken.has(key(q)));
      taken.add(key(t));
      out.set(u.id, t);
    });
  });
  return out;
}

/** The nearest tile to (tx, ty), ring by ring out to 4 tiles, that is open and allowed; the tile itself when none is. */
export function nearestOpen(tx: number, ty: number, open: (tx: number, ty: number) => boolean, allowed: (t: Tile) => boolean = () => true): Tile {
  for (let r = 0; r <= 4; r++) {
    let best: Tile | null = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t = { tx: tx + dx, ty: ty + dy };
        if (!open(t.tx, t.ty) || !allowed(t)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
    if (best) return best;
  }
  return { tx, ty };
}

/**
 * Which units to send to their slots (AI-42), farthest off first, at most `budget`: those more than SLOT_SLACK tiles from
 * their slot that are not already heading there (destination within a tile of it), leaving a unit that is fighting (it
 * has a target) alone while it is within SLOT_ENGAGED tiles of its slot.
 */
export function slotMoves(
  units: readonly (FormUnit & { dest?: readonly [number, number] | null; target?: number })[],
  slots: ReadonlyMap<number, Tile>,
  budget: number,
): { id: number; tx: number; ty: number; off: number }[] {
  const moves: { id: number; tx: number; ty: number; off: number }[] = [];
  for (const u of units) {
    const s = slots.get(u.id);
    if (!s) continue;
    const off = Math.hypot(u.x - (s.tx + 0.5), u.y - (s.ty + 0.5));
    if (off <= SLOT_SLACK) continue;
    if ((u.target ?? -1) >= 0 && off <= SLOT_ENGAGED) continue;
    if (u.dest && Math.abs(u.dest[0] - s.tx) <= 1 && Math.abs(u.dest[1] - s.ty) <= 1) continue;
    moves.push({ id: u.id, tx: s.tx, ty: s.ty, off });
  }
  return moves.sort((a, b) => b.off - a.off || a.id - b.id).slice(0, Math.max(0, budget));
}
