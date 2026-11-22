import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, DIFFICULTIES, AI } from '../../src/ai/ai';
import { ballRadius, ballStragglers, CONCAVE_R, concaveSlots, isFrontLine, SLOT_SLACK, slotMoves, type FormUnit } from '../../src/ai/formation';
import { FP, type Command } from '../../src/sim';
import { ai, base, centreOf, LONG, many, MAP, run, runUntil, SEED, teleport, tile, type Foe } from './aiWaveBench';

/** Army ball and concave (AI-41, AI-42): the pure geometry in formation.ts and the AI on the wave bench (aiWaveBench.ts). */

const u = (id: number, kind: string, x: number, y: number): FormUnit => ({ id, kind, x, y });
const open = (): boolean => true;
/** How far a tile lies toward the enemy along the facing (+x here). */
const ahead = (t: { tx: number; ty: number }): number => t.tx + 0.5;

describe('army ball (AI-41)', () => {
  it('AI-41: a unit more than 4 + √n tiles from its group\'s centre is a straggler', () => {
    expect(ballRadius(9)).toBe(7);
    const group = [u(1, 'hum_tank', 10, 10), u(2, 'hum_tank', 11, 10), u(3, 'hum_tank', 10, 11), u(4, 'hum_tank', 11, 11), u(5, 'hum_tank', 20, 10)];
    // Centre (12.4, 10.4); the fifth is 7.6 tiles off, past 4 + √5 = 6.2.
    expect(ballStragglers(group)).toEqual([5]);
    expect(ballStragglers(group.slice(0, 4))).toEqual([]);
  });

  it('AI-41: units gathering at the staging point hold a ball: a straggler is moved back toward the group\'s centre', () => {
    const g = base({ army: many('hum_rifleman', 4) });
    const who = ai();
    // A big enemy army far off in the fog keeps it from attacking.
    const fog: Foe[] = [...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: 70 + (i % 4), ty: 40 + Math.floor(i / 4) }));
    run(g, who, 8, fog);
    const st = who.stagingPoint!;
    const ids = g.state.units.filter((x) => x.owner === 0 && x.kind === 'hum_rifleman').map((x) => x.id);
    // Three of them 3 tiles behind the staging point, one 6.4 tiles ahead of it (still within 7 of it).
    teleport(g, ids.slice(0, 3), st.tx - 3, st.ty);
    for (const x of g.state.units) if (ids.slice(1, 3).includes(x.id)) x.y += (ids.indexOf(x.id) === 1 ? 1 : -1) * FP;
    teleport(g, [ids[3]!], st.tx + 5, st.ty - 4);
    const log = run(g, who, 80, fog);
    const back = log.find((c) => c.type === 'move' && c.units.includes(ids[3]!));
    expect(back).toBeDefined();
    const c = centreOf(g, ids.slice(0, 3));
    if (back?.type === 'move') expect(Math.hypot(tile(back.x) - c.x, tile(back.y) - c.y)).toBeLessThan(3);
    expect(DEFAULT_RULES.formation).toBe(true);
  }, LONG);
});

