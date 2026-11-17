import { describe, expect, it } from 'vitest';
import { AI, BALL_AWAY, BALL_RAID_SHARE, CHASE_PATIENCE, CHASE_SEEN, DEFAULT_RULES, DIFFICULTIES, HOLD_BACK, MELEE_RANGE, SCREEN_PER, type AiRules } from '../../src/ai/ai';
import { KITE_GAP, KITE_ORDERS, KITE_STEP, kiteOrders, STEAMROLL_PRESETS, STEAMROLL_TUNING, TANKSPAM } from '../../src/ai/steamroll';
import { UNIT_DEFS, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type Command, type Game, type UnitSnap } from '../../src/sim';
import { variant } from '../matches/variant';

/**
 * The answer to tank spam (AI-30, AI-31, AI-33) and the tank-spam opponent's kiting (HAR-7). A Vrax base (player 0) on
 * seed 6; the enemy units it sees are put into its own snapshot, so each test controls exactly what it knows.
 */

const CFG = skirmishConfig(6, { factions: ['alien', 'human'] });
const LONG = 120_000;

/** A Vrax base with a Spine Spire at 24,24 and its army, by kind, standing round 30,30, and a Stalker at home. */
function vrax(army: string[], credits = 0): Game {
  const own = (kind: string, tx: number, ty: number) => ({ owner: 0, kind, tx, ty });
  const buildings = [
    ...CFG.buildings!.filter((b) => b.owner !== 0),
    own('ali_hq', 10, 10),
    ...[2, 5, 8, 11, 14].map((x) => own('ali_generator', x, 2)),
    own('ali_extractor', 14, 10),
    own('ali_nest', 2, 8),
    own('ali_pit', 14, 5),
    own('ali_pit', 18, 5),
    own('ali_spire', 24, 24),
  ];
  // A Stalker at home: its standing scout (AI-21), so no unit of the army is sent scouting (AI-17).
  const units = [...(CFG.units ?? []).filter((u) => u.owner !== 0), own('ali_stalker', 12, 16), ...army.map((kind, i) => own(kind, 30 + (i % 4), 30 + Math.floor(i / 4)))];
  const g = createGame({ ...CFG, players: [{ faction: 'alien', credits }, CFG.players![1]!], buildings, units });
  g.state.tick = 6000;
  return g;
}

interface Foe {
  kind: string;
  x: number;
  y: number;
}
/** One decision with these enemy units seen (each keeps its id by its place in the list). */
function look(g: Game, ai: AI, foes: Foe[]): Command[] {
  const s = snapshot(g, 0);
  s.units.push(...foes.map((f, i): UnitSnap => ({ id: 900000 + i, owner: 1, kind: f.kind, x: Math.round(f.x * FP), y: Math.round(f.y * FP), hp: unitDef(f.kind).hp, dest: null, load: 0, rank: 0, target: -1 })));
  const cmds = ai.think(s);
  for (const c of cmds) submit(g, c);
  for (let i = 0; i < ai.diff.thinkEvery; i++) tick(g);
  return cmds;
}
const vraxAi = (rules?: Partial<AiRules>): AI => new AI(0, 'alien', DIFFICULTIES.hard, CFG.map, 6, 'balanced', { rules: { twoScouts: false, ...rules } });
const ids = (g: Game, kind: string): number[] => g.state.units.filter((u) => u.owner === 0 && u.kind === kind).map((u) => u.id);
const tanks = (n: number, x: number, y: number): Foe[] => [...Array(n)].map((_, i) => ({ kind: 'hum_tank', x: x + (i % 2), y: y + Math.floor(i / 2) }));

