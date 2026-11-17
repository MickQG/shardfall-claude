import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, HOLD_REACH, RESPONSE_LEASH, type AiRules } from '../../src/ai/ai';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSnap, type Command, type Game } from '../../src/sim';
import { addUnit } from '../../src/sim/state';

/**
 * Standing units answer an attack as a group (AI-34). Decided from a small human base on seed 6 (headquarters at 10,10,
 * the enemy's at 83,83 on a 96 by 96 map), with no credits so it builds and trains nothing, its army standing at its
 * staging point (about 19 to 21 tiles out along the diagonal), more than 16 tiles from its buildings so the base defence
 * (AI-7) is not called. A big enemy army it has seen far off in the fog keeps it from attacking. Attackers are added to
 * its snapshot ("sightings") and its units are hurt by hand, except in the test with a real attacker.
 */

const LONG = 60_000;

const CFG = skirmishConfig(6, { factions: ['human', 'alien'] });
const MAP = CFG.map;
const HQ = { tx: 10, ty: 10 };

const atStage = (i: number): [number, number] => [19 + (i % 3), 19 + Math.floor(i / 3)];

function base(army: string[], tickAt = 3000): Game {
  const own = (kind: string, [tx, ty]: [number, number]) => ({ owner: 0, kind, tx, ty });
  const buildings = [
    ...CFG.buildings!.filter((b) => b.owner !== 0),
    { owner: 0, kind: 'hum_hq', ...HQ },
    own('hum_reactor', [10, 14]),
    own('hum_refinery', [14, 10]),
    own('hum_barracks', [2, 8]),
    own('hum_factory', [14, 6]),
  ];
  const units = [...(CFG.units ?? []).filter((u) => u.owner !== 0), ...army.map((kind, i) => ({ owner: 0, kind, tx: atStage(i)[0], ty: atStage(i)[1] }))];
  const g = createGame({ ...CFG, players: [{ faction: 'human', credits: 0 }, CFG.players![1]!], buildings, units });
  g.state.tick = tickAt;
  return g;
}

/** The rule is measured and kept switched off (AI-34): these tests switch it on unless told otherwise. */
const ai = (rules?: Partial<AiRules>): AI => new AI(0, 'human', DIFFICULTIES.hard, MAP, 6, 'balanced', { rules: { groupResponse: true, ...rules }, standingScout: false });
const many = (kind: string, n: number): string[] => [...Array(n)].map(() => kind);

interface Foe {
  kind: string;
  tx: number;
  ty: number;
}
type Sight = Foe[] | ((g: Game) => Foe[]);

const enemyHq = (g: Game): BuildingSnap[] => {
  const b = g.state.buildings.find((x) => x.owner === 1 && buildingDef(x.kind).hq);
  if (!b) return [];
  return [{ id: b.id, owner: 1, kind: b.kind, tx: b.tx, ty: b.ty, hp: b.hp, queue: [], repairing: false, rally: null, charge: 0 }];
};

function look(g: Game, who: AI, sight: Sight = []): Command[] {
  const s = snapshot(g, 0);
  const foes = typeof sight === 'function' ? sight(g) : sight;
  s.units.push(...foes.map((f, i) => ({ id: 900000 + i, owner: 1, kind: f.kind, x: f.tx * FP + FP / 2, y: f.ty * FP + FP / 2, hp: unitDef(f.kind).hp, dest: null, load: 0, rank: 0, target: -1 })));
  if (!s.buildings.some((b) => b.owner === 1) && s.ghosts.length === 0) s.ghosts.push(...enemyHq(g));
  return who.think(s);
}

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

/** A big enemy army seen far off in the fog (ids after the attackers'): it keeps the AI from setting out on a wave. */
const FOG: Foe[] = [...Array(8)].map((_, i) => ({ kind: 'ali_brute', tx: 70 + (i % 4), ty: 40 + Math.floor(i / 4) }));
const with_ = (attackers: Foe[]): Foe[] => [...attackers, ...FOG];

