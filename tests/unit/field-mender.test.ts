import { describe, expect, it } from 'vitest';
import { canCrush, trainableAt, unitDef } from '../../src/data/defs';
import { sanitizeCommand, NET_VERSION } from '../../src/net/protocol';
import { createGame, hash, isVehicle, mayCarry, maxHpOf, snapshot, submit, tick, unitDamage, type Command, type Game, type MapDef, type UnitSpawn } from '../../src/sim';
import type { Unit } from '../../src/sim/state';

const RATE = unitDef('hum_mender').repair!.rate;
const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
const game = (units: UnitSpawn[], map = open(30, 30)): Game => createGame({ seed: 3, map, units });
const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const byKind = (g: Game, kind: string, owner = 0): Unit => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;
/** Board `squad` into `carrier` and run until it is aboard (or `max` ticks). */
const board = (g: Game, squad: Unit, carrier: Unit, max = 200): void => {
  submit(g, { type: 'board', player: squad.owner, units: [squad.id], carrier: carrier.id });
  for (let i = 0; i < max && !carrier.cargo; i++) tick(g);
};

describe('CMB-15: the Field Mender', () => {
  it('CMB-15: an Aegis Motor Pool vehicle: heavy armour, 350 hp, speed 40, cost 750, no weapon, never crushes', () => {
    const d = unitDef('hum_mender');
    expect(d).toMatchObject({ faction: 'human', builtAt: 'hum_factory', armor: 'heavy', hp: 350, speed: 40, cost: 750, requires: [] });
    expect(d.weapon).toBeUndefined();
    expect(d.crusher).toBeFalsy();
    expect(trainableAt('hum_factory')).toContain('hum_mender');
    for (const v of ['hum_rifleman', 'ali_skitter', 'ali_spitter']) expect(canCrush('hum_mender', v)).toBe(false);
  });

  it('CMB-15: it never fires and never runs anything over, even driving through an enemy squad', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 5, ty: 10 },
      { owner: 1, kind: 'ali_skitter', tx: 9, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const sk = byKind(g, 'ali_skitter', 1);
    sk.mode = 'move'; // keep the squad from biting
    submit(g, { type: 'move', player: 0, units: [m.id], x: 14 * 256 + 128, y: 10 * 256 + 128 });
    let shots = 0;
    for (let i = 0; i < 200; i++) {
      tick(g);
      shots += g.state.events.filter((e) => e.t === 'shot' && e.owner === 0).length;
    }
    expect(shots).toBe(0);
    expect(g.state.units.some((u) => u.id === sk.id)).toBe(true);
  });
});