describe('the answer to tank spam', () => {
  it('AI-30: against mostly heavy armour, a Brute that has chased faster armour moving away for three seconds stops: it falls back to its Spine Spire', () => {
    expect([MELEE_RANGE, CHASE_SEEN, HOLD_BACK, CHASE_PATIENCE]).toEqual([3, 10, 100, 60]);
    expect(DEFAULT_RULES.noChase).toBe(true);
    expect(unitDef('hum_tank').speed).toBeGreaterThan(unitDef('ali_brute').speed);
    const g = vrax(['ali_brute', 'ali_brute']);
    const ai = vraxAi();
    const brutes = ids(g, 'ali_brute');
    // Tanks eight tiles off, moving away.
    const b = g.state.units.find((u) => u.id === brutes[0])!;
    const x0 = b.x / FP;
    const y0 = b.y / FP;
    // Moving away for CHASE_PATIENCE ticks (a decision every 8): not yet held before that.
    const cmds: Command[] = [];
    for (let k = 0; k <= CHASE_PATIENCE / 8 + 3; k++) {
      const out = look(g, ai, tanks(4, x0 + 8 + 0.6 * k, y0));
      if (k < CHASE_PATIENCE / 8) expect(ai.stats.heldBack).toBe(0);
      cmds.push(...out);
    }
    const back = cmds.find((c) => c.type === 'move' && brutes.every((id) => c.units.includes(id)));
    expect(back).toBeDefined();
    // Beside the spire, on its side toward the headquarters.
    expect(back && back.type === 'move' ? Math.hypot(back.x / FP - 24.5, back.y / FP - 24.5) : Infinity).toBeLessThan(3);
    expect(ai.stats.heldBack).toBeGreaterThanOrEqual(2);
  });

  it('AI-30: it holds no Brute back from armour standing still or closing in, from armour in its reach, against an enemy that is not mostly armour, or with rules.noChase off', () => {
    const run = (foes: (bx: number, by: number, k: number) => Foe[], rules?: Partial<AiRules>): number => {
      const g = vrax(['ali_brute']);
      const ai = vraxAi(rules);
      const b = g.state.units.find((u) => u.owner === 0 && u.kind === 'ali_brute')!;
      const x0 = b.x / FP;
      const y0 = b.y / FP;
      for (let k = 0; k < 14; k++) look(g, ai, foes(x0, y0, k));
      return ai.stats.heldBack;
    };
    // Moving away: held (the case above), as a check of this bench.
    expect(run((x, y, k) => tanks(2, x + 8 + 0.6 * k, y))).toBeGreaterThan(0);
    expect(run((x, y) => tanks(2, x + 7, y))).toBe(0);
    expect(run((x, y, k) => tanks(2, x + 20 - 1.2 * k, y))).toBe(0);
    // Turning away for a moment and back: no hold.
    expect(run((x, y, k) => tanks(2, x + 8 + (k % 4 < 2 ? 0.6 : 0), y))).toBe(0);
    // A tank in its reach where it stands: it fights.
    const g = vrax(['ali_brute']);
    const ai = vraxAi();
    const b = g.state.units.find((u) => u.owner === 0 && u.kind === 'ali_brute')!;
    for (let k = 0; k < 12; k++) look(g, ai, [...tanks(2, 50 + k, 50), { kind: 'hum_tank', x: b.x / FP + 1.5, y: b.y / FP }]);
    expect(ai.stats.heldBack).toBe(0);
    expect(run((x, y, k) => [...tanks(1, x + 8 + 0.6 * k, y), ...[...Array(6)].map((_, i) => ({ kind: 'hum_rocketeer', x: x + 20, y: y + i }))])).toBe(0);
    expect(run((x, y, k) => tanks(2, x + 8 + 0.6 * k, y), { noChase: false })).toBe(0);
  });

  it('AI-31: with rules.ballRaid, while the enemy armour is away from its base, fast units go for its economy as a hit squad, and a threat to the base does not call them home', () => {
    expect([BALL_AWAY, BALL_RAID_SHARE]).toEqual([20, 0.25]);
    // Off by default: measured, it did not help (see the spec); rules.ballRaid switches it on.
    expect(DEFAULT_RULES.ballRaid).toBe(false);
    const army = [...Array(8)].map(() => 'ali_skitter').concat(['ali_brute', 'ali_brute', 'ali_spitter', 'ali_spitter']);
    // Armour seen far from the enemy base (its start, 83,83, read off the map).
    const g = vrax(army);
    const ai = vraxAi({ ballRaid: true });
    look(g, ai, tanks(4, 40, 40));
    const hit = ai.groupState.filter((s) => s.kind === 'hit');
    expect(hit).toHaveLength(1);
    expect(ai.stats.ballRaids).toBe(1);
    const skitters = ids(g, 'ali_skitter');
    expect(hit[0]!.members.every((id) => skitters.includes(id))).toBe(true);
    expect(hit[0]!.members.length).toBeGreaterThanOrEqual(3);
    // Within a quarter of the army's value.
    const value = (k: string): number => unitDef(k).cost;
    expect(hit[0]!.members.length * value('ali_skitter')).toBeLessThanOrEqual(BALL_RAID_SHARE * army.reduce((s, k) => s + value(k), 0) + 1);
    // The armour at its base: the squad carries on.
    look(g, ai, tanks(4, 16, 16));
    expect(ai.groupState.filter((s) => s.kind === 'hit')).toHaveLength(1);
  });

  it('AI-31: no such hit squad while the armour is at home, when the enemy is not mostly armour, or with rules.ballRaid off', () => {
    const army = [...Array(8)].map(() => 'ali_skitter').concat(['ali_brute', 'ali_brute']);
    const sent = (foes: Foe[], rules?: Partial<AiRules>): number => {
      const g = vrax(army);
      const ai = vraxAi({ ballRaid: true, ...rules });
      look(g, ai, foes);
      return ai.stats.ballRaids;
    };
    expect(sent(tanks(4, 40, 40))).toBe(1);
    expect(sent(tanks(4, 76, 76))).toBe(0);
    expect(sent([...tanks(1, 40, 40), ...[...Array(8)].map((_, i) => ({ kind: 'hum_rocketeer', x: 40 + i, y: 44 }))])).toBe(0);
    expect(sent(tanks(4, 40, 40), { ballRaid: false })).toBe(0);
  });

  it('AI-33: with rules.screen, against mostly heavy armour, its Brood Pits keep one Brute for every three Skimmers beside them', () => {
    expect(SCREEN_PER).toBe(3);
    // Off by default: measured, it did not help (see the spec); rules.screen switches it on.
    expect(DEFAULT_RULES.screen).toBe(false);
    const pitOrders = (rules?: Partial<AiRules>): string[] => {
      const g = vrax([], 20000);
      const ai = vraxAi(rules);
      const pits = new Set(g.state.buildings.filter((b) => b.owner === 0 && b.kind === 'ali_pit').map((b) => b.id));
      const out: string[] = [];
      for (let i = 0; i < 30; i++) {
        g.state.players[0]!.credits = 20000;
        for (const c of look(g, ai, tanks(6, 60, 60))) if (c.type === 'produce' && pits.has(c.source) && UNIT_DEFS[c.kind]) out.push(c.kind);
      }
      return out;
    };
    const on = pitOrders({ screen: true });
    const skim = on.filter((k) => k === 'ali_skimmer').length;
    const brutes = on.filter((k) => k === 'ali_brute').length;
    expect(skim).toBeGreaterThan(brutes);
    expect(brutes).toBeGreaterThanOrEqual(Math.floor(skim / SCREEN_PER) - 1);
    expect(brutes).toBeLessThanOrEqual(Math.floor(skim / SCREEN_PER) + 1);
    expect(pitOrders({ screen: false }).filter((k) => k === 'ali_brute')).toHaveLength(0);
  }, LONG);
});

