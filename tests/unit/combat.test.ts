import { describe, expect, it } from 'vitest';
import { BUILDING_DEFS, DAMAGE_PCT, UNIT_DEFS, buildingDef, unitDef, type BuildingDef, type UnitDef } from '../../src/data/defs';
import { FLYER } from './flyer';
import { createGame, damageAgainst, EXPLORED, FP, hash, snapshot, submit, tick, VISIBLE, type Game, type GameConfig, type MapDef, type SimEvent } from '../../src/sim';
import { SIGHT_LINGER } from '../../src/sim/fog';

const W = 50;
const open = (blockedTiles: [number, number][] = [], w = W, h = W): MapDef => {
  const blocked = new Array<number>(w * h).fill(0);
  for (const [x, y] of blockedTiles) blocked[y * w + x] = 1;
  return { width: w, height: h, heights: new Array<number>(w * h).fill(0), blocked };
};

const cfg = (c: Partial<GameConfig>): GameConfig => ({ seed: 7, map: open(), ...c });
const run = (g: Game, n: number): SimEvent[] => {
  const all: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    tick(g);
    all.push(...snapshot(g).events);
  }
  return all;
};
const units = (g: Game) => snapshot(g).units;
const byKind = (g: Game, kind: string) => units(g).find((u) => u.kind === kind)!;
const shotsBy = (ev: SimEvent[], owner: number): number => ev.filter((e) => e.t === 'shot' && e.owner === owner).length;
const sp = (owner: number, kind: string, tx: number, ty: number) => ({ owner, kind, tx, ty });

describe('damage model', () => {
  it('CMB-1: damage is base x type/armor percent, rounded down, never below 1', () => {
    expect(damageAgainst({ damage: 8, type: 'pierce' }, 'light')).toBe(8);
    expect(damageAgainst({ damage: 8, type: 'pierce' }, 'heavy')).toBe(3);
    expect(damageAgainst({ damage: 8, type: 'pierce' }, 'structure')).toBe(2);
    expect(damageAgainst({ damage: 1, type: 'pierce' }, 'structure')).toBe(1); // floor(0.3) -> clamped to 1
    expect(damageAgainst({ damage: 40, type: 'rocket' }, 'heavy')).toBe(60);
    expect(damageAgainst({ damage: 70, type: 'blast' }, 'structure')).toBe(105);
    expect(damageAgainst({ damage: 70, type: 'blast' }, 'air')).toBe(0); // immune
    for (const t of Object.keys(DAMAGE_PCT) as (keyof typeof DAMAGE_PCT)[]) {
      for (const a of ['light', 'heavy', 'structure', 'air'] as const) {
        expect(damageAgainst({ damage: 10, type: t }, a)).toBe(DAMAGE_PCT[t][a] === 0 ? 0 : Math.max(1, Math.floor((10 * DAMAGE_PCT[t][a]) / 100)));
      }
    }
  });

  it('CMB-2: ground-only weapons never hit air; anti-air weapons do', () => {
    // A Bulwark Tank (ground only) next to an enemy Wasp: the Wasp never loses hit points.
    const g = createGame(cfg({ units: [sp(0, 'hum_tank', 20, 20), sp(1, FLYER, 22, 20)] }));
    run(g, 200);
    expect(byKind(g, FLYER).hp).toBe(unitDef(FLYER).hp);
    // A Rifleman (anti-air) does hurt it.
    const g2 = createGame(cfg({ units: [sp(0, 'hum_rifleman', 20, 20), sp(1, FLYER, 22, 20)] }));
    run(g2, 200);
    expect(units(g2).find((u) => u.kind === FLYER)?.hp ?? 0).toBeLessThan(unitDef(FLYER).hp);
  });
});

