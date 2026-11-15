import { describe, expect, it } from 'vitest';
import { AI, ARTILLERY_IN_PRODUCTION, DIFFICULTIES, GROWTH_BANK, GROWTH_MAX, LAB_FROM, QUEUE_DEEP, QUEUE_DEEP_BANK, QUEUE_SHALLOW, TURRETS_FROM, type AiRules, type Personality } from '../../src/ai/ai';
import { SteamrollAI } from '../../src/ai/steamroll';
import { unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Command, type Game } from '../../src/sim';

/**
 * Production first (AI-22): the build order, the growth rule, when turrets and the lab come, shallow queues and the
 * artillery cap, decided from a built-up human base on seed 6 (headquarters at 10,10 on a 96 by 96 map).
 */

interface Base {
  barracks?: number;
  factories?: number;
  refineries?: number;
  lab?: boolean;
  turrets?: number;
  haulers?: number;
  credits?: number;
  /** Every barracks and factory has a unit in production. */
  busy?: boolean;
  /** Game time (ticks); turrets are wanted from tick 3000 on. */
  tick?: number;
  /** Enemy tanks next to the base: an attack on it. */
  attacked?: boolean;
  /** Enemy rifle squads in sight, but away from the base, for the artillery floor (AI-19). */
  infantrySeen?: number;
  /** Power plants (eight unless given). */
  reactors?: number;
  /** Its own combat units, by kind, standing in the base. */
  army?: string[];
}

const HQ = { tx: 10, ty: 10 };

function base(o: Base = {}): Game {
  const cfg = skirmishConfig(6, { factions: ['human', 'alien'] });
  const spots = [...Array(40)].map((_, i) => ({ tx: 16 + (i % 8) * 4, ty: 4 + Math.floor(i / 8) * 4 }));
  let next = 0;
  const put = (kind: string, n: number) => [...Array(n)].map(() => ({ owner: 0, kind, ...spots[next++]! }));
  const buildings = [
    ...cfg.buildings!.filter((b) => b.owner !== 0),
    { owner: 0, kind: 'hum_hq', ...HQ },
    ...put('hum_reactor', o.reactors ?? 8),
    ...put('hum_refinery', o.refineries ?? 3),
    ...put('hum_barracks', o.barracks ?? 0),
    ...put('hum_factory', o.factories ?? 0),
    ...put('hum_lab', o.lab ? 1 : 0),
    ...put('hum_turret', o.turrets ?? 0),
  ];
  const units = [
    ...(cfg.units ?? []).filter((u) => u.owner !== 0),
    ...[...Array(o.haulers ?? 6)].map((_, i) => ({ owner: 0, kind: 'hum_hauler', tx: 12 + i, ty: 16 })),
    ...(o.army ?? []).map((kind, i) => ({ owner: 0, kind, tx: 8 + (i % 8), ty: 20 + Math.floor(i / 8) })),
    ...(o.attacked ? [0, 1, 2].map((i) => ({ owner: 1, kind: 'ali_brute', tx: 14 + i, ty: 14 })) : []),
    ...[...Array(o.infantrySeen ?? 0)].map((_, i) => ({ owner: 1, kind: 'ali_skitter', tx: 34 + (i % 4), ty: 36 + Math.floor(i / 4) })),
  ];
  const g = createGame({ ...cfg, players: [{ faction: 'human', credits: o.credits ?? 5000 }, cfg.players![1]!], buildings, units });
  g.state.tick = o.tick ?? 7000;
  if (o.busy) {
    for (const b of g.state.buildings) {
      if (b.owner !== 0 || (b.kind !== 'hum_barracks' && b.kind !== 'hum_factory')) continue;
      const kind = b.kind === 'hum_barracks' ? 'hum_rifleman' : 'hum_tank';
      b.queue.push({ kind, cost: unitDef(kind).cost, progress: 2, total: 1000, ready: false });
    }
  }
  return g;
}

const MAP = skirmishConfig(6, { factions: ['human', 'alien'] }).map;
const ai = (personality: Personality = 'balanced', rules?: Partial<AiRules>): AI => new AI(0, 'human', DIFFICULTIES.hard, MAP, 6, personality, { rules });