describe('CMB-16, CMB-17: repair', () => {
  it('CMB-16: it mends one damaged friendly vehicle in reach at 5 hp a second', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_tank', tx: 12, ty: 10 },
    ]);
    const tank = byKind(g, 'hum_tank');
    tank.hp = 300;
    run(g, 1);
    const at = tank.hp;
    run(g, 200);
    expect(RATE).toBe(5);
    expect(tank.hp - at).toBe(10 * RATE); // ten seconds
    expect(snapshot(g).units.find((u) => u.kind === 'hum_mender')?.mend).toBe(tank.id);
  });

  it('CMB-16: the most damaged in reach first (by share of health), one at a time', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_tank', tx: 12, ty: 10 },
      { owner: 0, kind: 'hum_artillery', tx: 10, ty: 12 },
      { owner: 0, kind: 'hum_buggy', tx: 8, ty: 10 },
    ]);
    const tank = byKind(g, 'hum_tank');
    const arty = byKind(g, 'hum_artillery');
    const buggy = byKind(g, 'hum_buggy');
    tank.hp = 275; // 50%
    arty.hp = 75; // 30%
    buggy.hp = 120; // 75%
    run(g, 1);
    run(g, 40);
    expect(arty.hp).toBe(75 + 3 * RATE);
    expect(tank.hp).toBe(275);
    expect(buggy.hp).toBe(120);
  });

  it('CMB-16: heroes are vehicles too', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_paladin', tx: 10, ty: 13 },
    ]);
    const hero = byKind(g, 'hum_paladin');
    hero.hp = 1350;
    hero.sinceHurt = 0; // no regeneration of its own yet
    run(g, 41);
    expect(isVehicle('hum_paladin')).toBe(true);
    expect(hero.hp).toBe(1350 + 3 * RATE);
  });

  it('CMB-16: never infantry, buildings or anything beyond 3 tiles', () => {
    const g = createGame({
      seed: 1,
      map: open(30, 30),
      units: [
        { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
        { owner: 0, kind: 'hum_rifleman', tx: 11, ty: 10 },
        { owner: 0, kind: 'hum_tank', tx: 10, ty: 15 },
      ],
      buildings: [{ owner: 0, kind: 'hum_reactor', tx: 12, ty: 9 }],
      players: [
        { faction: 'human', credits: 0 },
        { faction: 'alien', credits: 0 },
      ],
    });
    const rifle = byKind(g, 'hum_rifleman');
    const far = byKind(g, 'hum_tank');
    const reactor = g.state.buildings[0]!;
    rifle.hp = 50;
    far.hp = 100;
    reactor.hp = 300;
    expect(isVehicle('hum_rifleman')).toBe(false);
    run(g, 100);
    expect(rifle.hp).toBe(50);
    expect(far.hp).toBe(100);
    expect(reactor.hp).toBe(300);
    expect(byKind(g, 'hum_mender').mend).toBe(-1);
  });

  it("CMB-16: never the enemy's vehicles", () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 1, kind: 'hum_hauler', tx: 12, ty: 10 },
    ]);
    const theirs = byKind(g, 'hum_hauler', 1);
    theirs.hp = 100;
    run(g, 100);
    expect(theirs.hp).toBe(100);
  });

  it('CMB-16: it stops at full health and takes the next one', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_tank', tx: 12, ty: 10 },
      { owner: 0, kind: 'hum_artillery', tx: 8, ty: 10 },
    ]);
    const tank = byKind(g, 'hum_tank');
    const arty = byKind(g, 'hum_artillery');
    tank.hp = 540;
    arty.hp = 240;
    run(g, 200);
    expect(tank.hp).toBe(550);
    expect(arty.hp).toBe(250);
    expect(byKind(g, 'hum_mender').mend).toBe(-1);
  });

  it('CMB-17: it mends itself at 3 hp a second at all times, also while mending another, up to its maximum', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_tank', tx: 12, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const tank = byKind(g, 'hum_tank');
    m.hp = 100;
    tank.hp = 100;
    run(g, 1);
    const at = m.hp;
    run(g, 200);
    expect(m.hp - at).toBe(30);
    expect(tank.hp).toBeGreaterThan(100);
    m.hp = maxHpOf('hum_mender', 0) - 1;
    run(g, 40);
    expect(m.hp).toBe(maxHpOf('hum_mender', 0));
  });

  it('CMB-17: it mends itself under fire too (no wait after damage)', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 1, kind: 'ali_skitter', tx: 20, ty: 20 },
    ]);
    const m = byKind(g, 'hum_mender');
    m.hp = 200;
    m.sinceHurt = 0;
    run(g, 41); // repairs on ticks 0, 20 and 40
    expect(m.hp).toBe(209);
  });
});