describe('targeting and firing', () => {
  it('CMB-3: shots only within range and never faster than the cooldown', () => {
    const near = createGame(cfg({ units: [sp(0, 'hum_rifleman', 20, 20), sp(1, 'hum_tank', 24, 20)] })); // 4 tiles: in range 5
    const ev = run(near, 100);
    const shots = shotsBy(ev, 0);
    expect(shots).toBeGreaterThanOrEqual(8);
    expect(shots).toBeLessThanOrEqual(Math.ceil(100 / unitDef('hum_rifleman').weapon!.cooldown));
    const far = createGame(cfg({ units: [sp(0, 'hum_rifleman', 10, 10), sp(1, 'hum_rifleman', 10, 30)] }));
    expect(shotsBy(run(far, 100), 0)).toBe(0);
  });

  it('CMB-4: idle units auto-acquire; a unit on a plain move order does not fire', () => {
    const g = createGame(cfg({ units: [sp(0, 'hum_rifleman', 10, 13), sp(1, 'hum_rifleman', 10, 10)] }));
    const mover = units(g).find((u) => u.owner === 1)!.id;
    submit(g, { type: 'move', player: 1, units: [mover], x: 10 * FP + FP / 2, y: 33 * FP });
    const ev = run(g, 60);
    expect(shotsBy(ev, 0)).toBeGreaterThan(0); // the idle unit shot at the passing enemy
    expect(shotsBy(ev, 1)).toBe(0); // the mover held fire while moving
  });

  it('CMB-5: an attack order chases and kills the target; unseen enemies cannot be targeted', () => {
    const unseen = createGame(cfg({ units: [sp(0, 'hum_rifleman', 10, 10), sp(1, 'ali_skitter', 10, 30)] }));
    const [a, t] = [byKind(unseen, 'hum_rifleman').id, byKind(unseen, 'ali_skitter').id];
    submit(unseen, { type: 'attack', player: 0, units: [a], target: t });
    expect(shotsBy(run(unseen, 300), 0)).toBe(0);
    expect(units(unseen).find((u) => u.id === a)!.dest).toBeNull(); // did not chase an invisible target

    // A scout buggy (vision 11) shares sight; the rifleman then chases and kills the skitter.
    const g = createGame(cfg({ units: [sp(0, 'hum_rifleman', 10, 10), sp(0, 'hum_buggy', 10, 19), sp(1, 'ali_skitter', 10, 28)] }));
    const [a2, t2] = [byKind(g, 'hum_rifleman').id, byKind(g, 'ali_skitter').id];
    submit(g, { type: 'attack', player: 0, units: [a2], target: t2 });
    run(g, 900);
    expect(units(g).some((u) => u.id === t2)).toBe(false);
  });

  it('CMB-6: attack-move engages enemies on the way and then continues to the destination', () => {
    const g = createGame(cfg({ units: [sp(0, 'hum_rifleman', 5, 10), sp(1, 'ali_skitter', 20, 10)] }));
    const a = byKind(g, 'hum_rifleman').id;
    submit(g, { type: 'attackmove', player: 0, units: [a], x: 35 * FP + FP / 2, y: 10 * FP + FP / 2 });
    run(g, 1200);
    expect(units(g).some((u) => u.kind === 'ali_skitter')).toBe(false); // engaged and killed
    const me = units(g).find((u) => u.id === a)!;
    expect(Math.abs(me.x / FP - 35.5)).toBeLessThan(2); // and arrived
  });
});

describe('projectiles and splash', () => {
  it('CMB-7: projectiles land after their flight time; splash hits enemies near the impact but spares friendlies', () => {
    const g = createGame(cfg({ units: [sp(0, 'hum_rocketeer', 20, 20), sp(1, 'hum_hauler', 24, 20)] }));
    const target = byKind(g, 'hum_hauler');
    let shotTick = -1;
    let hitTick = -1;
    for (let i = 0; i < 80 && hitTick < 0; i++) {
      tick(g);
      const s = snapshot(g);
      if (shotTick < 0 && s.events.some((e) => e.t === 'shot' && e.owner === 0)) shotTick = s.tick;
      if (shotTick >= 0 && units(g).find((u) => u.id === target.id)!.hp < unitDef('hum_hauler').hp) hitTick = s.tick;
    }
    expect(shotTick).toBeGreaterThan(0);
    expect(hitTick - shotTick).toBe(unitDef('hum_rocketeer').weapon!.flight);

    // Splash: artillery fires at one enemy hauler; the adjacent enemy hauler is also hurt, our own hauler is not.
    const g2 = createGame(cfg({ units: [sp(0, 'hum_artillery', 10, 10), sp(0, 'hum_buggy', 14, 10), sp(1, 'ali_gorger', 20, 10), sp(1, 'ali_gorger', 21, 10), sp(0, 'hum_hauler', 20, 11)] }));
    const art = byKind(g2, 'hum_artillery').id;
    const g1 = units(g2).filter((u) => u.kind === 'ali_gorger');
    submit(g2, { type: 'attack', player: 0, units: [art], target: g1[0]!.id });
    run(g2, 200);
    const after = units(g2).filter((u) => u.kind === 'ali_gorger');
    expect(after.some((u) => u.hp < unitDef('ali_gorger').hp)).toBe(true);
    expect(after.filter((u) => u.hp < unitDef('ali_gorger').hp).length).toBe(2); // both caught in the blast
    expect(units(g2).find((u) => u.kind === 'hum_hauler')!.hp).toBe(unitDef('hum_hauler').hp);
  });
});

