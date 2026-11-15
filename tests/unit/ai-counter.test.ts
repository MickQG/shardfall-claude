import { describe, expect, it } from 'vitest';
import { AI, COUNTER_RIFLES, DIFFICULTIES, SCATTER_GAP, SCATTER_R, type AiOptions, type Personality } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';

/**
 * Against crushers (AI-24, AI-25): what the AI trains and builds against an army built round crushers, and how its
 * squads get out of a crusher's way. Decided from a human base on seed 6 (headquarters at 10,10, the enemy's at 83,83 on
 * a 96 by 96 map). What it sees of the enemy is added to its own snapshot, at fixed ids, so each test controls exactly
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

/** `n` enemy units of a kind in the fog, far from everything, from the n-th place of `from` on. */
const fog = (kind: string, n: number, from = 0): Foe[] => [...Array(n)].map((_, i) => ({ kind, tx: 60 + ((from + i) % 8), ty: 40 + Math.floor((from + i) / 8) }));
/** A steamroll army seen in the fog: four Brutes and four rifle squads. */
const STEAMROLL: Foe[] = [...fog('ali_brute', 4), ...fog('ali_skitter', 4, 4)];

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

/** The units in production in its buildings of a kind, by kind. */
const queued = (g: Game, building?: string): string[] => g.state.buildings.filter((b) => b.owner === 0 && (!building || b.kind === building)).flatMap((b) => b.queue.map((q) => q.kind));
/** The structure its headquarters orders on one decision, or null. */
function structure(g: Game, who: AI, sight: Sight): string | null {
  const hq = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
  const c = look(g, who, sight).find((x): x is Extract<Command, { type: 'produce' }> => x.type === 'produce' && x.source === hq.id);
  return c?.kind ?? null;
}