describe('concave (AI-42)', () => {
  const army = [
    u(1, 'hum_rifleman', 9, 10),
    u(2, 'hum_tank', 8, 9),
    u(3, 'hum_rocketeer', 8, 11),
    u(4, 'hum_tank', 9, 12),
    u(5, 'hum_rifleman', 7, 10),
    u(6, 'hum_tank', 7, 8),
    u(7, 'hum_artillery', 6, 10),
  ];
  const anchor = { x: 12, y: 10 };
  const enemy = { x: 22, y: 10 };

  it('AI-42: heavy units take the front arc, infantry squads and artillery stand behind them, every unit in its own slot', () => {
    expect(['hum_tank', 'ali_brute', 'ali_skimmer', 'hum_paladin'].every(isFrontLine)).toBe(true);
    expect(['hum_rifleman', 'hum_rocketeer', 'hum_artillery', 'ali_spitter'].some(isFrontLine)).toBe(false);
    const slots = concaveSlots(army, anchor, enemy, open);
    expect(slots.size).toBe(army.length);
    const heavy = army.filter((x) => isFrontLine(x.kind)).map((x) => ahead(slots.get(x.id)!));
    const rest = army.filter((x) => !isFrontLine(x.kind)).map((x) => ahead(slots.get(x.id)!));
    expect(Math.min(...heavy)).toBeGreaterThan(Math.max(...rest) - 1);
    expect(heavy.reduce((a, b) => a + b, 0) / heavy.length).toBeGreaterThan(rest.reduce((a, b) => a + b, 0) / rest.length + 1);
    const keys = new Set([...slots.values()].map((t) => `${t.tx},${t.ty}`));
    expect(keys.size).toBe(army.length);
  });

  it('AI-42: the arc is centred on the line to the enemy with its ends bent toward it, and the ranged row behind is at least as wide', () => {
    const tanks = [...Array(7)].map((_, i) => u(i + 1, 'hum_tank', 10, 4 + 2 * i));
    const slots = concaveSlots(tanks, anchor, enemy, open);
    const t = [...slots.values()].sort((a, b) => a.ty - b.ty);
    const mid = t[3]!;
    // Ends forward of the middle; the arc straddles the line y = 10.
    expect(ahead(t[0]!)).toBeGreaterThan(ahead(mid));
    expect(ahead(t[6]!)).toBeGreaterThan(ahead(mid));
    expect(t[0]!.ty).toBeLessThan(10);
    expect(t[6]!.ty).toBeGreaterThan(10);
    // Units keep their order across the line, so no paths cross: the northernmost unit takes the northern end.
    expect(slots.get(1)).toEqual(t[0]);
    expect(slots.get(7)).toEqual(t[6]);
    const mixed = concaveSlots([...tanks.slice(0, 3), ...[...Array(6)].map((_, i) => u(20 + i, 'hum_rifleman', 6, 6 + i))], anchor, enemy, open);
    const span = (ids: number[]): number => Math.max(...ids.map((id) => mixed.get(id)!.ty)) - Math.min(...ids.map((id) => mixed.get(id)!.ty));
    expect(span([20, 21, 22, 23, 24, 25])).toBeGreaterThanOrEqual(span([1, 2, 3]));
  });

  it('AI-42: slots are deterministic, whatever order the units come in, and a blocked slot moves to the nearest open tile', () => {
    const a = concaveSlots(army, anchor, enemy, open);
    const b = concaveSlots([...army].reverse(), anchor, enemy, open);
    expect([...b.entries()].sort((x, y) => x[0] - y[0])).toEqual([...a.entries()].sort((x, y) => x[0] - y[0]));
    // A rock wall across the front row's line: no slot on it, each moved to an open tile near where it would be.
    const wall = (tx: number): boolean => tx !== 12;
    const c = concaveSlots(army, anchor, enemy, (tx) => wall(tx));
    for (const [id, t] of c) {
      expect(t.tx).not.toBe(12);
      const want = a.get(id)!;
      expect(Math.max(Math.abs(t.tx - want.tx), Math.abs(t.ty - want.ty))).toBeLessThanOrEqual(2);
    }
    expect(new Set([...c.values()].map((t) => `${t.tx},${t.ty}`)).size).toBe(army.length);
  });

  it('AI-42: only units more than 1.5 tiles off their slot are sent to it, farthest first, within the budget; one fighting near its slot is left alone', () => {
    expect(SLOT_SLACK).toBe(1.5);
    const slots = new Map([
      [1, { tx: 10, ty: 10 }],
      [2, { tx: 10, ty: 12 }],
      [3, { tx: 10, ty: 14 }],
      [4, { tx: 10, ty: 16 }],
    ]);
    const units = [
      { ...u(1, 'hum_tank', 10.5, 11), target: -1 }, // on its slot
      { ...u(2, 'hum_tank', 14.5, 12.5), target: -1 }, // 4 off
      { ...u(3, 'hum_tank', 18.5, 14.5), target: -1 }, // 8 off
      { ...u(4, 'hum_tank', 13.5, 16.5), target: 99 }, // 3 off but fighting
    ];
    expect(slotMoves(units, slots, 5).map((m) => m.id)).toEqual([3, 2]);
    expect(slotMoves(units, slots, 1).map((m) => m.id)).toEqual([3]);
    // Already heading to its slot: no new order.
    expect(slotMoves([{ ...units[2]!, dest: [10, 14] }], slots, 5)).toEqual([]);
  });

  it('AI-42: a wave that meets a known enemy force within 12 tiles forms a concave facing it, heavy units in front; with rules.formation off it does not', () => {
    const play = (formation: boolean) => {
      const g = base({ army: [...many('hum_tank', 4), ...many('hum_rifleman', 6)] });
      const who = new AI(0, 'human', DIFFICULTIES.hard, MAP, SEED, 'balanced', { rules: { twoScouts: false, formation } });
      const FAR: Foe = { kind: 'ali_skitter', tx: 80, ty: 20 };
      runUntil(g, who, 400, () => who.stats.waves > 0, [FAR]);
      const wave = [...who.waveState!.members];
      teleport(g, wave, 45, 45);
      for (const x of g.state.units) if (wave.includes(x.id)) {
        x.x += (wave.indexOf(x.id) % 4) * FP;
        x.y += Math.floor(wave.indexOf(x.id) / 4) * FP;
      }
      // Two Spitters a few tiles ahead along the diagonal: a weak force it can see, within CONCAVE_R.
      expect(CONCAVE_R).toBe(12);
      const foes: Foe[] = [FAR, { kind: 'ali_spitter', tx: 48, ty: 48 }, { kind: 'ali_spitter', tx: 49, ty: 48 }];
      const log = run(g, who, 80, foes);
      return { g, who, wave, log };
    };
    const on = play(true);
    const singles = on.log.filter((c): c is Extract<Command, { type: 'attackmove' }> => c.type === 'attackmove' && c.units.length === 1 && on.wave.includes(c.units[0]!));
    expect(singles.length).toBeGreaterThanOrEqual(5);
    const toward = (c: { x: number; y: number }): number => (tile(c.x) + tile(c.y)) / Math.SQRT2;
    const kindOf = (id: number): string => on.g.state.units.find((x) => x.id === id)?.kind ?? '';
    const tanks = singles.filter((c) => kindOf(c.units[0]!) === 'hum_tank').map(toward);
    const rifles = singles.filter((c) => kindOf(c.units[0]!) === 'hum_rifleman').map(toward);
    if (tanks.length > 0 && rifles.length > 0) expect(Math.max(...tanks)).toBeGreaterThan(Math.min(...rifles));
    const off = play(false);
    expect(off.log.some((c) => c.type === 'attackmove' && c.units.length === 1 && off.wave.includes(c.units[0]!))).toBe(false);
  }, LONG);
});