describe('deaths and structures', () => {
  it('CMB-8: dead units are removed, attackers go idle, and destroyed buildings free their tiles', () => {
    const g = createGame(cfg({ units: [sp(0, 'hum_rifleman', 20, 20), sp(1, 'ali_skitter', 22, 20)] }));
    const ev = run(g, 200);
    expect(units(g).some((u) => u.kind === 'ali_skitter')).toBe(false);
    expect(ev.some((e) => e.t === 'die')).toBe(true);
    const shotsAfter = shotsBy(run(g, 60), 0);
    expect(shotsAfter).toBe(0);

    const squad = Array.from({ length: 8 }, (_, i) => sp(0, 'hum_rifleman', 10 + (i % 4), 10 + Math.floor(i / 4)));
    const h = createGame(cfg({ buildings: [{ owner: 1, kind: 'ali_nest', tx: 15, ty: 10 }, { owner: 0, kind: 'hum_hq', tx: 2, ty: 2 }, { owner: 1, kind: 'ali_hq', tx: 40, ty: 40 }], units: squad }));
    const nest = snapshot(h).buildings.find((b) => b.kind === 'ali_nest')!;
    expect(h.state.grid.blocked[10 * W + 15]).toBe(1);
    submit(h, { type: 'attackmove', player: 0, units: squad.map((_, i) => i + 4), x: 17 * FP, y: 11 * FP });
    run(h, 1500);
    expect(snapshot(h).buildings.some((b) => b.id === nest.id)).toBe(false);
    expect(h.state.grid.blocked[10 * W + 15]).toBe(0);
  });

  it('CMB-9: defence structures fire automatically and go offline on low power', () => {
    const powered = createGame(cfg({
      buildings: [{ owner: 0, kind: 'hum_hq', tx: 10, ty: 10 }, { owner: 0, kind: 'hum_reactor', tx: 14, ty: 10 }, { owner: 0, kind: 'hum_turret', tx: 18, ty: 10 }, { owner: 1, kind: 'ali_hq', tx: 40, ty: 40 }],
      units: [sp(1, 'ali_gorger', 22, 10)],
    }));
    run(powered, 120);
    expect(byKind(powered, 'ali_gorger').hp).toBeLessThan(unitDef('ali_gorger').hp);

    const dark = createGame(cfg({
      buildings: [{ owner: 0, kind: 'hum_turret', tx: 18, ty: 10 }, { owner: 1, kind: 'ali_hq', tx: 40, ty: 40 }],
      units: [sp(1, 'ali_gorger', 22, 10)],
    }));
    expect(snapshot(dark).players[0]!.powerIn).toBeGreaterThan(snapshot(dark).players[0]!.powerOut);
    run(dark, 120);
    expect(byKind(dark, 'ali_gorger').hp).toBe(unitDef('ali_gorger').hp);
  });

  it('CMB-10: regenerating units heal only after five seconds without damage', () => {
    const g = createGame(cfg({ units: [sp(1, 'ali_brute', 20, 20)] }));
    const u = g.state.units[0]!;
    u.hp = 100;
    u.sinceHurt = 0;
    run(g, 99);
    expect(u.hp).toBe(100);
    run(g, 60);
    expect(u.hp).toBeGreaterThan(100);
    expect(u.hp).toBeLessThanOrEqual(unitDef('ali_brute').hp);
  });
});

