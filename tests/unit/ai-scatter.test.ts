import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, SCATTER_GAP, SCATTER_R, type AiOptions, type Personality } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';

/**
 * Squads scatter from crushers (AI-24): how the AI's infantry squads get out of a crusher's way. Decided from a human
 * base on seed 6 (headquarters at 10,10, the enemy's at 83,83 on a 96 by 96 map). What it sees of the enemy is added to its own snapshot, at fixed ids, so each test controls exactly
 * what it knows; units in the fog stay remembered.
 */

const LONG = 60_000;
const CFG = skirmishConfig(6, { factions: ['human', 'alien'] });
const MAP = CFG.map;

interface Base {
  barracks?: number;
  factories?: number;
  lab?: boolean;
  turrets?: number;
  haulers?: number;
  credits?: number;
  /** Every barracks and factory has a unit in production. */
  busy?: boolean;
  /** Its own combat units, by kind, from tile (19,19) in rows of three. */
  army?: string[];
}

function base(o: Base = {}): Game {
  const spots = [...Array(40)].map((_, i) => ({ tx: 16 + (i % 8) * 4, ty: 4 + Math.floor(i / 8) * 4 }));
  let next = 0;
  const put = (kind: string, n: number) => [...Array(n)].map(() => ({ owner: 0, kind, ...spots[next++]! }));
  const buildings = [
    ...CFG.buildings!.filter((b) => b.owner !== 0),
    { owner: 0, kind: 'hum_hq', tx: 10, ty: 10 },
    ...put('hum_reactor', 8),
    ...put('hum_refinery', 3),
    ...put('hum_barracks', o.barracks ?? 0),
    ...put('hum_factory', o.factories ?? 0),
    ...put('hum_lab', o.lab ? 1 : 0),
    ...put('hum_turret', o.turrets ?? 0),
  ];
  const units = [
    ...(CFG.units ?? []).filter((u) => u.owner !== 0),
    ...[...Array(o.haulers ?? 8)].map((_, i) => ({ owner: 0, kind: 'hum_hauler', tx: 2 + i, ty: 30 })),
    ...(o.army ?? []).map((kind, i) => ({ owner: 0, kind, tx: 19 + (i % 3), ty: 19 + Math.floor(i / 3) })),
  ];
  const g = createGame({ ...CFG, players: [{ faction: 'human', credits: o.credits ?? 5000 }, CFG.players![1]!], buildings, units });
  g.state.tick = 7000;
  if (o.busy) {
    for (const b of g.state.buildings) {
      if (b.owner !== 0 || (b.kind !== 'hum_barracks' && b.kind !== 'hum_factory')) continue;
      const kind = b.kind === 'hum_barracks' ? 'hum_rifleman' : 'hum_tank';
      b.queue.push({ kind, cost: unitDef(kind).cost, progress: 2, total: 1000, ready: false });
    }
  }
  return g;
}

const ai = (personality: Personality = 'balanced', options: AiOptions = {}): AI => new AI(0, 'human', DIFFICULTIES.hard, MAP, 6, personality, options);

interface Foe {
  kind: string;
  tx: number;
  ty: number;
}
type Sight = Foe[] | ((g: Game) => Foe[]);

const enemyHq = (g: Game): BuildingSnap[] => {
  const b = g.state.buildings.find((x) => x.owner === 1 && buildingDef(x.kind).hq)!;
  return [{ id: b.id, owner: 1, kind: b.kind, tx: b.tx, ty: b.ty, hp: b.hp, queue: [], repairing: false, rally: null, charge: 0 }];
};

/** One decision with these enemy units seen (each keeps its id by its place in the list). */
function look(g: Game, who: AI, sight: Sight = []): Command[] {
  const s = snapshot(g, 0);
  const foes = typeof sight === 'function' ? sight(g) : sight;
  s.units.push(...foes.map((f, i) => ({ id: 900000 + i, owner: 1, kind: f.kind, x: f.tx * FP + FP / 2, y: f.ty * FP + FP / 2, hp: unitDef(f.kind).hp, dest: null, load: 0, rank: 0, target: -1 })));
  if (!s.buildings.some((b) => b.owner === 1) && s.ghosts.length === 0) s.ghosts.push(...enemyHq(g));
  return who.think(s);
}

