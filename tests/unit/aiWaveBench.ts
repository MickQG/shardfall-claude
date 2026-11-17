import { AI, DIFFICULTIES, type AiRules, type Personality } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';
import { addUnit } from '../../src/sim/state';

/**
 * A bench for the AI's waves and hit squads (AI-26, AI-27), as in ai-hold.test.ts: a small human base on seed 6
 * (headquarters at 10,10, the enemy's at 83,83 on a 96 by 96 map) with no credits, so it builds and trains nothing, and
 * its army standing at its staging point (about 19 to 21 tiles out along the diagonal). What it has seen of the enemy is
 * added to its own snapshot, so each test controls exactly what it knows.
 */

export const LONG = 120_000;
export const CFG = skirmishConfig(6, { factions: ['human', 'alien'] });
export const MAP = CFG.map;
export const SEED = 6;

export interface Base {
  /** Its army, by kind, standing at its staging point. */
  army?: string[];
  tick?: number;
  /** A charged superweapon (AI-15). */
  superweapon?: boolean;
  /** Credits (none by default, so it trains nothing) and haulers at work (none by default). */
  credits?: number;
  haulers?: number;
}

/** Where the n-th unit of its army stands: rows of three around its staging point. */
export const atStage = (i: number): [number, number] => [19 + (i % 3), 19 + Math.floor(i / 3)];

export function base(o: Base = {}): Game {
  const own = (kind: string, tx: number, ty: number) => ({ owner: 0, kind, tx, ty });
  const buildings = [
    ...CFG.buildings!.filter((b) => b.owner !== 0),
    own('hum_hq', 10, 10),
    own('hum_reactor', 10, 14),
    own('hum_refinery', 14, 10),
    ...[2, 5, 8, 11, 14].map((x) => own('hum_reactor', x, 2)),
    own('hum_barracks', 2, 8),
    own('hum_factory', 14, 6),
    ...(o.superweapon ? [own('hum_lab', 2, 12), own('hum_reactor', 2, 5), own('hum_reactor', 5, 5), own('hum_lance', 2, 16)] : []),
  ];
  const units = [
    ...(CFG.units ?? []).filter((u) => u.owner !== 0),
    ...(o.army ?? []).map((kind, i) => ({ owner: 0, kind, tx: atStage(i)[0], ty: atStage(i)[1] })),
    ...[...Array(o.haulers ?? 0)].map((_, i) => ({ owner: 0, kind: 'hum_hauler', tx: 2 + i, ty: 30 })),
  ];
  const g = createGame({ ...CFG, players: [{ faction: 'human', credits: o.credits ?? 0 }, CFG.players![1]!], buildings, units });
  g.state.tick = o.tick ?? 3000;
  if (o.superweapon) for (const b of g.state.buildings) if (b.owner === 0 && buildingDef(b.kind).superweapon) b.charge = buildingDef(b.kind).superweapon!.charge;
  return g;
}

/** The bench's AI: one standing scout (AI-21 without rules.twoScouts), so the second does not take a unit from the army it is given. */
export const ai = (personality: Personality = 'balanced', rules?: Partial<AiRules>, seed = SEED): AI => new AI(0, 'human', DIFFICULTIES.hard, MAP, seed, personality, { rules: { twoScouts: false, ...rules } });
export const many = (kind: string, n: number): string[] => [...Array(n)].map(() => kind);

/** An enemy unit it sees, at a tile. */
export interface Foe {
  kind: string;
  tx: number;
  ty: number;
}
export type Sight = Foe[] | ((g: Game) => Foe[]);

/** The enemy headquarters as a remembered building, so it knows where the enemy is. */
const enemyHq = (g: Game): BuildingSnap[] => {
  const b = g.state.buildings.find((x) => x.owner === 1 && buildingDef(x.kind).hq);
  if (!b) return [];
  return [{ id: b.id, owner: 1, kind: b.kind, tx: b.tx, ty: b.ty, hp: b.hp, queue: [], repairing: false, rally: null, charge: 0 }];
};