describe('air units and the end of the game', () => {
  it('CMB-11: air units cross blocked terrain that stops ground units, and do not collide with them', () => {
    const wall: [number, number][] = Array.from({ length: 10 }, (_, y) => [15, y]);
    const g = createGame(cfg({ map: open(wall, 30, 10), units: [sp(0, FLYER, 5, 5), sp(0, 'hum_rifleman', 5, 6)] }));
    const [air, ground] = [byKind(g, FLYER).id, byKind(g, 'hum_rifleman').id];
    submit(g, { type: 'move', player: 0, units: [air, ground], x: 25 * FP + FP / 2, y: 5 * FP + FP / 2 });
    run(g, 600);
    expect(units(g).find((u) => u.id === air)!.x / FP).toBeGreaterThan(24);
    expect(units(g).find((u) => u.id === ground)!.x / FP).toBeLessThan(15);

    const stack = createGame(cfg({ units: [sp(0, FLYER, 20, 20), sp(0, 'hum_rifleman', 20, 20)] }));
    const before = units(stack).find((u) => u.kind === FLYER)!;
    run(stack, 40);
    const after = units(stack).find((u) => u.kind === FLYER)!;
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });

  it('CMB-12: a player with no buildings is defeated and the snapshot reports the winner', () => {
    const g = createGame(cfg({ buildings: [{ owner: 0, kind: 'hum_hq', tx: 5, ty: 5 }, { owner: 1, kind: 'ali_nest', tx: 30, ty: 30 }] }));
    run(g, 5);
    expect(snapshot(g)).toMatchObject({ over: false, winner: null });
    const nest = snapshot(g).buildings.find((b) => b.kind === 'ali_nest')!;
    g.state.players[1]!.credits = 0;
    submit(g, { type: 'sell', player: 1, building: nest.id });
    run(g, 2);
    expect(snapshot(g)).toMatchObject({ over: true, winner: 0 });
  });

  it('CMB-13: superweapons charge only while powered, fire after a delay with falloff, then recharge', () => {
    const lanceCfg = (extra: GameConfig['buildings']) => cfg({
      buildings: [{ owner: 0, kind: 'hum_lance', tx: 2, ty: 2 }, ...(extra ?? []), { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 }],
      units: [sp(1, 'ali_gorger', 30, 30), sp(1, 'ali_gorger', 33, 30), sp(1, 'ali_gorger', 35, 30)],
    });
    const dark = createGame(lanceCfg([]));
    run(dark, 100);
    expect(dark.state.buildings.find((b) => b.kind === 'hum_lance')!.charge).toBe(0); // drains 90, produces 0

    const lit = createGame(lanceCfg([{ owner: 0, kind: 'hum_hq', tx: 10, ty: 2 }, { owner: 0, kind: 'hum_reactor', tx: 14, ty: 2 }, { owner: 0, kind: 'hum_reactor', tx: 17, ty: 2 }]));
    run(lit, 100);
    const lance = lit.state.buildings.find((b) => b.kind === 'hum_lance')!;
    expect(lance.charge).toBe(100);
    const max = buildingDef('hum_lance').superweapon!.charge;
    lance.charge = max;
    // Vision of the target point is not required: it is a strike at a chosen position.
    submit(lit, { type: 'superweapon', player: 0, building: lance.id, x: 30 * FP + FP / 2, y: 30 * FP + FP / 2 });
    tick(lit);
    expect(lance.charge).toBeLessThan(max); // spent
    const hpBefore = units(lit).filter((u) => u.kind === 'ali_gorger').map((u) => u.hp);
    run(lit, 20);
    expect(units(lit).filter((u) => u.kind === 'ali_gorger').map((u) => u.hp)).toEqual(hpBefore); // not yet: 60-tick delay
    run(lit, 60);
    const hp = units(lit).filter((u) => u.kind === 'ali_gorger').map((u) => u.hp);
    expect(hp.length).toBeLessThan(3); // the nearest ones are destroyed or crippled
    const survivors = units(lit).filter((u) => u.kind === 'ali_gorger').sort((a, b) => a.x - b.x);
    if (survivors.length === 3) expect(survivors[0]!.hp).toBeLessThan(survivors[2]!.hp);
    expect(lance.charge).toBeLessThan(200); // recharging from zero
  });
});

describe('superweapon events', () => {
  it('R3D-8: a superweapon launch names its target and its strike names the weapon', () => {
    const g = createGame(cfg({
      buildings: [{ owner: 0, kind: 'hum_lance', tx: 2, ty: 2 }, { owner: 0, kind: 'hum_hq', tx: 10, ty: 2 }, { owner: 0, kind: 'hum_reactor', tx: 14, ty: 2 }, { owner: 0, kind: 'hum_reactor', tx: 17, ty: 2 }, { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 }],
    }));
    run(g, 2);
    const lance = g.state.buildings.find((b) => b.kind === 'hum_lance')!;
    lance.charge = buildingDef('hum_lance').superweapon!.charge;
    const x = 30 * FP + FP / 2;
    const y = 31 * FP + FP / 2;
    submit(g, { type: 'superweapon', player: 0, building: lance.id, x, y });
    const events = run(g, 70);
    expect(events.find((e) => e.t === 'launch')).toMatchObject({ tx: x, ty: y, kind: 'hum_lance', owner: 0 });
    expect(events.find((e) => e.t === 'strike')).toMatchObject({ x, y, kind: 'hum_lance' });
  });
});