/** The structure the headquarters orders on one decision, or null. */
function hqOrder(g: Game, personality: Personality = 'balanced', rules?: Partial<AiRules>): string | null {
  const hq = g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_hq')!;
  const c = ai(personality, rules)
    .think(snapshot(g, 0))
    .find((x): x is Extract<Command, { type: 'produce' }> => x.type === 'produce' && x.source === hq.id);
  return c?.kind ?? null;
}

/** Decisions in a row (the clock barely moves, so nothing finishes), with the bank refilled each time. */
function decide(g: Game, who: AI, rounds: number, credits: number): void {
  for (let i = 0; i < rounds; i++) {
    g.state.players[0]!.credits = credits;
    for (const c of who.think(snapshot(g, 0))) submit(g, c);
    tick(g);
  }
}

const unitQueue = (g: Game, kind: string): number[] => g.state.buildings.filter((b) => b.owner === 0 && b.kind === kind).map((b) => b.queue.length);

describe('production first (AI-22)', () => {
  it('AI-22: after its first barracks, refineries and factory it builds a second factory, a second barracks and a third factory before the lab, any turret or the superweapon', () => {
    // Rich, late enough for turrets, with a lab already: production still comes first.
    expect(hqOrder(base({ barracks: 1, factories: 1, lab: true, credits: 20000 }))).toBe('hum_factory');
    expect(hqOrder(base({ barracks: 1, factories: 2, lab: true, credits: 20000 }))).toBe('hum_barracks');
    expect(hqOrder(base({ barracks: 2, factories: 2, lab: true, credits: 20000 }))).toBe('hum_factory');
    // Without a lab: no lab, turret or superweapon before the third factory either.
    for (const [b, f] of [
      [1, 1],
      [1, 2],
      [2, 2],
    ] as const) {
      expect(['hum_lab', 'hum_turret', 'hum_lance']).not.toContain(hqOrder(base({ barracks: b, factories: f, credits: 5000 })));
    }
    // With the five buildings, the lab comes.
    expect(hqOrder(base({ barracks: 2, factories: 3, credits: 2500 }))).toBe('hum_lab');
  });

  it('AI-22: the growth rule fires only when every barracks and factory is busy and more than 1 500 is banked, takes whichever it has fewer of (a factory on a tie), and stops at five of each', () => {
    expect(GROWTH_BANK).toBe(1500);
    expect(GROWTH_MAX).toBe(5);
    const grown = (o: Base): string | null => hqOrder(base({ lab: true, turrets: 6, ...o }));
    expect(grown({ barracks: 2, factories: 3, busy: true, credits: 2000 })).toBe('hum_barracks');
    expect(grown({ barracks: 3, factories: 3, busy: true, credits: 2000 })).toBe('hum_factory');
    expect(grown({ barracks: 4, factories: 3, busy: true, credits: 2000 })).toBe('hum_factory');
    expect(grown({ barracks: 5, factories: 4, busy: true, credits: 2000 })).toBe('hum_factory');
    expect(grown({ barracks: 3, factories: 5, busy: true, credits: 2000 })).toBe('hum_barracks');
    // Not with 1 500 banked or less, not with any one idle, not beyond five of each.
    const production = ['hum_barracks', 'hum_factory'];
    expect(production).not.toContain(grown({ barracks: 3, factories: 3, busy: true, credits: 1500 }));
    expect(production).not.toContain(grown({ barracks: 3, factories: 3, busy: false, credits: 2000 }));
    expect(production).not.toContain(grown({ barracks: 5, factories: 5, busy: true, credits: 2000 }));
    // Ahead of turrets, even after an attack on the base.
    expect(hqOrder(base({ barracks: 2, factories: 3, lab: true, busy: true, credits: 2000, attacked: true }))).toBe('hum_barracks');
  });

  it('AI-22: turrets wait until it has six production buildings or its base has been attacked', () => {
    expect(TURRETS_FROM).toBe(6);
    // Five production buildings, a lab, late in the game, with money: no turret.
    expect(hqOrder(base({ barracks: 2, factories: 3, lab: true, credits: 2500 }))).not.toBe('hum_turret');
    expect(hqOrder(base({ barracks: 3, factories: 3, lab: true, credits: 2500 }))).toBe('hum_turret');
    expect(hqOrder(base({ barracks: 2, factories: 3, lab: true, credits: 2500, attacked: true }))).toBe('hum_turret');
  });

  it('AI-22: its lab comes as soon as it has five production buildings, ahead of any further barracks or factory', () => {
    expect(LAB_FROM).toBe(5);
    expect(hqOrder(base({ barracks: 2, factories: 2, credits: 2500 }))).toBe('hum_factory');
    expect(hqOrder(base({ barracks: 2, factories: 3, credits: 2500 }))).toBe('hum_lab');
    // Every building busy with the bank full: the growth rule would add a barracks, but the lab comes first.
    expect(hqOrder(base({ barracks: 2, factories: 3, busy: true, credits: 2500 }))).toBe('hum_lab');
    expect(hqOrder(base({ barracks: 4, factories: 4, busy: true, credits: 2500 }))).toBe('hum_lab');
    // Power as needed first: short of power, the lab asks for a power plant.
    expect(hqOrder(base({ barracks: 2, factories: 3, busy: true, credits: 2500, reactors: 2 }))).toBe('hum_reactor');
  });

  it("AI-22: barracks Doomsday leaves idle on purpose (AI-15) do not hold back the growth rule: it adds factories", () => {
    // Four tanks, three more queued, and infantry beyond its cap (rifle floor plus three per tank): its barracks stay idle by its own rule.
    const army = [...[...Array(4)].map(() => 'hum_tank'), ...[...Array(26)].map(() => 'hum_rifleman')];
    const capped = (o: Base, idleFactory = false): Game => {
      const g = base({ barracks: 2, factories: 3, lab: true, turrets: 6, busy: true, army, ...o });
      for (const b of g.state.buildings) if (b.owner === 0 && b.kind === 'hum_barracks') b.queue.length = 0;
      if (idleFactory) g.state.buildings.find((b) => b.owner === 0 && b.kind === 'hum_factory')!.queue.length = 0;
      return g;
    };
    expect(hqOrder(capped({ credits: 2000 }), 'doomsday')).toBe('hum_factory');
    // Not with an idle factory, nor with 1 500 banked or less; and Balanced's idle barracks still hold the rule back.
    expect(hqOrder(capped({ credits: 2000 }, true), 'doomsday')).not.toBe('hum_factory');
    expect(hqOrder(capped({ credits: 1500 }), 'doomsday')).not.toBe('hum_factory');
    expect(['hum_barracks', 'hum_factory']).not.toContain(hqOrder(capped({ credits: 2000 }), 'balanced'));
  });

  it("AI-22: Doomsday builds its lab straight after its second factory, ahead of Balanced's", () => {
    expect(hqOrder(base({ barracks: 1, factories: 1, credits: 5000 }), 'doomsday')).toBe('hum_factory');
    expect(hqOrder(base({ barracks: 1, factories: 2, credits: 5000 }), 'doomsday')).toBe('hum_lab');
    expect(hqOrder(base({ barracks: 1, factories: 2, credits: 5000 }), 'balanced')).toBe('hum_barracks');
  });

  it('AI-22: Raider builds no lab, turret or superweapon in its opening', () => {
    for (const o of [
      { barracks: 2, factories: 3 },
      { barracks: 3, factories: 3, attacked: true },
      { barracks: 5, factories: 5, lab: true },
    ]) {
      expect(['hum_lab', 'hum_turret', 'hum_lance']).not.toContain(hqOrder(base({ ...o, credits: 20000 }), 'raider'));
    }
  });

  it('AI-22: queues stay shallow: two units deep in a building, three with more than 3 000 banked', () => {
    expect([QUEUE_SHALLOW, QUEUE_DEEP, QUEUE_DEEP_BANK]).toEqual([2, 3, 3000]);
    const shallow = base({ barracks: 2, factories: 3, lab: true, turrets: 6 });
    decide(shallow, ai(), 8, 2900);
    for (const n of unitQueue(shallow, 'hum_barracks')) expect(n).toBe(2);
    const deep = base({ barracks: 2, factories: 3, lab: true, turrets: 6 });
    decide(deep, ai(), 8, 20000);
    for (const n of unitQueue(deep, 'hum_barracks')) expect(n).toBe(3);
  });

  it('AI-22: at most two artillery pieces are in production at once', () => {
    expect(ARTILLERY_IN_PRODUCTION).toBe(2);
    const g = base({ barracks: 2, factories: 5, lab: true, turrets: 6, haulers: 8, infantrySeen: 24 });
    decide(g, ai(), 10, 20000);
    const art = g.state.buildings.filter((b) => b.owner === 0).flatMap((b) => b.queue.filter((q) => q.kind === 'hum_artillery')).length;
    expect(art).toBeGreaterThan(0); // the floor asks for artillery (AI-19) ...
    expect(art).toBeLessThanOrEqual(ARTILLERY_IN_PRODUCTION); // ... but no more than two at once
  });

  it('AI-22: fields and haulers are unchanged: a third refinery, never a fourth, and eight haulers at most', () => {
    expect(hqOrder(base({ barracks: 2, factories: 3, lab: true, refineries: 2, haulers: 4 }))).toBe('hum_refinery');
    expect(hqOrder(base({ barracks: 5, factories: 5, lab: true, turrets: 6, refineries: 3, credits: 20000 }))).not.toBe('hum_refinery');
    const haulersOrdered = (haulers: number): number => {
      const g = base({ barracks: 2, factories: 3, lab: true, turrets: 6, haulers });
      return ai()
        .think(snapshot(g, 0))
        .filter((c) => c.type === 'produce' && c.kind === 'hum_hauler').length;
    };
    expect(haulersOrdered(8)).toBe(0);
    expect(haulersOrdered(7)).toBeGreaterThan(0);
  });

  it('AI-22: the steamroll opponent keeps its own build and its deeper queues (HAR-5)', () => {
    // Rich, with one barracks and one factory: the ordinary AI would add its second factory; the steamroll opponent
    // follows its own order, and its queues go deeper than three.
    const g = base({ barracks: 1, factories: 1, haulers: 8 });
    const sr = new SteamrollAI(0, 'human', MAP, 6);
    decide(g, sr, 8, 20000);
    expect(Math.max(...unitQueue(g, 'hum_barracks'), ...unitQueue(g, 'hum_factory'))).toBeGreaterThan(QUEUE_DEEP);
  });

  describe('each rule switched off restores the behaviour before it (measurement only)', () => {
    it('AI-22: with labAt 99 the lab comes at five production buildings only once the growth rule has nothing to build', () => {
      const late = { labAt: 99 };
      expect(hqOrder(base({ barracks: 2, factories: 3, busy: true, credits: 2500 }), 'balanced', late)).toBe('hum_barracks');
      expect(hqOrder(base({ barracks: 4, factories: 4, busy: true, credits: 2500 }), 'balanced', late)).toBe('hum_factory');
      expect(hqOrder(base({ barracks: 2, factories: 3, credits: 2500 }), 'balanced', late)).toBe('hum_lab');
      expect(hqOrder(base({ barracks: 2, factories: 2, credits: 2500 }), 'balanced', late)).toBe('hum_factory');
    });

    it("AI-22: with doomFactories off Doomsday's idle barracks hold the growth rule back", () => {
      const army = [...[...Array(4)].map(() => 'hum_tank'), ...[...Array(26)].map(() => 'hum_rifleman')];
      const g = base({ barracks: 2, factories: 3, lab: true, turrets: 6, busy: true, army, credits: 2000 });
      for (const b of g.state.buildings) if (b.owner === 0 && b.kind === 'hum_barracks') b.queue.length = 0;
      expect(['hum_barracks', 'hum_factory']).not.toContain(hqOrder(g, 'doomsday', { doomFactories: false }));
    });

    it('AI-22: queueDepth, queueDepthRich and artilleryCap set the queue depths and the artillery cap', () => {
      const g = base({ barracks: 2, factories: 3, lab: true, turrets: 6 });
      decide(g, ai('balanced', { queueDepth: 4 }), 10, 2900);
      for (const n of unitQueue(g, 'hum_barracks')) expect(n).toBe(4);
      const rich = base({ barracks: 2, factories: 3, lab: true, turrets: 6 });
      decide(rich, ai('balanced', { queueDepthRich: 1 }), 8, 20000);
      for (const n of unitQueue(rich, 'hum_barracks')) expect(n).toBe(1);
      const guns = base({ barracks: 2, factories: 5, lab: true, turrets: 6, haulers: 8, infantrySeen: 24 });
      decide(guns, ai('balanced', { artilleryCap: 0 }), 10, 20000);
      expect(guns.state.buildings.filter((b) => b.owner === 0).flatMap((b) => b.queue.filter((q) => q.kind === 'hum_artillery'))).toHaveLength(0);
    });
  });
});