const tile = (v: number): number => v / FP;
const armyIds = (g: Game): number[] => g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon).map((u) => u.id);
const hurt = (g: Game, id: number, n = 20): void => {
  const u = g.state.units.find((x) => x.id === id)!;
  u.hp -= n;
};
const orders = (log: readonly Command[], type: Command['type'], ids: readonly number[]) => log.filter((c): c is Extract<Command, { type: 'move' | 'attackmove' }> => c.type === type && ids.every((id) => (c as { units: number[] }).units.includes(id)));
const toBase = (g: Game, x: number, y: number): number =>
  Math.min(
    ...g.state.buildings
      .filter((b) => b.owner === 0)
      .map((b) => {
        const d = buildingDef(b.kind);
        return Math.hypot(Math.max(b.tx - x, 0, x - (b.tx + d.w)), Math.max(b.ty - y, 0, y - (b.ty + d.h)));
      }),
  );

/** A base with this army standing at its staging point; one decision so it knows its units' health. */
function standing(army: string[], rules?: Partial<AiRules>, sight: Sight = FOG): { g: Game; who: AI; ids: number[] } {
  const g = base(army);
  const who = ai(rules);
  run(g, who, 8, sight);
  expect(who.stats.waves).toBe(0);
  return { g, who, ids: armyIds(g) };
}

