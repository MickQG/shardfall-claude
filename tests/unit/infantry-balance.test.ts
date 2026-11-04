import { describe, expect, it } from 'vitest';
import { chooseUnitKind, CRUSH_OVERRUN, CRUSH_REACH, crushOrders, type Role } from '../../src/ai/ai';
import { soundFor } from '../../src/audio/plan';
import { UNIT_DEFS, unitDef } from '../../src/data/defs';
import { createGame, damageAgainst, FP, MAX_RANK, RANK_XP, snapshot, submit, tick, type Game, type SimEvent, type UnitSnap, type UnitSpawn } from '../../src/sim';
import { unitCards } from '../../src/ui/unitInfo';
import { mean, open, rounds } from './battle';

const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: open(30, 30), units });
const run = (g: Game, n: number, each?: (e: SimEvent) => void): void => {
  for (let i = 0; i < n; i++) {
    tick(g);
    if (each) for (const e of g.state.events) each(e);
  }
};
const unitAt = (g: Game, kind: string, owner = 0) => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;
const moveTo = (g: Game, owner: number, kind: string, tx: number, ty: number): void =>
  submit(g, { type: 'move', player: owner, units: [unitAt(g, kind, owner).id], x: tx * FP + FP / 2, y: ty * FP + FP / 2 });

describe('crushing', () => {
  it('BAL-1: a moving tank runs over an enemy squad in its path, killing the whole squad at once and earning its health as experience', () => {
    const g = game([
      { owner: 0, kind: 'hum_tank', tx: 5, ty: 10 },
      { owner: 1, kind: 'ali_spitter', tx: 9, ty: 10 },
    ]);
    const victim = unitAt(g, 'ali_spitter', 1);
    const hp = victim.hp;
    moveTo(g, 0, 'hum_tank', 14, 10);
    const crushed: SimEvent[] = [];
    run(g, 120, (e) => {
      if (e.t === 'die' && e.crushed) crushed.push(e);
    });
    expect(g.state.units.some((u) => u.id === victim.id)).toBe(false);
    expect(crushed).toHaveLength(1);
    expect(crushed[0]).toMatchObject({ id: victim.id, owner: 1, kind: 'ali_spitter', crushed: true });
    expect(unitAt(g, 'hum_tank').xp).toBeGreaterThanOrEqual(hp);
    expect(g.state.players[1]!.stats.unitsLost).toBe(1);
  });

  it('BAL-1: tanks, Brutes and both heroes crush; harvesters, artillery, scouts and infantry do not', () => {
    const crushers = Object.keys(UNIT_DEFS).filter((k) => unitDef(k).crusher);
    expect(crushers.sort()).toEqual(['ali_brute', 'ali_strider', 'hum_paladin', 'hum_tank']);
    const crushes = (kind: string, victim: string): boolean => {
      const g = game([
        { owner: 0, kind, tx: 5, ty: 10 },
        { owner: 1, kind: victim, tx: 9, ty: 10 },
      ]);
      moveTo(g, 0, kind, 14, 10);
      let n = 0;
      run(g, 160, (e) => {
        if (e.t === 'die' && e.crushed) n++;
      });
      return n > 0;
    };
    expect(crushes('ali_brute', 'hum_rifleman')).toBe(true);
    expect(crushes('hum_paladin', 'ali_skitter')).toBe(true);
    expect(crushes('hum_hauler', 'ali_skitter')).toBe(false);
    expect(crushes('hum_artillery', 'ali_skitter')).toBe(false);
    // Only infantry squads are crushed, not light vehicles or scouts.
    expect(crushes('hum_tank', 'ali_stalker')).toBe(false);
  });

  it('BAL-1: a crusher standing still crushes nothing, and its own squads are pushed aside, never crushed', () => {
    const g = game([
      { owner: 0, kind: 'hum_tank', tx: 10, ty: 10 },
      { owner: 1, kind: 'ali_skitter', tx: 10, ty: 10 },
    ]);
    let n = 0;
    run(g, 40, (e) => {
      if (e.t === 'die' && e.crushed) n++;
    });
    expect(n).toBe(0);

    const own = game([
      { owner: 0, kind: 'hum_tank', tx: 5, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 9, ty: 10 },
    ]);
    moveTo(own, 0, 'hum_tank', 14, 10);
    run(own, 160);
    expect(own.state.units.filter((u) => u.kind === 'hum_rifleman')).toHaveLength(1);
  });

  it('BAL-1: crushing is deterministic', () => {
    const play = (): number[] => {
      const g = game([
        { owner: 0, kind: 'hum_tank', tx: 5, ty: 10 },
        { owner: 1, kind: 'ali_spitter', tx: 9, ty: 10 },
        { owner: 1, kind: 'ali_spitter', tx: 10, ty: 11 },
      ]);
      moveTo(g, 0, 'hum_tank', 14, 10);
      const ticks: number[] = [];
      for (let i = 0; i < 160; i++) {
        tick(g);
        if (g.state.events.some((e) => e.t === 'die' && e.crushed)) ticks.push(i);
      }
      return ticks;
    };
    expect(play()).toEqual(play());
  });

  it('BAL-2: a crushed squad says so in its death event and crunches instead of popping', () => {
    const e: SimEvent = { t: 'die', x: 0, y: 0, big: false, owner: 1, id: 7, kind: 'ali_skitter', crushed: true };
    expect(soundFor(e, 0).name).toBe('crunch');
    expect(soundFor({ ...e, crushed: undefined }, 0).name).toBe('pop');
  });

  it('BAL-2: the 3D effects flatten the squad with dust for Aegis and ichor for Vrax', async () => {
    const THREE = await import('three');
    const { CombatFx } = await import('../../src/render3d/fx3d');
    expect(typeof CombatFx.prototype.crushed).toBe('function');
    const fx = new CombatFx();
    expect(() => {
      fx.crushed(new THREE.Vector3(1, 0, 1), false, 0);
      fx.crushed(new THREE.Vector3(2, 0, 2), true, 0);
      fx.update(100, 0.1);
    }).not.toThrow();
  });
});

