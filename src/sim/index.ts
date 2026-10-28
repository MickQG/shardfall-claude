import { Hasher } from './hash';
import { Rng } from './rng';
import type { Command, GameConfig, Snapshot } from './types';

export type { Command, GameConfig, MapDef, Snapshot } from './types';
export { Rng } from './rng';

export const TICKS_PER_SECOND = 20;

interface State {
  tick: number;
  rng: Rng;
  cfg: GameConfig;
  pending: Command[];
}

export interface Game {
  readonly state: State;
}

export function createGame(cfg: GameConfig): Game {
  return { state: { tick: 0, rng: new Rng(cfg.seed), cfg, pending: [] } };
}

export function submit(game: Game, cmd: Command): void {
  game.state.pending.push(cmd);
}

export function tick(game: Game): void {
  const s = game.state;
  s.pending.length = 0;
  s.rng.nextU32();
  s.tick += 1;
}

export function snapshot(game: Game): Snapshot {
  const { cfg, tick: t } = game.state;
  return { tick: t, mapWidth: cfg.map.width, mapHeight: cfg.map.height, heights: cfg.map.heights };
}

export function hash(game: Game): number {
  const s = game.state;
  const h = new Hasher().int(s.tick).int(s.rng.state).int(s.cfg.map.width).int(s.cfg.map.height);
  for (const v of s.cfg.map.heights) h.int(v);
  return h.value;
}
