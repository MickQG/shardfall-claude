import { buildingDef } from '../data/defs';
import { IDEAL_HAULERS, idealHaulers, type HaulerKind } from '../data/haulers';
import { BUILD_RANGE, EXPLORED, type BuildingSnap } from '../sim';
import type { ShardField } from './ai';

/**
 * Economy and expansion (AI-43, AI-44): how many haulers each mined field wants, when the AI crawls toward a new field
 * and which one. Pure functions over the AI's view, so the AI and the steamroll opponent (HAR-5) share them.
 */

/** A refinery serves a field when its footprint centre is within this many tiles of the field's centre (AI-18). */
export const SERVE_R = 9;
/** A field is safe to crawl to with at most this much cost of recent enemy armed units or defences near it (AI-44). */
export const CRAWL_SAFE = 150;
/** ... within this many tiles of its centre (AI-44). */
export const CRAWL_SAFE_R = 8;
/** A mined field with less than this share of its shards left starts a crawl to the next field (AI-44). */
export const CRAWL_LOW = 0.25;
/**
 * Opening ramp (AI-43): until its second factory stands the AI keeps the old three haulers a refinery, so its opening
 * (AI-3, AI-22) is unchanged; the ideal counts apply from then on.
 */
export const RAMP_PER_REFINERY = 3;
/** At most this many haulers in production at once (AI-43), so new haulers trickle in beside the army instead of stalling the factories. */
export const HAULERS_IN_PRODUCTION = 2;
/** With nothing else to build while crawling, a power plant toward the target once this much is banked (AI-44). */
export const CRAWL_FILLER_BANK = 1500;

/** Tiles between a building's footprint and a tile (0 when the tile is under it), as placement measures range. */
export function buildingGap(b: BuildingSnap, x: number, y: number): number {
  const d = buildingDef(b.kind);
  return Math.max(b.tx - x, x - (b.tx + d.w - 1), 0, b.ty - y, y - (b.ty + d.h - 1));
}

/** Shards left on a field, and its tiles still holding shards. */
export function fieldStock(shards: ArrayLike<number>, f: ShardField): { left: number; tiles: number } {
  let left = 0;
  let tiles = 0;
  for (const t of f.tiles) {
    const s = shards[t] as number;
    if (s > 0) {
      left += s;
      tiles++;
    }
  }
  return { left, tiles };
}

/** The refinery serving a field (AI-18): the nearest of its own within SERVE_R tiles of the field's centre, if any. */
export function servingRefinery(buildings: readonly BuildingSnap[], f: ShardField): BuildingSnap | undefined {
  let best: BuildingSnap | undefined;
  let bd = Infinity;
  for (const b of buildings) {
    const d = buildingDef(b.kind);
    if (!d.refinery) continue;
    const r = Math.hypot(b.tx + d.w / 2 - f.cx, b.ty + d.h / 2 - f.cy);
    if (r <= SERVE_R && r < bd) {
      bd = r;
      best = b;
    }
  }
  return best;
}

/** Tiles from a refinery's dock pad (its footprint centre while it has none) to the nearest tile of a field still holding shards (ECO-10). */
export function padDistance(ref: BuildingSnap, f: ShardField, shards: ArrayLike<number>, width: number): number {
  const d = buildingDef(ref.kind);
  const [px, py] = ref.pad ?? [ref.tx + (d.w - 1) / 2, ref.ty + (d.h - 1) / 2];
  let best = Infinity;
  for (const t of f.tiles) if ((shards[t] as number) > 0) best = Math.min(best, Math.hypot((t % width) - px, Math.floor(t / width) - py));
  return best;
}

/**
 * The haulers one mined field wants (AI-43): its ideal count (ECO-10) for the tiles still holding shards and the pad
 * distance, but never so many that the remaining shards, shared out among them, would not pay back a new hauler's cost.
 */
export function fieldHaulers(kind: string, tiles: number, padDist: number, left: number, haulerCost: number): number {
  if (tiles <= 0 || left <= 0) return 0;
  const k: HaulerKind = kind in IDEAL_HAULERS ? (kind as HaulerKind) : 'hum_hauler';
  return Math.max(0, Math.min(idealHaulers(k, tiles, padDist), Math.floor(left / Math.max(1, haulerCost))));
}

/** One mined field's plan: its index in the AI's field list, the haulers it wants, and whether it is running low (AI-43, AI-44). */
export interface MinedField {
  index: number;
  want: number;
  low: boolean;
}

/**
 * The fields a player mines and the haulers each wants (AI-43): every field with shards left and one of its refineries
 * serving it. `initial` gives each field's shards at the start of the game, for the low-stock test (AI-44).
 */
export function minedFields(fields: readonly ShardField[], initial: readonly number[], buildings: readonly BuildingSnap[], shards: ArrayLike<number>, width: number, haulerKind: string, haulerCost: number): MinedField[] {
  const out: MinedField[] = [];
  fields.forEach((f, index) => {
    const { left, tiles } = fieldStock(shards, f);
    if (tiles === 0) return;
    const ref = servingRefinery(buildings, f);
    if (!ref) return;
    const want = fieldHaulers(haulerKind, tiles, padDistance(ref, f, shards, width), left, haulerCost);
    out.push({ index, want, low: left < CRAWL_LOW * (initial[index] ?? left) });
  });
  return out;
}

/**
 * Whether the AI crawls toward a new field now (AI-44): it mines at least one field, and every field it mines has its
 * ideal hauler count (`staffed`), or any of them has less than a quarter of its shards left.
 */
export function wantsCrawl(mined: readonly MinedField[], staffed: (m: MinedField) => boolean): boolean {
  return mined.length > 0 && (mined.every(staffed) || mined.some((m) => m.low));
}

/**
 * The field to crawl toward (AI-44), among `candidates` (fields it does not mine, with shards left and not mined by the
 * enemy as far as it knows), nearest first: the first that is safe; with none safe, the one nearest the map centre (the
 * contested centre field, or the only field left).
 */
export function crawlTarget(candidates: readonly ShardField[], safe: (f: ShardField) => boolean, mapCentre: { x: number; y: number }): ShardField | null {
  const ok = candidates.find(safe);
  if (ok) return ok;
  let best: ShardField | null = null;
  let bd = Infinity;
  for (const f of candidates) {
    const d = Math.hypot(f.cx - mapCentre.x, f.cy - mapCentre.y);
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/**
 * Whether a refinery can be built at a field now (HAR-5, AI-44): one of its own buildings stands within BUILD_RANGE - 1
 * tiles of an explored tile of the field holding shards (the margin leaves room for the refinery's own footprint).
 * `known` says whether a tile still holds shards as far as the player knows.
 */
export function inReach(f: ShardField, buildings: readonly BuildingSnap[], fog: ArrayLike<number>, width: number, known: (t: number) => boolean = () => true): boolean {
  return f.tiles.some((i) => ((fog[i] as number) & EXPLORED) !== 0 && known(i) && buildings.some((b) => buildingGap(b, i % width, Math.floor(i / width)) <= BUILD_RANGE - 1));
}
