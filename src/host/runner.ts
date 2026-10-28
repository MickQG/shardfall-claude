import { createGame, snapshot, submit, tick, TICKS_PER_SECOND, type Command, type GameConfig, type Snapshot } from '../sim';

export const TICK_MS = 1000 / TICKS_PER_SECOND;

/**
 * Drives a simulation at a fixed tick rate from arbitrary elapsed-time deltas.
 * Frame rate never changes how many ticks a given amount of time produces.
 */
export class SimRunner {
  private game;
  private acc = 0;
  speed = 1;
  paused = false;

  constructor(
    cfg: GameConfig,
    private onSnapshot: (s: Snapshot) => void,
    /** Player whose fog-limited view is emitted. */
    private viewer = 0,
  ) {
    this.game = createGame(cfg);
    this.onSnapshot(snapshot(this.game, this.viewer));
  }

  send(cmd: Command): void {
    submit(this.game, cmd);
  }

  /** Advance by `dtMs` of wall time; returns the number of ticks executed. */
  advance(dtMs: number): number {
    if (this.paused) return 0;
    this.acc += dtMs * this.speed;
    let n = 0;
    while (this.acc >= TICK_MS && n < 10) {
      tick(this.game);
      this.acc -= TICK_MS;
      n++;
      this.onSnapshot(snapshot(this.game, this.viewer));
    }
    if (this.acc > TICK_MS * 10) this.acc = 0;
    return n;
  }
}
