import { AI, DIFFICULTIES, type Personality } from '../ai/ai';
import { HASH_EVERY, TURN_TICKS } from '../net/protocol';
import { DEFAULT_SPEED } from './speed';
import { createGame, hash, snapshot, submit, tick, TICKS_PER_SECOND, type Command, type GameConfig, type Snapshot } from '../sim';

export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** An AI-controlled player. It plays through the same API as the human, from its own fog-limited snapshot. */
export interface AiSetup {
  player: number;
  difficulty: keyof typeof DIFFICULTIES;
  /** How it plays (AI-12); Balanced by default. */
  personality?: Personality;
}

/**
 * Drives a simulation at a fixed tick rate from arbitrary elapsed-time deltas.
 * Frame rate never changes how many ticks a given amount of time produces.
 */
export class SimRunner {
  private game;
  private acc = 0;
  private ais: { ai: AI; phase: number }[];
  /** Online play (NET-2): complete turns of both players' commands, by turn number; null when playing alone. */
  private turns: Map<number, Command[]> | null = null;
  /** Called with the state checksum every HASH_EVERY ticks in online play (NET-3). */
  onHash: ((tick: number, h: number) => void) | null = null;
  /** Game speed (UX-3): ×0.8 unless the player changes it; online it stays at the default for both players. */
  speed = DEFAULT_SPEED;
  paused = false;

  constructor(
    cfg: GameConfig,
    private onSnapshot: (s: Snapshot) => void,
    /** Player whose fog-limited view is emitted. */
    private viewer = 0,
    aiSetups: readonly AiSetup[] = [],
  ) {
    this.game = createGame(cfg);
    this.ais = aiSetups.map((a) => ({ ai: new AI(a.player, (cfg.players?.[a.player]?.faction ?? 'alien'), DIFFICULTIES[a.difficulty], cfg.map, cfg.seed, a.personality ?? 'balanced'), phase: a.player * 7 }));
    this.onSnapshot(snapshot(this.game, this.viewer));
  }

  send(cmd: Command): void {
    // Online, commands reach the simulation only inside complete turns (NET-2).
    if (!this.turns) submit(this.game, cmd);
  }

  /**
   * Switch to lockstep (NET-2): from now on a tick that starts a turn runs only once that turn's commands have been
   * delivered with `turn`, and then applies exactly them; commands from `send` are no longer accepted.
   */
  lockstep(): void {
    this.turns = new Map();
  }

  /** Both players' commands for lockstep turn `n` (NET-2). */
  turn(n: number, cmds: readonly Command[]): void {
    this.turns?.set(n, [...cmds]);
  }

  /** Whether the simulation is waiting for a turn that has not been delivered yet. */
  get stalled(): boolean {
    const t = this.game.state.tick;
    return !!this.turns && t % TURN_TICKS === 0 && !this.turns.has(t / TURN_TICKS);
  }

  /** Advance by `dtMs` of wall time; returns the number of ticks executed. */
  advance(dtMs: number): number {
    if (this.paused) return 0;
    this.acc += dtMs * this.speed;
    let n = 0;
    while (this.acc >= TICK_MS && n < 10) {
      if (this.turns) {
        const t = this.game.state.tick;
        if (t % TURN_TICKS === 0) {
          const cmds = this.turns.get(t / TURN_TICKS);
          if (!cmds) {
            // Held up by the other player: keep a little time in hand to catch up, never a burst.
            this.acc = Math.min(this.acc, TICK_MS * 6);
            break;
          }
          this.turns.delete(t / TURN_TICKS);
          for (const c of cmds) submit(this.game, c);
        }
      }
      for (const { ai, phase } of this.ais) {
        if ((this.game.state.tick + phase) % ai.diff.thinkEvery !== 0) continue;
        for (const c of ai.think(snapshot(this.game, ai.player))) submit(this.game, c);
      }
      tick(this.game);
      this.acc -= TICK_MS;
      n++;
      this.onSnapshot(snapshot(this.game, this.viewer));
      if (this.turns && this.game.state.tick % HASH_EVERY === 0) this.onHash?.(this.game.state.tick, hash(this.game));
    }
    if (this.acc > TICK_MS * 10) this.acc = 0;
    return n;
  }
}