/** Decisions in a row, the bank refilled each time; every order given. */
function decide(g: Game, who: AI, rounds: number, credits: number, sight: Sight = []): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < rounds; i++) {
    g.state.players[0]!.credits = credits;
    const cmds = look(g, who, sight);
    for (const c of cmds) submit(g, c);
    log.push(...cmds);
    tick(g);
  }
  return log;
}

/** `ticks` of play, the AI deciding on its cadence; every order it gave. */
function run(g: Game, who: AI, ticks: number, sight: Sight = []): Command[] {
  const log: Command[] = [];
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % who.diff.thinkEvery === 0) {
      const cmds = look(g, who, sight);
      for (const c of cmds) submit(g, c);
      log.push(...cmds);
    }
    tick(g);
  }
  return log;
}

describe('squads scatter from crushers (AI-24)', () => {
  /** Rifle squads standing from (19,19), and a Brute it sees `d` tiles east of the first one. */
  const squads = ['hum_rifleman', 'hum_rifleman', 'hum_rifleman'];
  const brute = (g: Game, d: number): Foe[] => {
    const u = g.state.units.find((x) => x.owner === 0 && x.kind === 'hum_rifleman')!;
    return [{ kind: 'ali_brute', tx: Math.floor(u.x / FP + d), ty: Math.floor(u.y / FP) }];
  };
  const scatters = (log: readonly Command[]): Extract<Command, { type: 'scatter' }>[] => log.filter((c): c is Extract<Command, { type: 'scatter' }> => c.type === 'scatter');

  it('AI-24: squads within 3 tiles of a crusher it sees are told to scatter, at most once every 2 s; none farther off, and none with the rule off', () => {
    expect([SCATTER_R, SCATTER_GAP]).toEqual([3, 40]);
    const g = base({ army: squads, credits: 0 });
    const who = ai();
    const near = (gm: Game): Foe[] => brute(gm, 2);
    const first = scatters(decide(g, who, 1, 0, near));
    expect(first).toHaveLength(1);
    const ids = first[0]!.units;
    const first0 = g.state.units.find((x) => x.owner === 0 && x.kind === 'hum_rifleman')!.id;
    expect(ids).toContain(first0);
    // Not again for the same squads within 2 s; again after.
    const again = run(g, who, SCATTER_GAP - 2, near);
    expect(scatters(again).filter((c) => c.units.some((id) => ids.includes(id)))).toHaveLength(0);
    expect(scatters(run(g, who, 16, near)).some((c) => c.units.includes(first0))).toBe(true);
    // Four tiles off (on the other side from the rest): no order.
    expect(scatters(decide(base({ army: squads, credits: 0 }), ai(), 1, 0, (gm) => brute(gm, -4)))).toHaveLength(0);
    // The rule off: no order.
    expect(scatters(decide(base({ army: squads, credits: 0 }), ai('balanced', { rules: { scatter: false } }), 1, 0, near))).toHaveLength(0);
  }, LONG);

  it('AI-24: a squad told to scatter keeps its wave membership, and the order comes out of the crush orders share of the command budget (BAL-5)', () => {
    const army = [...squads, ...squads, 'hum_tank', 'hum_tank', 'hum_tank', 'hum_tank', 'hum_tank', 'hum_tank'];
    const g = base({ army, credits: 0 });
    const who = ai();
    const FAR: Foe = { kind: 'ali_skitter', tx: 80, ty: 20 };
    run(g, who, 24 + 200, [FAR]);
    const members = who.waveState!.members;
    const squad = g.state.units.find((u) => u.owner === 0 && u.kind === 'hum_rifleman' && members.includes(u.id))!;
    const near = (): Foe[] => [FAR, { kind: 'ali_brute', tx: Math.floor(squad.x / FP + 2), ty: Math.floor(squad.y / FP) }];
    const log = run(g, who, 8, near);
    expect(scatters(log).some((c) => c.units.includes(squad.id))).toBe(true);
    expect(who.waveState!.members).toContain(squad.id);
    const share = Math.max(1, Math.ceil(who.diff.maxCommands / 2));
    expect(log.filter((c) => c.type === 'scatter' || (c.type === 'move' && c.units.length === 1)).length).toBeLessThanOrEqual(share);
  }, LONG);
});