describe('infantry damage and armour', () => {
  it('BAL-3: infantry hits less hard, tanks stay weak against light armour, and small raiders are weak against tanks', () => {
    const dmg = (k: string): number => unitDef(k).weapon!.damage;
    expect([dmg('hum_rocketeer'), dmg('ali_spitter'), dmg('hum_rifleman'), dmg('ali_skitter')]).toEqual([38, 30, 7, 7]);
    // Rocket damage (anti-armour infantry, tanks, heroes) does little to light armour.
    expect(damageAgainst({ damage: 100, type: 'rocket' }, 'light')).toBe(45);
    expect(damageAgainst({ damage: 100, type: 'rocket' }, 'heavy')).toBe(150);
    // Skitterers and Stalkers bite: deadly to infantry, weak against armour, like the Rifleman's rifle.
    expect(unitDef('ali_skitter').weapon!.type).toBe('bite');
    expect(unitDef('ali_stalker').weapon!.type).toBe('bite');
    expect(damageAgainst({ damage: 100, type: 'bite' }, 'light')).toBe(110);
    expect(damageAgainst({ damage: 100, type: 'bite' }, 'heavy')).toBe(40);
    expect(damageAgainst({ damage: 100, type: 'bite' }, 'air')).toBe(0);
    // Per credit, a Skitterer squad now hurts a tank about as little as a Rifleman squad does.
    const perCredit = (k: string): number => (damageAgainst(unitDef(k).weapon!, 'heavy') * 20) / unitDef(k).weapon!.cooldown / unitDef(k).cost;
    expect(perCredit('ali_skitter')).toBeLessThan(perCredit('hum_rocketeer') * 0.6);
    expect(perCredit('hum_rifleman')).toBeLessThan(perCredit('hum_rocketeer') * 0.6);
    expect(unitDef('ali_brute').hp).toBe(620);
    expect(damageAgainst({ damage: 100, type: 'claw' }, 'heavy')).toBe(80);
  });
});

