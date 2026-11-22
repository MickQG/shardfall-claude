import { UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { FP, mayCarry, maxHpOf, type Command, type UnitSnap } from '../sim';

/**
 * How the AI uses the Field Mender (AI-29), on every difficulty: one Mender for every MENDER_PER tanks, each loaded with an
 * anti-armour squad; Menders follow the tanks; a badly damaged tank falls back to its nearest Mender until mended; and a
 * Mender lets its squad out when it is nearly destroyed, or when it is stuck out of combat. Plain data in, ordinary
 * commands out; deterministic (no clock, no randomness).
 */

/** Tanks per Mender (AI-29). */
export const MENDER_PER = 3;
/** A Mender below this share of its health unloads its squad (AI-29). */
export const MENDER_UNLOAD_HP = 0.15;
/** A Mender that has wanted to move but stood on the same tile this long (10 s), with no enemy near, unloads (AI-29). */
export const MENDER_STUCK = 20 * 10;
/** "Out of combat": no armed enemy seen within this many tiles of it (AI-29). */
export const MENDER_CALM = 8;
/** A tank below this share of its health falls back to a Mender, and rejoins at MENDER_DONE (AI-29). */
export const MENDER_FALLBACK = 0.5;
export const MENDER_DONE = 0.9;
/** A Mender follows when it is this many tiles from its tanks' middle (AI-29). */
export const MENDER_LEASH = 4;
/** Ticks before a board order that has not landed is given again to another squad, and before a Mender that let its squad out takes another. */
export const BOARD_PATIENCE = 20 * 20;
export const RELOAD_AFTER = 20 * 30;

/** The faction's Field Mender kind, or null (the Vrax have none). */
export const menderOf = (faction: Faction): string | null => Object.keys(UNIT_DEFS).find((k) => unitDef(k).faction === faction && unitDef(k).repair !== undefined) ?? null;

const tile = (v: number): number => Math.floor(v / FP);
const d2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const frac = (u: UnitSnap): number => u.hp / maxHpOf(u.kind, u.rank);

/** Whether a unit counts as a tank for the Mender count and the fallback (AI-29): a tank that is not a hero. */
export const isTank = (kind: string): boolean => unitDef(kind).role === 'tank' && !unitDef(kind).hero;

/** How many more Menders an AI wants (AI-29): one per MENDER_PER tanks, those alive and queued, less those it has or has queued. */
export function mendersWanted(tanks: number, menders: number): number {
  return Math.max(0, Math.floor(tanks / MENDER_PER) - menders);
}

export interface MenderTurn {
  /** Orders, most urgent first: unloads, then boarding, then fallbacks and following. */
  orders: Command[];
  /** Units taken out of the army for this turn: squads on their way to board, tanks falling back to be mended. */
  busy: Set<number>;
}

/** The AI's memory of its Menders between turns (AI-29). */
export class MenderPlan {
  /** Mender id to the squad sent to board it and when. */
  private boarding = new Map<number, { squad: number; at: number }>();
  /** Where each Mender last stood (tile index) and since when. */
  private still = new Map<number, { at: number; since: number }>();
  /** When each Mender last let its squad out (no new squad for RELOAD_AFTER). */
  private unloadedAt = new Map<number, number>();
  /** Tanks falling back to be mended. */
  private mending = new Set<number>();

  constructor(private readonly player: number, readonly kind: string | null) {}

  /**
   * One turn (AI-29): `own` are the AI's units in its snapshot, `foes` the enemies it sees, `army` its army (units that can
   * fight, scouts excluded), `fallback` whether its tanks fall back to be mended (not for the steamroll opponent, HAR-5),
   * `load` whether its Menders take squads aboard (AiRules, for measurement).
   */
  turn(tick: number, own: readonly UnitSnap[], foes: readonly UnitSnap[], army: readonly UnitSnap[], width: number, fallback: boolean, load = true, fallbackAt = MENDER_FALLBACK): MenderTurn {
    const orders: Command[] = [];
    const busy = new Set<number>();
    const menders = own.filter((u) => u.kind === this.kind);
    if (!this.kind || menders.length === 0) {
      this.boarding.clear();
      this.mending.clear();
      return { orders, busy };
    }
    const alive = new Set(own.map((u) => u.id));
    const calm = (m: UnitSnap): boolean => !foes.some((f) => unitDef(f.kind).weapon && d2(f, m) <= (MENDER_CALM * FP) ** 2);

    // Unload (AI-29): nearly destroyed, or stuck out of combat for MENDER_STUCK ticks.
    for (const m of menders) {
      const at = tile(m.y) * width + tile(m.x);
      const s = this.still.get(m.id);
      if (!s || s.at !== at || m.dest === null) this.still.set(m.id, { at, since: tick });
      if (!m.cargo) continue;
      const stuck = m.dest !== null && tick - (this.still.get(m.id)?.since ?? tick) >= MENDER_STUCK && calm(m);
      if (frac(m) < MENDER_UNLOAD_HP || stuck) {
        orders.push({ type: 'unload', player: this.player, units: [m.id] });
        this.unloadedAt.set(m.id, tick);
        this.still.set(m.id, { at, since: tick });
      }
    }
    for (const id of [...this.still.keys()]) if (!alive.has(id)) this.still.delete(id);

    // Load (AI-29): each empty Mender takes the nearest anti-armour squad of the army it may carry.
    const taken = new Set<number>();
    for (const [mid, b] of this.boarding) {
      const m = menders.find((u) => u.id === mid);
      if (!m || m.cargo || !alive.has(b.squad) || tick - b.at > BOARD_PATIENCE) this.boarding.delete(mid);
      else {
        taken.add(b.squad);
        busy.add(b.squad);
      }
    }
    for (const m of load ? menders : []) {
      if (m.cargo || this.boarding.has(m.id) || frac(m) < 0.5 || tick - (this.unloadedAt.get(m.id) ?? -Infinity) < RELOAD_AFTER) continue;
      const squad = army
        .filter((u) => !taken.has(u.id) && unitDef(u.kind).role === 'antiarmor' && mayCarry(m.kind, u.kind))
        .sort((a, b) => d2(a, m) - d2(b, m) || a.id - b.id)[0];
      if (!squad) continue;
      taken.add(squad.id);
      busy.add(squad.id);
      this.boarding.set(m.id, { squad: squad.id, at: tick });
      orders.push({ type: 'board', player: this.player, units: [squad.id], carrier: m.id });
    }

    const tanks = army.filter((u) => isTank(u.kind));
    // Fallback (AI-29): a badly damaged tank goes to its nearest Mender and stays out of the army until mended.
    for (const id of [...this.mending]) {
      const t = tanks.find((u) => u.id === id);
      if (!t || !fallback || frac(t) >= MENDER_DONE) this.mending.delete(id);
    }
    if (fallback) {
      for (const t of tanks) {
        const near = menders.slice().sort((a, b) => d2(a, t) - d2(b, t) || a.id - b.id)[0] as UnitSnap;
        if (this.mending.has(t.id)) {
          busy.add(t.id);
          // Keep close to it as it moves.
          if (d2(near, t) > (2.5 * FP) ** 2 && (tick + t.id) % 40 < 20) orders.push(this.move([t.id], near));
          continue;
        }
        if (frac(t) >= fallbackAt) continue;
        this.mending.add(t.id);
        busy.add(t.id);
        orders.push(this.move([t.id], near));
      }
    }

    // Follow (AI-29): Menders go to the middle of the tanks still fighting (or of the army without any), when far from it.
    const lead = tanks.filter((u) => !busy.has(u.id));
    const rest = army.filter((u) => !busy.has(u.id));
    const group = rest.length > 0 ? rest : lead;
    if (group.length > 0) {
      const cx = group.reduce((s, u) => s + u.x, 0) / group.length;
      const cy = group.reduce((s, u) => s + u.y, 0) / group.length;
      const centre = { x: Math.round(cx), y: Math.round(cy) };
      // A Mender with tanks falling back to it waits for them.
      const waited = new Set([...this.mending].map((id) => tanks.find((u) => u.id === id)).filter((u): u is UnitSnap => !!u).map((t) => menders.slice().sort((a, b) => d2(a, t) - d2(b, t) || a.id - b.id)[0]!.id));
      const far = menders.filter((m) => !waited.has(m.id) && d2(m, centre) > (MENDER_LEASH * FP) ** 2 && (tick + m.id) % 40 < 20);
      if (far.length > 0) orders.push(this.move(far.map((m) => m.id), centre));
    }
    return { orders, busy };
  }

  private move(ids: number[], to: { x: number; y: number }): Command {
    return { type: 'move', player: this.player, units: ids, x: Math.round(to.x), y: Math.round(to.y) };
  }

  /** Tanks falling back to be mended now: for tests. */
  get fallingBack(): readonly number[] {
    return [...this.mending];
  }
}
