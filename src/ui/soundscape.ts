import type { Viewport } from '../render/camera';
import type { Projector } from '../render/projector';
import { FP, type Snapshot, type UnitSnap } from '../sim';
import { ambienceMix, movementMix, stepFight, type AmbienceMix, type MovingUnit, type MoveClass } from '../audio/recipes';

/** The units that moved between two successive snapshots (AUD-8): their position changed. */
export function movingUnits(prev: readonly UnitSnap[], curr: readonly UnitSnap[]): UnitSnap[] {
  const was = new Map<number, UnitSnap>();
  for (const u of prev) was.set(u.id, u);
  return curr.filter((u) => {
    const p = was.get(u.id);
    return !!p && (p.x !== u.x || p.y !== u.y);
  });
}

/** Tile centres of water (blocked tiles at level 0), thinned to at most `cap` points so counting them on screen stays cheap (AUD-10). */
export function waterPoints(map: { width: number; height: number; heights: readonly number[]; blocked?: readonly number[] }, cap = 300): { x: number; y: number }[] {
  const all: { x: number; y: number }[] = [];
  if (!map.blocked) return all;
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (map.blocked[y * map.width + x] === 1 && (map.heights[y * map.width + x] ?? 0) === 0) all.push({ x: x + 0.5, y: y + 0.5 });
  const stride = Math.max(1, Math.ceil(all.length / cap));
  return all.filter((_p, i) => i % stride === 0);
}

/** What the soundscape drives. */
interface Bed {
  setMovement(mix: Readonly<Record<MoveClass, number>>): void;
  setAmbience(mix: Readonly<AmbienceMix>): void;
}

/** How often the mix is worked out, ms: ten times a second is plenty for loops and beds that glide. */
const EVERY_MS = 100;

/**
 * The continuous sound of the world (AUD-8, AUD-10): movement loops that follow the units moving on screen, and the
 * ambience: water on screen, and a rumble while the player's forces fight off-screen. It reads snapshots and the
 * camera, makes no nodes per unit, and runs a few times a second.
 */
export class Soundscape {
  private water: { x: number; y: number }[];
  private fight = 0;
  private pending = 0;
  private lastAt = -Infinity;
  private moving: UnitSnap[] = [];
  private movingTick = -1;
  /** The last mixes sent, for tests and the debug hook. */
  last: { movement: Record<MoveClass, number>; ambience: AmbienceMix } = { movement: { vehicle: 0, walker: 0, infantry: 0, swarm: 0 }, ambience: { water: 0, rumble: 0 } };

  constructor(map: { width: number; height: number; heights: readonly number[]; blocked?: readonly number[] }, private bed: Bed) {
    this.water = waterPoints(map);
  }

  /** The player's units shooting or dying off-screen this frame: `n` of them (AUD-10). */
  noteOffscreenFight(n: number): void {
    this.pending += n;
  }

  update(prev: Snapshot | null, curr: Snapshot, proj: Projector, vp: Viewport, nowMs: number): void {
    if (nowMs - this.lastAt < EVERY_MS) return;
    const dt = Math.min(1, (nowMs - this.lastAt) / 1000);
    this.lastAt = nowMs;
    if (curr.tick !== this.movingTick) {
      this.moving = prev ? movingUnits(prev.units, curr.units) : [];
      this.movingTick = curr.tick;
    }
    const on: MovingUnit[] = this.moving.map((u) => {
      const s = proj.toScreen(u.x / FP, u.y / FP);
      return { kind: u.kind, sx: s.x, sy: s.y };
    });
    const movement = movementMix(on, vp.width, vp.height);
    let wet = 0;
    for (const p of this.water) {
      const s = proj.toScreen(p.x, p.y);
      if (s.x >= 0 && s.y >= 0 && s.x <= vp.width && s.y <= vp.height) wet++;
    }
    this.fight = stepFight(this.fight, dt, this.pending);
    this.pending = 0;
    const ambience = ambienceMix(wet, this.fight);
    this.last = { movement, ambience };
    this.bed.setMovement(movement);
    this.bed.setAmbience(ambience);
  }
}