/** One decision, with these enemy units seen (each keeps its id by its place in the list); `blind`: no enemy building known. */
export function look(g: Game, who: AI, sight: Sight = [], blind = false): Command[] {
  const s = snapshot(g, 0);
  const foes = typeof sight === 'function' ? sight(g) : sight;
  s.units.push(...foes.map((f, i) => ({ id: 900000 + i, owner: 1, kind: f.kind, x: f.tx * FP + FP / 2, y: f.ty * FP + FP / 2, hp: unitDef(f.kind).hp, dest: null, load: 0, rank: 0, target: -1 })));
  if (blind) {
    s.buildings = s.buildings.filter((b) => b.owner === 0);
    s.ghosts = [];
  } else if (!s.buildings.some((b) => b.owner === 1) && s.ghosts.length === 0) s.ghosts.push(...enemyHq(g));
  return who.think(s);
}

/** `ticks` of play, the AI deciding on its cadence; every order it gave. */
export function run(g: Game, who: AI, ticks: number, sight: Sight = [], blind = false): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % who.diff.thinkEvery === 0) {
      const cmds = look(g, who, sight, blind);
      for (const c of cmds) submit(g, c);
      log.push(...cmds);
    }
    tick(g);
  }
  return log;
}

/** Play until `done` holds (checked after each decision), at most `max` ticks; every order it gave. */
export function runUntil(g: Game, who: AI, max: number, done: () => boolean, sight: Sight = [], blind = false): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < max; i++) {
    if (g.state.tick % who.diff.thinkEvery === 0) {
      const cmds = look(g, who, sight, blind);
      for (const c of cmds) submit(g, c);
      log.push(...cmds);
      if (done()) break;
    }
    tick(g);
  }
  return log;
}

/** A weak enemy unit seen beside the enemy headquarters: fresh intel, but one of the target's defenders (AI-26). */
export const BY_TARGET: Foe = { kind: 'ali_skitter', tx: 80, ty: 80 };

export const tile = (v: number): number => v / FP;
export const mine = (g: Game, ids?: readonly number[]) => g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon && (!ids || ids.includes(u.id)));
export const centreOf = (g: Game, ids: readonly number[]): { x: number; y: number } => {
  const us = mine(g, ids);
  return { x: us.reduce((s, u) => s + tile(u.x), 0) / us.length, y: us.reduce((s, u) => s + tile(u.y), 0) / us.length };
};
/** Attack-move orders with all these units, to within `r` tiles of a point. */
export const sentTo = (log: readonly Command[], ids: readonly number[], p: { tx: number; ty: number }, r = 1.5): boolean =>
  log.some((c) => c.type === 'attackmove' && ids.every((id) => c.units.includes(id)) && Math.hypot(tile(c.x) - p.tx - 0.5, tile(c.y) - p.ty - 0.5) <= r);
/** Remove these units from the game, as if killed. */
export const kill = (g: Game, ids: readonly number[]): void => {
  g.state.units = g.state.units.filter((u) => !ids.includes(u.id));
};
/** Add units of a kind at its staging point; their ids. */
export const reinforce = (g: Game, kind: string, n: number): number[] => [...Array(n)].map((_, i) => addUnit(g.state, 0, kind, (atStage(i)[0] + 0.5) * FP, (atStage(i)[1] + 0.5) * FP).id);
/** Move these units to a tile, as if they had driven there. */
export const teleport = (g: Game, ids: readonly number[], tx: number, ty: number): void => {
  for (const u of g.state.units) if (ids.includes(u.id)) {
    u.x = tx * FP + FP / 2;
    u.y = ty * FP + FP / 2;
    u.path = [];
    u.goal = -1;
  }
};
/** Which side of the straight line from `a` to `b` a point lies: 1 left (looking along it, y downward), -1 right. */
export const sideOf = (a: { tx: number; ty: number }, b: { tx: number; ty: number }, p: { tx: number; ty: number }): number => Math.sign((p.tx - a.tx) * (b.ty - a.ty) - (p.ty - a.ty) * (b.tx - a.tx));