describe('the tank-spam opponent (HAR-7)', () => {
  it('HAR-7: is a named steamroll variant: one barracks, crushers that kite, home fields only, shallow queues, and Field Menders only when asked for', () => {
    expect(STEAMROLL_PRESETS.tankspam).toBe(TANKSPAM);
    expect(TANKSPAM).toEqual({ tankspam: 1, kite: 1, menders: 0, barracks: 1, crushers: 12, queue: 2, fields: 2 });
    expect([STEAMROLL_TUNING.tankspam, STEAMROLL_TUNING.kite, STEAMROLL_TUNING.menders, STEAMROLL_TUNING.queue]).toEqual([0, 0, 1, 0]);
    expect(variant('tankspam')).toEqual(TANKSPAM);
    expect(variant('tankspam,menders:1')).toEqual({ ...TANKSPAM, menders: 1 });
    expect(() => variant('tankspam,nonsense:1')).toThrow();
  });

  it('HAR-7: its crushers back off from armour they outrange and cannot crush, stay to crush squads, and stand against what outranges them', () => {
    expect([KITE_GAP, KITE_STEP, KITE_ORDERS]).toEqual([3, 3, 6]);
    const at = (id: number, owner: number, kind: string, x: number, y: number): UnitSnap => ({ id, owner, kind, x: x * FP, y: y * FP, hp: unitDef(kind).hp, dest: null, load: 0, rank: 0, target: -1 });
    const tank = at(1, 1, 'hum_tank', 40.5, 40.5);
    // A Brute 3 tiles off: straight away from it, KITE_STEP tiles.
    const o = kiteOrders(1, [tank, at(2, 0, 'ali_brute', 43.5, 40.5)], CFG.map);
    expect(o).toHaveLength(1);
    const m = o[0]!;
    expect(m.type === 'move' && m.units).toEqual([1]);
    if (m.type === 'move') expect(m.x / FP).toBeLessThan(40.5 - KITE_STEP + 1);
    // Beyond the Brute's reach plus KITE_GAP: it fights.
    expect(kiteOrders(1, [tank, at(2, 0, 'ali_brute', 46.5, 40.5)], CFG.map)).toHaveLength(0);
    // A squad it can run over, and a Skimmer that outranges it: no kiting.
    expect(kiteOrders(1, [tank, at(2, 0, 'ali_skitter', 41.5, 40.5)], CFG.map)).toHaveLength(0);
    expect(kiteOrders(1, [tank, at(2, 0, 'ali_skimmer', 42.5, 40.5)], CFG.map)).toHaveLength(0);
    // At most KITE_ORDERS, the nearest threats first.
    const many = [...Array(8)].map((_, i) => at(10 + i, 1, 'hum_tank', 10.5 + 10 * i, 60.5));
    const brutes = many.map((t, i) => at(30 + i, 0, 'ali_brute', t.x / FP + 1 + 0.2 * i, 60.5));
    const all = kiteOrders(1, [...many, ...brutes], CFG.map);
    expect(all).toHaveLength(KITE_ORDERS);
    expect(all.map((c) => (c.type === 'move' ? c.units[0] : -1)).slice(0, 4)).toEqual([10, 11, 12, 13]);
  });
});