describe('straight shells', () => {
  it('BAL-4: tank and hero shells fly flat and faster; artillery still lobs; infantry rockets keep a small arc', async () => {
    const { LOOKS } = await import('../../src/render3d/fx3d');
    for (const look of ['cannon', 'heroCannon', 'heroAcid'] as const) expect(LOOKS[look].arc).toBe(0);
    for (const look of ['howitzer', 'acidBig'] as const) expect(LOOKS[look].arc).toBeGreaterThan(0.3);
    for (const look of ['rocket', 'acid'] as const) expect(LOOKS[look].arc).toBeGreaterThan(0);
    expect(unitDef('hum_tank').weapon!.flight).toBe(3);
    expect(unitDef('hum_paladin').weapon!.flight).toBe(5);
    expect(unitDef('ali_strider').weapon!.flight).toBe(5);
    expect(unitDef('hum_artillery').weapon!.indirect).toBe(true);
    expect(unitDef('ali_lobber').weapon!.indirect).toBe(true);
  });
});

describe('the AI crushes', () => {
  const snap = (over: Partial<UnitSnap>): UnitSnap => ({ rank: 0, target: -1, id: 1, owner: 0, kind: 'hum_tank', x: 10 * FP, y: 10 * FP, hp: 550, dest: null, load: 0, ...over });

  it('BAL-5: a healthy crusher drives through enemy infantry within reach, to a point just beyond it', () => {
    const tank = snap({ id: 1 });
    const squad = snap({ id: 9, owner: 1, kind: 'ali_spitter', x: 14 * FP, y: 10 * FP, hp: 82 });
    const orders = crushOrders(0, [tank], [squad], 40, 40);
    expect(orders).toEqual([{ type: 'move', player: 0, units: [1], x: Math.round(14 * FP + CRUSH_OVERRUN * FP), y: 10 * FP }]);
    // Out of reach, a vehicle (not a squad), a battered crusher, or a unit that does not crush: no order.
    expect(crushOrders(0, [tank], [snap({ ...squad, x: (10 + CRUSH_REACH + 1) * FP })], 40, 40)).toEqual([]);
    expect(crushOrders(0, [tank], [snap({ id: 9, owner: 1, kind: 'ali_brute', x: 12 * FP })], 40, 40)).toEqual([]);
    expect(crushOrders(0, [snap({ id: 1, hp: 100 })], [squad], 40, 40)).toEqual([]);
    expect(crushOrders(0, [snap({ id: 1, kind: 'hum_artillery', hp: 250 })], [squad], 40, 40)).toEqual([]);
  });

  it('BAL-5: in a match the AI sends its crushers through enemy infantry', async () => {
    const { AI, DIFFICULTIES } = await import('../../src/ai/ai');
    const g = createGame({
      seed: 2,
      map: open(40, 40),
      buildings: [
        { owner: 0, kind: 'hum_hq', tx: 2, ty: 2 },
        { owner: 1, kind: 'ali_hq', tx: 34, ty: 34 },
      ],
      units: [
        { owner: 0, kind: 'hum_tank', tx: 15, ty: 15 },
        { owner: 1, kind: 'ali_skitter', tx: 19, ty: 16 },
      ],
    });
    const ai = new AI(0, 'human', DIFFICULTIES.hard, g.state.cfg.map, 1);
    let crushed = 0;
    for (let t = 0; t < 400 && crushed === 0; t++) {
      if (t % 10 === 0) for (const c of ai.think(snapshot(g, 0))) submit(g, c);
      tick(g);
      for (const e of g.state.events) if (e.t === 'die' && e.crushed) crushed++;
    }
    expect(crushed).toBe(1);
  });

  it('BAL-6: against an infantry-heavy enemy the AI builds tanks and rifles rather than more anti-armour', () => {
    const cands = ['hum_rifleman', 'hum_rocketeer', 'hum_tank'];
    const counts: Record<Role, number> = { inf: 3, at: 2, tank: 2, art: 0, air: 0, scout: 1 };
    const pickMany = (squads: number): string[] => {
      const c = { ...counts };
      const out: string[] = [];
      for (let i = 0; i < 10; i++) {
        const k = chooseUnitKind(cands, c, { air: 0, heavy: 1 - squads, light: squads, squads, total: 10 })!;
        out.push(k);
        const r: Role = k === 'hum_tank' ? 'tank' : k === 'hum_rocketeer' ? 'at' : 'inf';
        c[r]++;
      }
      return out;
    };
    const share = (list: string[], k: string): number => list.filter((x) => x === k).length;
    const infantryHeavy = pickMany(0.9);
    const balanced = pickMany(0.3);
    expect(share(infantryHeavy, 'hum_tank')).toBeGreaterThan(share(balanced, 'hum_tank'));
    expect(share(infantryHeavy, 'hum_rocketeer')).toBeLessThan(share(balanced, 'hum_rocketeer'));
  });
});