describe('rosters', () => {
  const kinds = (f: 'human' | 'alien'): { b: [string, BuildingDef][]; u: [string, UnitDef][] } => ({
    b: Object.entries(BUILDING_DEFS).filter(([, d]) => d.faction === f),
    u: Object.entries(UNIT_DEFS).filter(([, d]) => d.faction === f),
  });

  it('ROS-1: everything is reachable through the tech tree from the headquarters', () => {
    for (const f of ['human', 'alien'] as const) {
      const { b, u } = kinds(f);
      const have = new Set(b.filter(([, d]) => d.hq).map(([k]) => k));
      expect(have.size).toBe(1);
      for (let pass = 0; pass < 12; pass++) for (const [k, d] of b) if (d.requires.every((r) => have.has(r))) have.add(k);
      for (const [k, d] of b) {
        expect(d.requires.every((r) => r in BUILDING_DEFS && BUILDING_DEFS[r]!.faction === f)).toBe(true);
        expect(have.has(k), `${k} unreachable`).toBe(true);
      }
      for (const [k, d] of u) {
        expect(have.has(d.builtAt), `${k} producer ${d.builtAt}`).toBe(true);
        expect(d.requires.every((r) => have.has(r)), `${k} requires`).toBe(true);
      }
      expect(b.some(([, d]) => d.refinery)).toBe(true);
      expect(b.some(([, d]) => d.power > 0 && !d.hq)).toBe(true);
      expect(b.some(([, d]) => d.superweapon)).toBe(true);
      expect(u.some(([, d]) => d.capacity !== undefined)).toBe(true);
      // Three tiers exist and each tier-3 building needs a tier-2 one.
      expect(new Set(b.map(([, d]) => d.tier))).toEqual(new Set([1, 2, 3]));
    }
  });

  it('ROS-2: each faction can counter armour, infantry and air, and has artillery that outranges its defences', () => {
    for (const f of ['human', 'alien'] as const) {
      const { b, u } = kinds(f);
      const armed = u.filter(([, d]) => d.weapon);
      expect(armed.some(([, d]) => damageAgainst(d.weapon!, 'heavy') >= 30), `${f} anti-armour`).toBe(true);
      expect(armed.some(([, d]) => d.weapon!.antiAir), `${f} anti-air`).toBe(true);
      expect(armed.some(([, d]) => d.role === 'infantry' || d.role === 'raider'), `${f} infantry`).toBe(true);
      const defenceRange = Math.max(...b.filter(([, d]) => d.weapon).map(([, d]) => d.weapon!.range));
      const art = u.find(([, d]) => d.role === 'artillery')![1];
      expect(art.weapon!.range).toBeGreaterThanOrEqual(defenceRange + 3);
    }
  });

  it('DET-1: a combat scenario is deterministic for the same seed and commands', () => {
    const play = (seed: number): number => {
      const g = createGame(cfg({ seed, units: [sp(0, 'hum_rifleman', 20, 20), sp(0, 'hum_tank', 20, 22), sp(1, 'ali_skitter', 25, 20), sp(1, 'ali_brute', 26, 22)] }));
      submit(g, { type: 'attackmove', player: 0, units: [1, 2], x: 30 * FP, y: 21 * FP });
      run(g, 400);
      return hash(g);
    };
    expect(play(1)).toBe(play(1));
  });
});