describe('against crushers (AI-24)', () => {
  it('AI-24: it answers crushers once they make up a third of the enemy army seen, with three armed units seen, and stops only below a fifth', () => {
    const sees = (foes: Foe[], who = ai()): AI => {
      decide(base(), who, 1, 0, foes);
      return who;
    };
    // One Brute (830) and seven Spitters (1 540): crushers are 35% of it.
    expect(sees([...fog('ali_brute', 1), ...fog('ali_spitter', 7, 1)]).countering).toBe(true);
    // Eight Spitters: 32%, under a third.
    expect(sees([...fog('ali_brute', 1), ...fog('ali_spitter', 8, 1)]).countering).toBe(false);
    // Two Brutes are all crushers, but fewer than three armed units.
    expect(sees(fog('ali_brute', 2)).countering).toBe(false);
    expect(sees(fog('ali_brute', 3)).countering).toBe(true);
    // Once on, it stays on at 32% (above a fifth) and goes off at 19% (below a fifth).
    const who = sees([...fog('ali_brute', 1), ...fog('ali_spitter', 7, 1)]);
    expect(sees([...fog('ali_brute', 1), ...fog('ali_spitter', 8, 1)], who).countering).toBe(true);
    expect(sees([...fog('ali_brute', 1), ...fog('ali_spitter', 16, 1)], who).countering).toBe(false);
    // Off with the rule off.
    expect(sees(fog('ali_brute', 3), ai('balanced', { rules: { counterMix: false } })).countering).toBe(false);
  });

  it('AI-24: crushers alone before its artillery is available; then crushers first and artillery second, about 60 to 40 by cost, beyond the artillery cap', () => {
    const early = base({ factories: 5, barracks: 1 });
    decide(early, ai('balanced', { standingScout: false }), 10, 20000, STEAMROLL);
    const first = queued(early, 'hum_factory');
    expect(first.length).toBeGreaterThan(5);
    expect(new Set(first)).toEqual(new Set(['hum_tank']));

    const late = base({ factories: 5, barracks: 1, lab: true, turrets: 6 });
    decide(late, ai('balanced', { standingScout: false }), 12, 20000, STEAMROLL);
    const units = queued(late, 'hum_factory');
    const value = (kind: string): number => units.filter((k) => k === kind).length * unitDef(kind).cost;
    const art = value('hum_artillery');
    const tanks = value('hum_tank');
    expect(art / (art + tanks)).toBeGreaterThan(0.3);
    expect(art / (art + tanks)).toBeLessThan(0.5);
    expect(units.filter((k) => k === 'hum_artillery').length).toBeGreaterThan(2); // the cap of AI-22 does not apply
    expect(units.every((k) => ['hum_tank', 'hum_artillery', 'hum_paladin'].includes(k))).toBe(true);
  });

  it('AI-24: it trains no anti-armour squads and keeps only a rifle floor of two infantry squads; without the rule armour still brings anti-armour (AI-4)', () => {
    expect(COUNTER_RIFLES).toBe(2);
    const g = base({ barracks: 3, factories: 2, lab: true, turrets: 6 });
    decide(g, ai('balanced', { standingScout: false }), 10, 20000, STEAMROLL);
    expect(queued(g, 'hum_barracks')).toEqual(['hum_rifleman', 'hum_rifleman']);
    // Two rifle squads already in the field: the barracks stay idle.
    const full = base({ barracks: 3, factories: 2, lab: true, turrets: 6, army: ['hum_rifleman', 'hum_rifleman'] });
    decide(full, ai('balanced', { standingScout: false }), 10, 20000, STEAMROLL);
    expect(queued(full, 'hum_barracks')).toEqual([]);
    // Rule off: the same army seen brings anti-armour squads.
    const off = base({ barracks: 3, factories: 2, lab: true, turrets: 6 });
    decide(off, ai('balanced', { standingScout: false, rules: { counterMix: false } }), 10, 20000, [...fog('ali_brute', 6), ...fog('ali_skitter', 1, 6)]);
    expect(queued(off, 'hum_barracks')).toContain('hum_rocketeer');
  });

  it('AI-24: its hero comes as soon as it can afford it (HERO-1)', () => {
    const hero = unitDef('hum_paladin').cost;
    // Its headquarters busy, so no building takes the money first.
    const building = (gm: Game): Game => {
      gm.state.buildings.find((x) => x.owner === 0 && x.kind === 'hum_hq')!.queue.push({ kind: 'hum_reactor', cost: 300, progress: 2, total: 300, ready: false });
      return gm;
    };
    const g = building(base({ factories: 3, barracks: 2, lab: true, turrets: 6, busy: true }));
    decide(g, ai('balanced', { standingScout: false }), 1, hero, STEAMROLL);
    expect(queued(g, 'hum_factory')).toContain('hum_paladin');
    // Without crushers seen it keeps 400 to spare (HERO-1).
    const plain = building(base({ factories: 3, barracks: 2, lab: true, turrets: 6, busy: true }));
    decide(plain, ai('balanced', { standingScout: false }), 1, hero, fog('ali_spitter', 4));
    expect(queued(plain, 'hum_factory')).not.toContain('hum_paladin');
  });

  it('AI-24: barracks left idle by it do not hold back the growth rule, which then adds factories (AI-22)', () => {
    const idle = (): Game => {
      const g = base({ barracks: 2, factories: 3, lab: true, turrets: 6, busy: true, army: ['hum_rifleman', 'hum_rifleman'], credits: 2000 });
      for (const b of g.state.buildings) if (b.owner === 0 && b.kind === 'hum_barracks') b.queue.length = 0;
      return g;
    };
    expect(structure(idle(), ai(), STEAMROLL)).toBe('hum_factory');
    // Without it, idle barracks hold the rule back.
    expect(['hum_barracks', 'hum_factory']).not.toContain(structure(idle(), ai('balanced', { rules: { counterMix: false } }), STEAMROLL));
  });

  it("AI-24: seeing a steamroll ends Raider's opening at once (AI-16)", () => {
    const raider = ai('raider');
    decide(base(), raider, 1, 0, fog('ali_spitter', 4));
    expect(raider.plan).toBe('raider');
    decide(base(), raider, 1, 0, STEAMROLL);
    expect(raider.plan).toBe('balanced');
    // It stays adapted when the crushers are gone.
    expect(raider.plan).toBe('balanced');
  });
});

describe('squads scatter from crushers (AI-25)', () => {
  /** Rifle squads standing from (19,19), and a Brute it sees `d` tiles east of the first one. */
  const squads = ['hum_rifleman', 'hum_rifleman', 'hum_rifleman'];
  const brute = (g: Game, d: number): Foe[] => {
    const u = g.state.units.find((x) => x.owner === 0 && x.kind === 'hum_rifleman')!;
    return [{ kind: 'ali_brute', tx: Math.floor(u.x / FP + d), ty: Math.floor(u.y / FP) }];
  };
  const scatters = (log: readonly Command[]): Extract<Command, { type: 'scatter' }>[] => log.filter((c): c is Extract<Command, { type: 'scatter' }> => c.type === 'scatter');

  it('AI-25: squads within 3 tiles of a crusher it sees are told to scatter, at most once every 2 s; none farther off, and none with the rule off', () => {
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

  it('AI-25: a squad told to scatter keeps its wave membership, and the order comes out of the crush orders share of the command budget (BAL-5)', () => {
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
