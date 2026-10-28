import { AI, DIFFICULTIES } from '../ai/ai';
import { createGame, snapshot, submit, tick, TICKS_PER_SECOND, type Command, type GameConfig, type Snapshot } from '../sim';

export const TICK_MS = 1000 / TICKS_PER_SECOND;

/** An AI-controlled player. It plays through the same API as the human, from its own fog-limited snapshot. */
export interface AiSetup {
  player: number;
  difficulty: keyof typeof DIFFICULTIES;
}

/**
 * Drives a simulation at a fixed tick rate from arbitrary elapsed-time deltas.
 * Frame rate never changes how many ticks a given amount of time produces.
 */
export class SimRunner {
  private game;
  private acc = 0;
  private ais: { ai: AI; phase: number }[];
  speed = 1;
  paused = false;

  constructor(
    cfg: GameConfig,
    private onSnapshot: (s: Snapshot) => void,
    /** Player whose fog-limited view is emitted. */
    private viewer = 0,
    aiSetups: readonly AiSetup[] = [],
  ) {
    this.game = createGame(cfg);
    this.ais = aiSetups.map((a) => ({ ai: new AI(a.player, (cfg.players?.[a.player]?.faction ?? 'alien'), DIFFICULTIES[a.difficulty], cfg.map, cfg.seed), phase: a.player * 7 }));
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
      for (const { ai, phase } of this.ais) {
        if ((this.game.state.tick + phase) % ai.diff.thinkEvery !== 0) continue;
        for (const c of ai.think(snapshot(this.game, ai.player))) submit(this.game, c);
      }
      tick(this.game);
      this.acc -= TICK_MS;
      n++;
      this.onSnapshot(snapshot(this.game, this.viewer));
    }
    if (this.acc > TICK_MS * 10) this.acc = 0;
    return n;
  }
}