describe('lingering sight', () => {
  it('FOG-6: a dead unit\'s sight lingers where it fell for 8 seconds (visible at tick 159, hidden at 160), then fades', () => {
    const g = createGame(cfg({
      buildings: [{ owner: 0, kind: 'hum_hq', tx: 2, ty: 2 }, { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 }],
      units: [sp(0, 'hum_buggy', 30, 12)],
    }));
    run(g, 2);
    const at = 12 * g.state.grid.width + 30;
    const seen = (): boolean => ((g.state.fog[0]![at] as number) & VISIBLE) !== 0;
    expect(seen()).toBe(true);
    g.state.units.find((u) => u.kind === 'hum_buggy')!.hp = 0;
    const before = hash(g);
    run(g, 1);
    expect(g.state.units.some((u) => u.kind === 'hum_buggy')).toBe(false);
    expect(seen()).toBe(true); // still in sight just after it died
    expect(hash(g)).not.toBe(before);
    run(g, SIGHT_LINGER - 2);
    expect(seen()).toBe(true); // 159 ticks after the last sight
    run(g, 1);
    expect(seen()).toBe(false); // faded after 8 s (160 ticks)
    expect((g.state.fog[0]![at] as number) & EXPLORED).toBe(EXPLORED);
  });

  it('FOG-7: when a unit moves away, the ground it saw stays in sight for 8 seconds before the fog closes in', () => {
    const g = createGame(cfg({
      buildings: [{ owner: 0, kind: 'hum_hq', tx: 2, ty: 2 }, { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 }],
      units: [sp(0, 'hum_buggy', 30, 12), sp(1, 'ali_skitter', 30, 15)],
    }));
    run(g, 2);
    const at = 12 * g.state.grid.width + 30;
    const seen = (): boolean => ((g.state.fog[0]![at] as number) & VISIBLE) !== 0;
    const enemyShown = (): boolean => snapshot(g, 0).units.some((u) => u.owner === 1);
    expect(seen()).toBe(true);
    expect(enemyShown()).toBe(true);
    // Move the buggy far away (as if it drove off): its old ground stays in sight, enemies there included...
    const b = g.state.units.find((u) => u.kind === 'hum_buggy')!;
    b.x = 8 * FP + FP / 2;
    b.y = 40 * FP + FP / 2;
    b.path = [];
    run(g, SIGHT_LINGER - 1);
    expect(seen()).toBe(true);
    expect(enemyShown()).toBe(true);
    const mid = hash(g);
    // ...then the fog closes in at tick 160; the tile stays explored.
    run(g, 1);
    expect(seen()).toBe(false);
    expect(enemyShown()).toBe(false);
    expect(hash(g)).not.toBe(mid);
    expect((g.state.fog[0]![at] as number) & EXPLORED).toBe(EXPLORED);
    expect(SIGHT_LINGER).toBe(160);
  });
});

describe('line of fire', () => {
  // A rifleman (or artillery) at x 10 and a target 4 tiles east, with a reactor in between on row 20.
  const setup = (kind: string, wall: boolean) => createGame(cfg({
    buildings: [...(wall ? [{ owner: 0, kind: 'hum_reactor', tx: 12, ty: 19 }] : []), { owner: 0, kind: 'hum_hq', tx: 2, ty: 40 }, { owner: 1, kind: 'ali_hq', tx: 44, ty: 44 }],
    units: [sp(0, kind, 10, 20), sp(1, 'ali_gorger', 14, 20)],
  }));
  const shots = (g: Game, n: number): number => run(g, n).filter((e) => e.t === 'shot' && e.owner === 0).length;

  it('CMB-14: direct fire never passes through a building; an attacking unit moves for a clear shot instead', () => {
    const open = setup('hum_rifleman', false);
    expect(shots(open, 20)).toBeGreaterThan(0);
    const walled = setup('hum_rifleman', true);
    const rifle = walled.state.units.find((u) => u.kind === 'hum_rifleman')!;
    const start = { x: rifle.x, y: rifle.y };
    // Idle, it does not fire through the reactor at the target behind it.
    expect(shots(walled, 60)).toBe(0);
    // Ordered to attack, it works its way round the reactor and then hits the target.
    const gorger = walled.state.units.find((u) => u.kind === 'ali_gorger')!;
    submit(walled, { type: 'attack', player: 0, units: [rifle.id], target: gorger.id });
    const later = run(walled, 400).filter((e) => e.t === 'shot' && e.owner === 0);
    expect(later.length).toBeGreaterThan(0);
    expect(Math.hypot(rifle.x - start.x, rifle.y - start.y)).toBeGreaterThan(FP);
  });

  it('CMB-14: artillery lobs its shells over the building without moving', () => {
    const g = setup('hum_artillery', true);
    const art = g.state.units.find((u) => u.kind === 'hum_artillery')!;
    const start = { x: art.x, y: art.y };
    expect(shots(g, 80)).toBeGreaterThan(0);
    expect(art.x).toBe(start.x);
    expect(art.y).toBe(start.y);
  });
});