describe('standing units answer an attack as a group (AI-34)', () => {
  it('AI-34: a small attacking force: the whole group nearby counter-attacks together, toward the attackers', () => {
    const { g, who, ids } = standing(many('hum_rifleman', 6));
    // One Spitter (220) against six rifle squads (600): it hits the first.
    const attackers = with_([{ kind: 'ali_spitter', tx: 26, ty: 23 }]);
    hurt(g, ids[2]!);
    const log = run(g, who, 8, attackers);
    const sent = orders(log, 'attackmove', ids);
    expect(sent.length).toBe(1);
    expect(Math.hypot(tile(sent[0]!.x) - 26.5, tile(sent[0]!.y) - 23.5)).toBeLessThanOrEqual(1);
    expect(who.stats.counters).toBe(1);
    expect(who.responseState).toEqual([expect.objectContaining({ mode: 'counter', members: expect.arrayContaining(ids) })]);
  });

  it('AI-34: a counter-attack goes back to where the group stood once the attackers are gone, and never past its leash', () => {
    const { g, who, ids } = standing(many('hum_rifleman', 6));
    // A Spitter 9 tiles off the group's middle: the counter-attack stops RESPONSE_LEASH tiles out, toward it.
    hurt(g, ids[2]!);
    const log = run(g, who, 8, with_([{ kind: 'ali_spitter', tx: 29, ty: 21 }]));
    const home = who.responseState[0]!.home;
    const sent = orders(log, 'attackmove', ids)[0]!;
    expect(Math.hypot(tile(sent.x) - home.x, tile(sent.y) - home.y)).toBeLessThanOrEqual(RESPONSE_LEASH + 1);
    // The attacker is gone: the group moves back to where it stood.
    const back = run(g, who, 16, FOG);
    const home2 = orders(back, 'move', ids);
    expect(home2.length).toBe(1);
    expect(Math.hypot(tile(home2[0]!.x) - home.x, tile(home2[0]!.y) - home.y)).toBeLessThanOrEqual(1);
    expect(who.responseState).toEqual([]);
  }, LONG);

  it('AI-34: a large attacking force the group can outrun: it retreats to its base, not toward the attackers', () => {
    // Three Bulwarks (2400, speed 42) hit by four Brutes (3320, speed 38).
    const { g, who, ids } = standing(many('hum_tank', 3));
    const brutes = with_([{ kind: 'ali_brute', tx: 24, ty: 24 }, { kind: 'ali_brute', tx: 25, ty: 24 }, { kind: 'ali_brute', tx: 24, ty: 25 }, { kind: 'ali_brute', tx: 25, ty: 25 }]);
    hurt(g, ids[0]!, 60);
    const log = run(g, who, 8, brutes);
    expect(orders(log, 'attackmove', ids)).toEqual([]);
    const away = orders(log, 'move', ids);
    expect(away.length).toBe(1);
    const x = tile(away[0]!.x);
    const y = tile(away[0]!.y);
    expect(toBase(g, x, y)).toBeLessThanOrEqual(HOLD_REACH + 1);
    expect(Math.hypot(x - 24.5, y - 24.5)).toBeGreaterThan(Math.hypot(20 - 24.5, 19.5 - 24.5));
    expect(who.stats.withdrawals).toBe(1);
    expect(who.stats.counters).toBe(0);
    // It stays away: no order of the army's (gathering) sends it back meanwhile.
    const later = run(g, who, 150, brutes);
    expect(later.some((c) => c.type !== 'scatter' && 'units' in c && c.units.some((id) => ids.includes(id)))).toBe(false);
  }, LONG);

  it('AI-34: a large attacking force the group cannot outrun: it stands and fights together', () => {
    // Six rifle squads (600, speed 28) hit by four Spitters (880, speed 29): running only gets them shot in the back.
    const { g, who, ids } = standing(many('hum_rifleman', 6));
    const spitters = with_([{ kind: 'ali_spitter', tx: 26, ty: 22 }, { kind: 'ali_spitter', tx: 26, ty: 23 }, { kind: 'ali_spitter', tx: 27, ty: 22 }, { kind: 'ali_spitter', tx: 27, ty: 23 }]);
    hurt(g, ids[2]!);
    const log = run(g, who, 8, spitters);
    expect(orders(log, 'move', ids)).toEqual([]);
    expect(orders(log, 'attackmove', ids).length).toBe(1);
    expect(who.stats.counters).toBe(1);
    expect(who.stats.withdrawals).toBe(0);
  });

  it('AI-34: units out on a wave are unaffected', () => {
    // Six Bulwarks set out against a weak enemy seen far off (as in AI-23's tests).
    const g = base(many('hum_tank', 6));
    const who = ai();
    const FAR: Foe = { kind: 'ali_skitter', tx: 80, ty: 20 };
    run(g, who, 24 + 200, [FAR]);
    expect(who.stats.waves).toBe(1);
    const wave = [...who.waveState!.members];
    hurt(g, wave[0]!, 60);
    const u = g.state.units.find((x) => x.id === wave[0])!;
    run(g, who, 8, [FAR, { kind: 'ali_skitter', tx: Math.floor(tile(u.x)) + 3, ty: Math.floor(tile(u.y)) }]);
    expect(who.stats.counters + who.stats.withdrawals).toBe(0);
    expect(who.responseState).toEqual([]);
  }, LONG);

  it('AI-34: the base defence answers a threat near its buildings; no group answers meanwhile', () => {
    const { g, who, ids } = standing(many('hum_rifleman', 6));
    hurt(g, ids[2]!);
    // Spitters by its refinery: the base defence (AI-7) pulls the army to them.
    run(g, who, 8, with_([{ kind: 'ali_spitter', tx: 18, ty: 14 }, { kind: 'ali_spitter', tx: 19, ty: 14 }]));
    expect(who.stats.defends).toBe(1);
    expect(who.stats.counters + who.stats.withdrawals).toBe(0);
  });

  it('AI-34: no unit chases alone: a real attacker out of the group\'s reach draws the whole group, not just the unit it hits', () => {
    const play = (rules?: Partial<AiRules>): { moved: number; ids: number[] } => {
      const { g, who, ids } = standing(many('hum_rifleman', 6), rules);
      const start = new Map(g.state.units.filter((u) => ids.includes(u.id)).map((u) => [u.id, { x: u.x, y: u.y }]));
      // A Glare Skimmer (range 8) 6.5 tiles past the front column, out of the reach of the squads behind it, fires at the
      // front squad.
      const front = g.state.units.find((u) => u.id === ids[2])!;
      const sx = front.x + Math.round(6.5 * FP);
      const sy = front.y;
      const sk = addUnit(g.state, 1, 'ali_skimmer', sx, sy);
      submit(g, { type: 'attack', player: 1, units: [sk.id], target: front.id });
      // It must not walk off: hold it where it is after each step. Which squads went out, at any time.
      const out = new Set<number>();
      for (let i = 0; i < 160; i++) {
        run(g, who, 1, FOG);
        sk.x = sx;
        sk.y = sy;
        sk.path = [];
        for (const u of g.state.units) {
          const s = start.get(u.id);
          if (s && Math.hypot(u.x - s.x, u.y - s.y) > 1.5 * FP) out.add(u.id);
        }
      }
      return { moved: out.size, ids };
    };
    // Without the rule only the squad it hits goes for it (the simulation's retaliation); with it, all of them.
    expect(play({ groupResponse: false }).moved).toBeLessThanOrEqual(2);
    expect(play().moved).toBeGreaterThanOrEqual(5);
  }, LONG);
});
