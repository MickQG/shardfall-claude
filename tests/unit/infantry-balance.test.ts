import { describe, expect, it } from 'vitest';
import { chooseUnitKind, CRUSH_OVERRUN, CRUSH_REACH, crushOrders, type Role } from '../../src/ai/ai';
import { soundFor } from '../../src/audio/plan';
import { BUILDING_DEFS, canCrush, DAMAGE_PCT, UNIT_DEFS, unitDef } from '../../src/data/defs';
import { createGame, damageAgainst, FP, MAX_RANK, RANK_XP, snapshot, submit, tick, type Game, type SimEvent, type UnitSnap, type UnitSpawn } from '../../src/sim';
import { unitCards } from '../../src/ui/unitInfo';
import { defenceCost, mean, open, rounds, siege } from './battle';

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

describe('heroes crush vehicles', () => {
  const crushes = (kind: string, victim: string): boolean => {
    const g = game([
      { owner: 0, kind, tx: 5, ty: 10 },
      { owner: 1, kind: victim, tx: 9, ty: 10 },
    ]);
    moveTo(g, 0, kind, 14, 10);
    let n = 0;
    run(g, 240, (e) => {
      if (e.t === 'die' && e.crushed && e.kind === victim) n++;
    });
    return n > 0;
  };

  it('BAL-10: a moving hero runs over any enemy ground unit (tanks, Brutes, artillery, harvesters, scouts) but never another hero', () => {
    for (const hero of ['hum_paladin', 'ali_strider']) {
      const foe = hero === 'hum_paladin' ? ['ali_brute', 'ali_lobber', 'ali_gorger', 'ali_stalker'] : ['hum_tank', 'hum_artillery', 'hum_hauler'];
      for (const v of foe) expect(crushes(hero, v), `${hero} over ${v}`).toBe(true);
      expect(crushes(hero, hero === 'hum_paladin' ? 'ali_strider' : 'hum_paladin'), `${hero} over a hero`).toBe(false);
    }
    // Tanks and Brutes still crush infantry only.
    expect(crushes('hum_tank', 'ali_brute')).toBe(false);
    expect(crushes('ali_brute', 'hum_artillery')).toBe(false);
  });

  it('BAL-10: other heroes (and any aircraft) are never crushable, and a crushed vehicle dies big, earning the hero its health as experience', () => {
    for (const a of Object.keys(UNIT_DEFS).filter((k) => unitDef(k).air)) expect(canCrush('hum_paladin', a)).toBe(false);
    expect(canCrush('hum_paladin', 'ali_strider')).toBe(false);
    expect(canCrush('hum_paladin', 'ali_brute')).toBe(true);
    expect(canCrush('hum_tank', 'ali_brute')).toBe(false);
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 5, ty: 10 },
      { owner: 1, kind: 'ali_lobber', tx: 9, ty: 10 },
    ]);
    const hp = unitAt(g, 'ali_lobber', 1).hp;
    moveTo(g, 0, 'hum_paladin', 14, 10);
    const dead: SimEvent[] = [];
    run(g, 240, (e) => {
      if (e.t === 'die' && e.crushed) dead.push(e);
    });
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ kind: 'ali_lobber', big: true });
    expect(unitAt(g, 'hum_paladin').xp).toBeGreaterThanOrEqual(hp);
  });

  it('BAL-10: the AI drives its hero over a nearby enemy vehicle, but not over the enemy hero', () => {
    const hero: UnitSnap = { rank: 0, target: -1, id: 1, owner: 0, kind: 'hum_paladin', x: 10 * FP, y: 10 * FP, hp: 3000, dest: null, load: 0 };
    const brute: UnitSnap = { ...hero, id: 9, owner: 1, kind: 'ali_brute', x: 13 * FP, hp: 620 };
    expect(crushOrders(0, [hero], [brute], 40, 40)).toHaveLength(1);
    expect(crushOrders(0, [hero], [{ ...brute, kind: 'ali_strider', hp: 3000 }], 40, 40)).toEqual([]);
  });

  it('BAL-11: a crusher on a move order keeps firing at enemies in range without stopping; other units hold fire on the move', () => {
    const fires = (kind: string): { shots: number; moved: boolean } => {
      const g = game([
        { owner: 0, kind, tx: 3, ty: 4 },
        { owner: 1, kind: 'ali_skitter', tx: 8, ty: 9 },
      ]);
      const u = unitAt(g, kind);
      const x0 = u.x;
      moveTo(g, 0, kind, 20, 4);
      let shots = 0;
      run(g, 60, (e) => {
        if (e.t === 'shot' && e.owner === 0) shots++;
      });
      return { shots, moved: unitAt(g, kind).x > x0 + 2 * FP };
    };
    expect(fires('hum_tank')).toMatchObject({ moved: true });
    expect(fires('hum_tank').shots).toBeGreaterThan(0);
    expect(fires('hum_rocketeer')).toEqual({ shots: 0, moved: true });
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
  }, 30_000);
});