describe('SQD-3..6: the passenger', () => {
  it('SQD-3: a Rifleman or Rocketeer squad boards; never a hero, a vehicle or a Vrax squad', () => {
    expect(mayCarry('hum_mender', 'hum_rifleman')).toBe(true);
    expect(mayCarry('hum_mender', 'hum_rocketeer')).toBe(true);
    expect(mayCarry('hum_mender', 'hum_paladin')).toBe(false);
    expect(mayCarry('hum_mender', 'hum_tank')).toBe(false);
    expect(mayCarry('hum_mender', 'ali_spitter')).toBe(false);
    expect(mayCarry('hum_tank', 'hum_rifleman')).toBe(false);
  });

  it('SQD-3: a board order walks the squad to the carrier and it climbs in, leaving the unit list; the snapshot shows it aboard', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rocketeer', tx: 16, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rocketeer');
    board(g, r, m);
    expect(m.cargo).toBe(r);
    expect(g.state.units.includes(r)).toBe(false);
    const snap = snapshot(g);
    expect(snap.units.find((u) => u.id === r.id)).toBeUndefined();
    expect(snap.units.find((u) => u.id === m.id)?.cargo).toEqual({ id: r.id, kind: 'hum_rocketeer', hp: r.hp, rank: 0 });
  });

  it('SQD-3: only one squad: a second heading for a full carrier stops; a board order for a full carrier is refused', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 13, ty: 10 },
      { owner: 0, kind: 'hum_rocketeer', tx: 18, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const a = byKind(g, 'hum_rifleman');
    const b = byKind(g, 'hum_rocketeer');
    submit(g, { type: 'board', player: 0, units: [a.id, b.id], carrier: m.id });
    run(g, 200);
    expect(m.cargo).toBe(a);
    expect(b.ride).toBe(-1);
    expect(g.state.units.includes(b)).toBe(true);
    submit(g, { type: 'board', player: 0, units: [b.id], carrier: m.id });
    run(g, 2);
    expect(b.ride).toBe(-1);
  });

  it("SQD-3: a squad on its way neither fires nor diverts; another order cancels the boarding; the enemy's carrier takes nobody", () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 4, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 16, ty: 10 },
      { owner: 1, kind: 'ali_lobber', tx: 12, ty: 13 },
      { owner: 1, kind: 'hum_mender', tx: 20, ty: 20 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rifleman');
    const lob = byKind(g, 'ali_lobber', 1);
    lob.mode = 'move';
    submit(g, { type: 'board', player: 0, units: [r.id], carrier: m.id });
    let shots = 0;
    for (let i = 0; i < 30; i++) {
      tick(g);
      shots += g.state.events.filter((e) => e.t === 'shot' && e.owner === 0).length;
    }
    expect(shots).toBe(0);
    expect(r.ride).toBe(m.id);
    submit(g, { type: 'stop', player: 0, units: [r.id] });
    run(g, 200);
    expect(m.cargo).toBeNull();
    expect(r.ride).toBe(-1);
    const theirs = byKind(g, 'hum_mender', 1);
    submit(g, { type: 'board', player: 0, units: [r.id], carrier: theirs.id });
    run(g, 2);
    expect(r.ride).toBe(-1);
  });

  it('SQD-4: the passenger fires its own weapon at its own range from inside, also while the carrier moves, and earns experience', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 4, ty: 10 },
      { owner: 0, kind: 'hum_rocketeer', tx: 5, ty: 10 },
      { owner: 1, kind: 'ali_brute', tx: 16, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rocketeer');
    const brute = byKind(g, 'ali_brute', 1);
    brute.hp = 100000;
    brute.mode = 'move'; // a punching bag
    board(g, r, m);
    expect(m.cargo).toBe(r);
    submit(g, { type: 'move', player: 0, units: [m.id], x: 20 * 256, y: 10 * 256 + 128 });
    const shots: { x: number; d: number; moving: boolean }[] = [];
    let last = m.x;
    for (let i = 0; i < 160 && m.x < 15 * 256; i++) {
      tick(g);
      for (const e of g.state.events) if (e.t === 'shot' && e.owner === 0) shots.push({ x: e.x, d: Math.abs(e.tx - e.x), moving: m.x !== last });
      last = m.x;
    }
    expect(shots.length).toBeGreaterThan(1);
    expect(shots.some((s) => s.moving)).toBe(true);
    // Fired from the carrier, within the Rocketeer's range of 6 tiles (to the target's edge).
    for (const s of shots) expect(s.d - unitDef('ali_brute').radius).toBeLessThanOrEqual(6 * 256 + 2);
    run(g, 40);
    expect(r.xp).toBeGreaterThan(0);
    expect(100000 - brute.hp).toBeGreaterThan(0);
    // Same damage per shot as outside (SQD-1).
    expect(unitDamage('hum_rocketeer', r.hp, r.rank)).toBe(38);
  });

  it('SQD-4: it fires only at enemies its owner can see and never through a building', () => {
    const g = createGame({
      seed: 1,
      map: open(30, 30),
      units: [
        { owner: 0, kind: 'hum_mender', tx: 4, ty: 10 },
        { owner: 0, kind: 'hum_rifleman', tx: 5, ty: 10 },
        { owner: 1, kind: 'ali_brute', tx: 10, ty: 10 },
      ],
      buildings: [{ owner: 1, kind: 'ali_generator', tx: 7, ty: 9 }],
      players: [
        { faction: 'human', credits: 0 },
        { faction: 'alien', credits: 0 },
      ],
    });
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rifleman');
    const brute = byKind(g, 'ali_brute', 1);
    brute.mode = 'move';
    brute.hp = 100000;
    board(g, r, m);
    m.mode = 'move';
    run(g, 60);
    // The generator stands between them: the rifles shoot the generator (in the clear), not the brute behind it.
    expect(r.target === brute.id).toBe(false);
  });

  it('SQD-5: inside, the squad cannot be targeted, shot, splashed or crushed', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 11, ty: 10 },
      { owner: 1, kind: 'ali_lobber', tx: 16, ty: 10 },
      { owner: 1, kind: 'ali_brute', tx: 20, ty: 20 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rifleman');
    board(g, r, m);
    const hp = r.hp;
    m.hp = 100000; // let it soak everything
    const lob = byKind(g, 'ali_lobber', 1);
    for (let i = 0; i < 200; i++) {
      tick(g);
      expect(lob.target === r.id).toBe(false);
    }
    // A crusher drives over the carrier: the squad is not in the unit list, so nothing flattens it.
    const brute = byKind(g, 'ali_brute', 1);
    submit(g, { type: 'move', player: 1, units: [brute.id], x: m.x, y: m.y });
    run(g, 200);
    expect(r.hp).toBe(hp);
    expect(m.cargo).toBe(r);
  });

  it('SQD-5: if the carrier is destroyed the squad dies with it, and both count as lost', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 11, ty: 10 },
      { owner: 1, kind: 'ali_brute', tx: 12, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rifleman');
    board(g, r, m);
    m.hp = 5;
    let died: number[] = [];
    for (let i = 0; i < 100 && g.state.units.includes(m); i++) {
      tick(g);
      died = died.concat(g.state.events.filter((e) => e.t === 'die').map((e) => (e as { id: number }).id));
    }
    expect(died).toContain(m.id);
    expect(died).toContain(r.id);
    expect(r.hp).toBe(0);
    expect(g.state.players[0]!.stats.unitsLost).toBe(2);
  });

  it('SQD-5: a hero running the carrier over kills the squad inside as well', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 11, ty: 10 },
      { owner: 1, kind: 'ali_strider', tx: 16, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rifleman');
    board(g, r, m);
    const hero = byKind(g, 'ali_strider', 1);
    submit(g, { type: 'move', player: 1, units: [hero.id], x: m.x, y: m.y });
    for (let i = 0; i < 600 && g.state.units.includes(m); i++) tick(g);
    expect(g.state.units.includes(m)).toBe(false);
    expect(r.hp).toBe(0);
    expect(g.state.players[0]!.stats.unitsLost).toBe(2);
  });

  it('SQD-6: unloading lets the squad out beside the carrier, as it was, idle; unloading first saves it', () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rocketeer', tx: 12, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    const r = byKind(g, 'hum_rocketeer');
    r.hp = 70;
    r.xp = 300;
    r.rank = 1;
    board(g, r, m);
    submit(g, { type: 'unload', player: 0, units: [m.id] });
    tick(g);
    expect(m.cargo).toBeNull();
    const out = g.state.units.find((u) => u.id === r.id)!;
    expect(out).toBe(r);
    expect([out.hp, out.xp, out.rank, out.mode, out.goal]).toEqual([70, 300, 1, 'idle', -1]);
    expect(Math.hypot(out.x - m.x, out.y - m.y)).toBeLessThanOrEqual(2 * 256);
    expect(g.state.events.some((e) => e.t === 'board' && !e.on && e.rider === r.id)).toBe(true);
    m.hp = 0;
    run(g, 2);
    expect(g.state.units.includes(r)).toBe(true);
  });

  it("SQD-6: only the owner's carriers unload", () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 0, kind: 'hum_rifleman', tx: 11, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    board(g, byKind(g, 'hum_rifleman'), m);
    submit(g, { type: 'unload', player: 1, units: [m.id] });
    run(g, 2);
    expect(m.cargo).not.toBeNull();
  });
});