describe('elite shots', () => {
  it('BAL-7: a top-rank unit fires elite shots; lower ranks do not', () => {
    const shotsBy = (rank: number): SimEvent[] => {
      const g = game([
        { owner: 0, kind: 'hum_rifleman', tx: 10, ty: 10 },
        { owner: 1, kind: 'ali_brute', tx: 13, ty: 10 },
      ]);
      const u = unitAt(g, 'hum_rifleman');
      u.rank = rank;
      u.xp = rank > 0 ? (RANK_XP[rank - 1] as number) * unitDef(u.kind).cost : 0;
      const out: SimEvent[] = [];
      run(g, 40, (e) => {
        if (e.t === 'shot' && e.src === u.id) out.push(e);
      });
      return out;
    };
    const elite = shotsBy(MAX_RANK);
    expect(elite.length).toBeGreaterThan(0);
    expect(elite.every((e) => e.t === 'shot' && e.elite === true)).toBe(true);
    expect(shotsBy(MAX_RANK - 1).every((e) => e.t === 'shot' && !e.elite)).toBe(true);
  });

  it('BAL-7: elite shots have a colour of their own in both renderers', async () => {
    const { ELITE_SHOT, LOOKS } = await import('../../src/render3d/fx3d');
    for (const L of Object.values(LOOKS)) expect(L.color).not.toBe(ELITE_SHOT);
    const { ELITE_SHOT_2D } = await import('../../src/render/effects');
    expect(ELITE_SHOT_2D).toBe(ELITE_SHOT);
  });
});

describe('heavier heroes', () => {
  it('BAL-8: both heroes move at 24, as slow as artillery, and read as Slow; their stride follows distance walked', async () => {
    expect(unitDef('hum_paladin').speed).toBe(24);
    expect(unitDef('ali_strider').speed).toBe(24);
    expect(unitDef('hum_paladin').speed).toBe(unitDef('hum_artillery').speed);
    expect(unitCards('human').find((c) => c.kind === 'hum_paladin')!.speed).toBe('Slow');
    expect(unitCards('alien').find((c) => c.kind === 'ali_strider')!.speed).toBe('Slow');
    const { gaitPhase } = await import('../../src/render3d/motion');
    // The gait advances with distance, not time: a slower walker steps proportionally slower.
    expect(gaitPhase(1, 2)).toBeCloseTo(gaitPhase(2, 4));
  });
});

describe('infantry spam no longer wins', () => {
  it('BAL-9: pure anti-armour spam loses to a mixed army of the same faction, with squads crushed', () => {
    for (const [mixed, spam] of [
      [{ hum_tank: 1, hum_rifleman: 3 }, { hum_rocketeer: 1 }],
      [{ ali_brute: 1, ali_skitter: 4 }, { ali_spitter: 1 }],
    ] as const) {
      const rs = rounds(mixed, spam, true);
      expect(mean(rs, 'margin')).toBeGreaterThan(25);
      expect(mean(rs, 'crushed')).toBeGreaterThan(0);
    }
  }, 120_000);

  it('BAL-9: pure anti-armour infantry still beats pure crushers, but only narrowly', () => {
    const margins: number[] = [];
    for (const crusher of ['hum_tank', 'ali_brute'])
      for (const at of ['hum_rocketeer', 'ali_spitter']) {
        const rs = rounds({ [crusher]: 1 }, { [at]: 1 }, true);
        margins.push(mean(rs, 'margin'));
        // The crushers always take most of the infantry down with them.
        expect(mean(rs, 'bLost')).toBeGreaterThanOrEqual(60);
      }
    const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
    expect(avg).toBeLessThan(0);
    expect(avg).toBeGreaterThan(-30);
  }, 120_000);
});