describe('heavier heroes', () => {
  it('BAL-8: both heroes move at 20, slower than artillery, and read as Slow; their stride follows distance walked', async () => {
    expect(unitDef('hum_paladin').speed).toBe(20);
    expect(unitDef('ali_strider').speed).toBe(20);
    expect(unitDef('hum_paladin').speed).toBeLessThan(unitDef('hum_artillery').speed);
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

  it('BAL-9: pure anti-armour infantry and pure crushers trade about evenly', () => {
    const margins: number[] = [];
    for (const crusher of ['hum_tank', 'ali_brute'])
      for (const at of ['hum_rocketeer', 'ali_spitter']) {
        const rs = rounds({ [crusher]: 1 }, { [at]: 1 }, true);
        margins.push(mean(rs, 'margin'));
        // The crushers always take most of the infantry down with them.
        expect(mean(rs, 'bLost')).toBeGreaterThanOrEqual(60);
      }
    const avg = margins.reduce((s, m) => s + m, 0) / margins.length;
    expect(Math.abs(avg)).toBeLessThan(15);
  }, 120_000);
});

describe('unit speeds', () => {
  it('BAL-12: tanks outpace infantry; scouts > Skitterer > tanks > line infantry > artillery > heroes', () => {
    const s = (k: string) => unitDef(k).speed;
    const scouts = ['hum_buggy', 'ali_stalker'];
    const tanks = ['hum_tank', 'ali_brute'];
    const line = ['hum_rifleman', 'hum_rocketeer', 'ali_spitter'];
    const artillery = ['hum_artillery', 'ali_lobber'];
    const heroes = ['hum_paladin', 'ali_strider'];
    const order = [scouts, ['ali_skitter'], tanks, line, artillery, heroes];
    for (let i = 0; i + 1 < order.length; i++) {
      expect(Math.min(...order[i]!.map(s))).toBeGreaterThan(Math.max(...order[i + 1]!.map(s)));
    }
    // A tank is at least a quarter faster than any line infantry squad.
    expect(Math.min(...tanks.map(s)) * 4).toBeGreaterThanOrEqual(Math.max(...line.map(s)) * 5);
    // Every infantry squad but the Skitterer is slower than every tank.
    const squads = Object.keys(UNIT_DEFS).filter((k) => (UNIT_DEFS[k]!.squad ?? 1) > 1 && k !== 'ali_skitter');
    for (const q of squads) for (const t of tanks) expect(s(q)).toBeLessThan(s(t));
  });
});

describe('Vrax speed', () => {
  it('BAL-14: the Vrax Hive is a little slower, Skitterers a little tougher; the Brute, Gorger and Dreadstrider are unchanged', () => {
    const s = (k: string) => unitDef(k).speed;
    expect([s('ali_skitter'), s('ali_spitter'), s('ali_stalker'), s('ali_lobber')]).toEqual([47, 29, 86, 25]);
    expect(unitDef('ali_skitter').hp).toBe(77);
    expect([s('ali_brute'), s('ali_gorger'), s('ali_strider')]).toEqual([38, 34, 20]);
  });
});

describe('heroes as meat shields', () => {
  type Spawn = [kind: string, n: number];
  /** Player 1's force attack-moves into player 0, who holds still; returns ticks until `watch` dies and the value player 0's `back` units lost (%). */
  const stand = (hero: string | null, back: Spawn | null, enemy: Spawn): { lived: number; backLost: number } => {
    const units: UnitSpawn[] = [];
    if (hero) units.push({ owner: 0, kind: hero, tx: 15, ty: 22 });
    if (back) for (let i = 0; i < back[1]; i++) units.push({ owner: 0, kind: back[0], tx: 10, ty: 19 + i * 2 });
    for (let i = 0; i < enemy[1]; i++) units.push({ owner: 1, kind: enemy[0], tx: 34 + (i % 3), ty: 18 + Math.floor(i / 3) * 2 });
    const g = createGame({ seed: 1, map: open(48, 48), units });
    const ids = (p: number): number[] => g.state.units.filter((u) => u.owner === p).map((u) => u.id);
    submit(g, { type: 'attackmove', player: 1, units: ids(1), x: 4 * FP, y: 22 * FP });
    let lived = -1;
    for (let t = 0; t < 20 * 240 && ids(0).length && ids(1).length; t++) {
      tick(g);
      if (hero && lived < 0 && !g.state.units.some((u) => u.kind === hero)) lived = t;
    }
    const v = back ? g.state.units.filter((u) => u.owner === 0 && u.kind === back[0]).reduce((s, u) => s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp, 0) : 0;
    return { lived: lived < 0 ? 20 * 240 : lived, backLost: back ? 100 * (1 - v / (unitDef(back[0]).cost * back[1])) : 0 };
  };
  /** The same fight with a hero's old stats (3000 hit points, 110 damage), restored afterwards. */
  const asBefore = <T,>(hero: string, f: () => T): T => {
    const d = UNIT_DEFS[hero]!;
    const [hp, dmg] = [d.hp, d.weapon!.damage];
    d.hp = 3000;
    d.weapon!.damage = 110;
    try {
      return f();
    } finally {
      d.hp = hp;
      d.weapon!.damage = dmg;
    }
  };

  it('BAL-15: heroes have 4500 hit points and the cannon hits for 90 (80 for the Paladin, HERO-8); a hero in front keeps a line of artillery almost unharmed', () => {
    for (const kind of ['hum_paladin', 'ali_strider']) {
      expect(unitDef(kind).hp).toBe(4500);
      expect(unitDef(kind).weapon!.damage).toBe(kind === 'hum_paladin' ? 80 : 90);
      expect(unitDef(kind).cost).toBe(2000);
      expect(unitDef(kind).speed).toBe(20);
    }
    for (const [hero, back, enemy] of [
      ['hum_paladin', ['hum_artillery', 3], ['ali_brute', 9]],
      ['ali_strider', ['ali_lobber', 3], ['hum_tank', 9]],
      ['hum_paladin', ['hum_artillery', 3], ['ali_spitter', 15]],
      ['ali_strider', ['ali_lobber', 3], ['hum_rocketeer', 15]],
    ] as [string, Spawn, Spawn][]) {
      expect(stand(hero, back, enemy).backLost, `${hero} shields against ${enemy[0]}`).toBeLessThanOrEqual(10);
      expect(stand(null, back, enemy).backLost, `unshielded against ${enemy[0]}`).toBeGreaterThanOrEqual(90);
    }
  }, 300_000);

  it('BAL-15: a lone hero lasts at least a fifth longer than before against a fixed force, and 30% longer on average', () => {
    const gains: number[] = [];
    for (const [hero, enemy] of [
      ['hum_paladin', ['ali_brute', 9]],
      ['ali_strider', ['hum_tank', 9]],
      ['hum_paladin', ['ali_spitter', 20]],
      ['ali_strider', ['hum_rocketeer', 18]],
    ] as [string, Spawn][]) {
      const now = stand(hero, null, enemy).lived;
      const before = asBefore(hero, () => stand(hero, null, enemy).lived);
      expect(now, `${hero} against ${enemy[0]}`).toBeGreaterThanOrEqual(before * 1.2);
      gains.push(now / before);
    }
    // Measured: 1.26 to 1.39, 1.32 on average. Against eighteen or nineteen Spitter squads a Paladin now survives with the
    // old stats too (it no longer stutters while they chase it, SIM-10), so twenty is the smallest force that still tells.
    expect(gains.reduce((a, b) => a + b, 0) / gains.length).toBeGreaterThanOrEqual(1.3);
  }, 300_000);
});

describe('defences', () => {
  it('BAL-13: a lone powered defence holds against twice its cost of any one early attacker, and falls to four times its cost', () => {
    for (const [defence, attackers] of [
      ['hum_turret', ['ali_skitter', 'ali_spitter', 'ali_brute']],
      ['ali_spire', ['hum_rifleman', 'hum_rocketeer', 'hum_tank']],
    ] as const) {
      for (const a of attackers) {
        expect(siege(defence, a, 2 * defenceCost(defence)).stands, `${defence} vs 2x ${a}`).toBe(true);
        expect(siege(defence, a, 4 * defenceCost(defence)).stands, `${defence} vs 4x ${a}`).toBe(false);
      }
    }
    expect(BUILDING_DEFS.hum_turret!.weapon!.type).toBe('beam');
    expect(DAMAGE_PCT.beam.heavy).toBe(100);
  }, 120_000);
});