describe('NET-7: board and unload are ordinary commands', () => {
  it('NET-7: the wire keeps only well-formed board and unload commands, for the sender', () => {
    expect(sanitizeCommand({ type: 'board', player: 1, units: [4, 5], carrier: 9, extra: 1 }, 0)).toEqual({ type: 'board', player: 0, units: [4, 5], carrier: 9 });
    expect(sanitizeCommand({ type: 'unload', player: 1, units: [9] }, 0)).toEqual({ type: 'unload', player: 0, units: [9] });
    expect(sanitizeCommand({ type: 'board', units: [4], carrier: -1 }, 0)).toBeNull();
    expect(sanitizeCommand({ type: 'board', units: 'x', carrier: 3 }, 0)).toBeNull();
    expect(sanitizeCommand({ type: 'unload', units: [1.5] }, 0)).toBeNull();
    expect(NET_VERSION).toBeGreaterThanOrEqual(10);
  });

  it("NET-7: the simulation refuses to board another player's squads", () => {
    const g = game([
      { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
      { owner: 1, kind: 'hum_rifleman', tx: 11, ty: 10 },
    ]);
    submit(g, { type: 'board', player: 0, units: [byKind(g, 'hum_rifleman', 1).id], carrier: byKind(g, 'hum_mender').id });
    run(g, 60);
    expect(byKind(g, 'hum_mender').cargo).toBeNull();
  });

  it('NET-7: the same commands give the same game; the checksum sees who rides and what is mended', () => {
    const play = (unload: boolean): number[] => {
      const g = game([
        { owner: 0, kind: 'hum_mender', tx: 10, ty: 10 },
        { owner: 0, kind: 'hum_rocketeer', tx: 14, ty: 10 },
        { owner: 0, kind: 'hum_tank', tx: 12, ty: 12 },
      ]);
      byKind(g, 'hum_tank').hp = 200;
      const cmds: Command[] = [{ type: 'board', player: 0, units: [byKind(g, 'hum_rocketeer').id], carrier: byKind(g, 'hum_mender').id }];
      const out: number[] = [];
      for (let i = 0; i < 150; i++) {
        if (i === 0) for (const c of cmds) submit(g, c);
        if (i === 120 && unload) submit(g, { type: 'unload', player: 0, units: [byKind(g, 'hum_mender').id] });
        tick(g);
        out.push(hash(g));
      }
      return out;
    };
    const a = play(false);
    expect(play(false)).toEqual(a);
    const b = play(true);
    expect(b.slice(0, 120)).toEqual(a.slice(0, 120));
    expect(b[125]).not.toBe(a[125]);
  });
});
