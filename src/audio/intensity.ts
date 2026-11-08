/** Seconds of damage that count towards the battle level. */
export const DAMAGE_WINDOW_MS = 5000;
/** Entities that give about 0.63 of the full layer. */
const SCALE = 5;
const RISE_TAU = 0.6;
const FALL_TAU = 1.2;

interface Hurt {
  id: number;
  owner: number;
  hp: number;
}

/** The target level for `count` distinct fighting entities: 1 gives about 0.18, 12 about 0.91. */
export const intensityTarget = (count: number): number => 1 - Math.exp(-count / SCALE);

/**
 * How hard the player is fighting, 0..1, for the music's battle layer (AUD-13). It counts the distinct own units and
 * buildings that dealt damage (own shots, by source) or took it (health dropped between snapshots) in the last five
 * seconds, anywhere on the map, and glides towards the matching level: up within a couple of seconds, and gone about ten
 * seconds after the fighting stops. It reads events and snapshots only and never feeds back into the simulation.
 */
export class BattleIntensity {
  private last = new Map<number, number>();
  private hp = new Map<number, number>();
  private level = 0;
  private at: number | null = null;

  /** An own unit or building took part in a fight (it fired, or died) at `ms`. */
  noteDamage(id: number, ms: number): void {
    this.last.set(id, ms);
  }

  /** Compares the viewer's units and buildings with the last snapshot: any whose health dropped took damage. */
  observe(units: readonly Hurt[], buildings: readonly Hurt[], viewer: number, ms: number): void {
    const now = new Map<number, number>();
    for (const list of [units, buildings]) {
      for (const e of list) {
        if (e.owner !== viewer) continue;
        const was = this.hp.get(e.id);
        if (was !== undefined && e.hp < was) this.last.set(e.id, ms);
        now.set(e.id, e.hp);
      }
    }
    this.hp = now;
  }

  /** Distinct entities that fought within the window. */
  count(ms: number): number {
    let n = 0;
    for (const [id, t] of this.last) {
      if (ms - t > DAMAGE_WINDOW_MS) this.last.delete(id);
      else n++;
    }
    return n;
  }

  /** Moves the level towards its target for the time since the last step, and returns it. */
  step(ms: number): number {
    const target = intensityTarget(this.count(ms));
    const dt = this.at === null ? 0 : Math.max(0, Math.min(1, (ms - this.at) / 1000));
    this.at = ms;
    const tau = target > this.level ? RISE_TAU : FALL_TAU;
    this.level += (target - this.level) * (1 - Math.exp(-dt / tau));
    if (target === 0 && this.level < 0.004) this.level = 0;
    return this.level;
  }
}
