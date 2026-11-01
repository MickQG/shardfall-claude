import { describe, expect, it } from 'vitest';
import { buildingDef, unitDef } from '../../src/data/defs';
import { canPlace, createGame, FP, QUEUE_MAX, hash, snapshot, submit, tick, type Game, type GameConfig, type MapDef } from '../../src/sim';

const W = 48;
const open = (shards: Record<string, number> = {}, blocked: number[] = []): MapDef => {
  const sh = new Array<number>(W * W).fill(0);
  for (const [k, v] of Object.entries(shards)) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    sh[y * W + x] = v;
  }
  const bl = new Array<number>(W * W).fill(0);
  for (const i of blocked) bl[i] = 1;
  return { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: bl, shards: sh };
};

const field = (cx: number, cy: number, amount: number): Record<string, number> => {
  const out: Record<string, number> = {};
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) out[`${x},${y}`] = amount;
  return out;
};

const base = (extra: Partial<GameConfig> = {}): GameConfig => ({
  seed: 1,
  map: open(),
  players: [
    { faction: 'human', credits: 5000 },
    { faction: 'alien', credits: 5000 },
  ],
  buildings: [
    { owner: 0, kind: 'hum_hq', tx: 5, ty: 5 },
    { owner: 0, kind: 'hum_reactor', tx: 9, ty: 5 },
    { owner: 1, kind: 'ali_hq', tx: 38, ty: 38 },
  ],
  ...extra,
});

const run = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) tick(g);
};
const credits = (g: Game, p = 0): number => snapshot(g).players[p]!.credits;
const hq = (g: Game): number => snapshot(g).buildings.find((b) => b.kind === 'hum_hq')!.id;
const bld = (g: Game, kind: string) => snapshot(g).buildings.filter((b) => b.kind === kind);
const sum = (a: ArrayLike<number>): number => Array.from(a).reduce((x, y) => x + y, 0);

/** Queue a structure, wait for it, and place it. */
function build(g: Game, kind: string, tx: number, ty: number): void {
  submit(g, { type: 'produce', player: 0, source: hq(g), kind });
  run(g, buildingDef(kind).buildTime + 1);
  submit(g, { type: 'place', player: 0, source: hq(g), tx, ty });
  tick(g);
}

describe('harvesting', () => {
  it('ECO-1: players start with configured credits and buildings; the viewer sees only their own balance', () => {
    const g = createGame(base());
    const s0 = snapshot(g, 0);
    expect(s0.players[0]).toMatchObject({ credits: 5000, powerOut: 90, powerIn: 0 });
    expect(s0.players[1]!.credits).toBe(0); // enemy economy is hidden
    expect(s0.buildings.map((b) => b.kind).sort()).toEqual(['hum_hq', 'hum_reactor']);
    expect(snapshot(g).players[1]!.credits).toBe(5000); // god view
  });

  it('ECO-2: a hauler gathers, delivers to the refinery, and credits and field amounts move together', () => {
    const cfg = base({ map: open(field(20, 8, 20000)), units: [{ owner: 0, kind: 'hum_hauler', tx: 14, ty: 9 }] });
    cfg.buildings!.push({ owner: 0, kind: 'hum_refinery', tx: 12, ty: 6 });
    const g = createGame(cfg);
    const total0 = sum(snapshot(g).shards.length ? g.state.shards : []);
    const c0 = credits(g);
    run(g, 1800);
    const delivered = credits(g) - c0;
    expect(delivered).toBeGreaterThanOrEqual(200);
    const hauler = snapshot(g).units.find((u) => u.kind === 'hum_hauler')!;
    expect(total0 - sum(g.state.shards)).toBe(delivered + hauler.load);
  });

  it('ECO-3: without a refinery the hauler waits full; it resumes once one exists; stop halts the loop until harvest', () => {
    const g = createGame(base({ map: open(field(20, 8, 2000)), units: [{ owner: 0, kind: 'hum_hauler', tx: 14, ty: 9 }] }));
    run(g, 900);
    const u = snapshot(g).units.find((x) => x.kind === 'hum_hauler')!;
    expect(u.load).toBe(200);
    const before = { x: u.x, y: u.y, c: credits(g) };
    run(g, 100);
    expect(snapshot(g).units.find((x) => x.kind === 'hum_hauler')).toMatchObject({ x: before.x, y: before.y });

    build(g, 'hum_refinery', 12, 6);
    run(g, 600);
    expect(credits(g)).toBeGreaterThan(before.c - 600 + 150); // paid 600 for the refinery, then earned from the delivery

    const id = snapshot(g).units.find((x) => x.kind === 'hum_hauler')!.id;
    submit(g, { type: 'stop', player: 0, units: [id] });
    run(g, 5);
    const stopped = snapshot(g).units.find((x) => x.id === id)!;
    run(g, 300);
    const still = snapshot(g).units.find((x) => x.id === id)!;
    expect(Math.hypot(still.x - stopped.x, still.y - stopped.y)).toBeLessThan(FP); // may be nudged by neighbours, but never travels
    expect(still.load).toBe(stopped.load);
    submit(g, { type: 'harvest', player: 0, units: [id], x: 20 * FP, y: 8 * FP });
    const cBefore = credits(g);
    run(g, 600);
    const resumed = snapshot(g).units.find((x) => x.id === id)!;
    expect(resumed.load !== stopped.load || credits(g) > cBefore).toBe(true); // the loop is running again
  });

  it('ECO-4: emptied tiles regrow slowly toward half of their seed amount', () => {
    const g = createGame(base({ map: open({ '20,20': 40 }) }));
    g.state.shards[20 * W + 20] = 0;
    run(g, 100);
    expect(g.state.shards[20 * W + 20]).toBe(5);
    run(g, 1000);
    expect(g.state.shards[20 * W + 20]).toBe(20); // seed 40 -> cap 20
  });
});

describe('power', () => {
  it('ECO-5: output and drain are summed; low power halves production speed', () => {
    const ticksToTrain = (extra: { kind: string; tx: number; ty: number }[]): { ticks: number; low: boolean } => {
      const cfg = base();
      cfg.buildings!.push({ owner: 0, kind: 'hum_barracks', tx: 14, ty: 5 }, ...extra.map((e) => ({ owner: 0, ...e })));
      const g = createGame(cfg);
      const bid = bld(g, 'hum_barracks')[0]!.id;
      const low = snapshot(g, 0).players[0]!.powerIn > snapshot(g, 0).players[0]!.powerOut;
      submit(g, { type: 'produce', player: 0, source: bid, kind: 'hum_rifleman' });
      let n = 0;
      while (snapshot(g).units.length === 0 && n < 1000) {
        tick(g);
        n++;
      }
      return { ticks: n, low };
    };
    // hq +20, reactor +70, barracks -10  => fine
    const ok = ticksToTrain([]);
    expect(ok.low).toBe(false);
    expect(ok.ticks).toBe(120);
    // lab (-40) + factory (-25) + refinery (-15) + turret (-15) + barracks (-10) = 105 drain vs 90 output
    const low = ticksToTrain([
      { kind: 'hum_lab', tx: 20, ty: 5 },
      { kind: 'hum_factory', tx: 24, ty: 5 },
      { kind: 'hum_refinery', tx: 30, ty: 5 },
      { kind: 'hum_turret', tx: 34, ty: 5 },
    ]);
    expect(low.low).toBe(true);
    expect(low.ticks).toBe(240);
  });
});

describe('production', () => {
  it('PRD-1: queueing needs prerequisites and credits, deducts cost, and cancelling refunds it', () => {
    const g = createGame(base());
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_factory' }); // missing refinery + barracks
    tick(g);
    expect(credits(g)).toBe(5000);
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_barracks' });
    tick(g);
    expect(credits(g)).toBe(5000 - 400);
    submit(g, { type: 'cancel', player: 0, source: hq(g), index: 0 });
    tick(g);
    expect(credits(g)).toBe(5000);
    expect(snapshot(g).buildings.find((b) => b.id === hq(g))!.queue).toEqual([]);

    const poor = createGame(base({ players: [{ faction: 'human', credits: 399 }, { faction: 'alien', credits: 0 }] }));
    submit(poor, { type: 'produce', player: 0, source: hq(poor), kind: 'hum_barracks' });
    tick(poor);
    expect(credits(poor)).toBe(399);
    // the wrong faction's kind is rejected
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'ali_generator' });
    tick(g);
    expect(credits(g)).toBe(5000);
  });

  it('PRD-2: an item completes after exactly its build time in ticks at full power', () => {
    const g = createGame(base());
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_barracks' });
    run(g, 400);
    expect(snapshot(g).buildings.find((b) => b.kind === 'hum_hq')!.queue[0]).toMatchObject({ ready: true });
    const g2 = createGame(base());
    submit(g2, { type: 'produce', player: 0, source: hq(g2), kind: 'hum_barracks' });
    run(g2, 399);
    expect(snapshot(g2).buildings.find((b) => b.kind === 'hum_hq')!.queue[0]!.ready).toBe(false);
  });

  it('PRD-3: placement must be near own buildings, unblocked, unoccupied and explored; failures keep the ready item', () => {
    const g = createGame(base({ map: open({}, [10 * W + 12]) }));
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_barracks' });
    run(g, 401);
    const tryPlace = (tx: number, ty: number): number => {
      submit(g, { type: 'place', player: 0, source: hq(g), tx, ty });
      tick(g);
      return bld(g, 'hum_barracks').length;
    };
    expect(tryPlace(40, 5)).toBe(0); // too far from any own building
    expect(tryPlace(5, 5)).toBe(0); // overlaps the headquarters
    expect(tryPlace(11, 9)).toBe(0); // covers a blocked terrain tile (12,10)
    expect(snapshot(g).buildings.find((b) => b.kind === 'hum_hq')!.queue[0]!.ready).toBe(true);
    expect(tryPlace(5, 10)).toBe(1);
    expect(snapshot(g).buildings.find((b) => b.kind === 'hum_hq')!.queue).toEqual([]);
  });

  it('PRD-4: a placed structure blocks pathing and evicts units standing on it', () => {
    const g = createGame(base({ units: [{ owner: 0, kind: 'hum_rifleman', tx: 5, ty: 10 }] }));
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_barracks' });
    run(g, 401);
    submit(g, { type: 'place', player: 0, source: hq(g), tx: 5, ty: 10 });
    tick(g);
    const u = snapshot(g).units[0]!;
    const tx = Math.floor(u.x / FP);
    const ty = Math.floor(u.y / FP);
    expect(tx >= 5 && tx < 7 && ty >= 10 && ty < 12).toBe(false);
    expect(g.state.grid.blocked[10 * W + 5]).toBe(1);
  });

  it('PRD-5: a trained unit appears beside its building and walks to the rally point', () => {
    const cfg = base();
    cfg.buildings!.push({ owner: 0, kind: 'hum_barracks', tx: 14, ty: 5 });
    const g = createGame(cfg);
    const bid = bld(g, 'hum_barracks')[0]!.id;
    submit(g, { type: 'rally', player: 0, building: bid, x: 20 * FP + FP / 2, y: 14 * FP + FP / 2 });
    submit(g, { type: 'produce', player: 0, source: bid, kind: 'hum_rifleman' });
    submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_rifleman' }); // hq cannot train units
    run(g, 125);
    const u = snapshot(g).units;
    expect(u).toHaveLength(1);
    const gap = Math.max(Math.abs(Math.floor(u[0]!.x / FP) - 14.5), Math.abs(Math.floor(u[0]!.y / FP) - 5.5));
    expect(gap).toBeLessThan(5);
    run(g, 600);
    expect(Math.floor(snapshot(g).units[0]!.x / FP)).toBe(20);
    expect(Math.floor(snapshot(g).units[0]!.y / FP)).toBe(14);
  });

  it('PRD-6: the tech tree gates items until their prerequisite buildings are owned', () => {
    const g = createGame(base());
    const tryQueue = (kind: string): boolean => {
      const c = credits(g);
      submit(g, { type: 'produce', player: 0, source: hq(g), kind });
      tick(g);
      return credits(g) < c;
    };
    expect(tryQueue('hum_factory')).toBe(false);
    build(g, 'hum_barracks', 5, 10);
    build(g, 'hum_refinery', 9, 9);
    expect(tryQueue('hum_factory')).toBe(true);
  });

  it('PRD-7: selling refunds half and frees tiles; repairing restores hit points for credits', () => {
    const cfg = base();
    cfg.buildings!.push({ owner: 0, kind: 'hum_barracks', tx: 14, ty: 5 });
    const g = createGame(cfg);
    const bid = bld(g, 'hum_barracks')[0]!.id;
    const c = credits(g);
    submit(g, { type: 'sell', player: 0, building: bid });
    tick(g);
    expect(credits(g)).toBe(c + 200);
    expect(bld(g, 'hum_barracks')).toHaveLength(0);
    expect(g.state.grid.blocked[5 * W + 14]).toBe(0);

    const hqb = g.state.buildings.find((b) => b.kind === 'hum_hq')!;
    submit(g, { type: 'sell', player: 0, building: hqb.id }); // the headquarters cannot be sold
    tick(g);
    expect(bld(g, 'hum_hq')).toHaveLength(1);

    const reactor = g.state.buildings.find((b) => b.kind === 'hum_reactor')!;
    reactor.hp = 100;
    const c2 = credits(g);
    submit(g, { type: 'repair', player: 0, building: reactor.id, on: true });
    run(g, 120);
    expect(reactor.hp).toBeGreaterThan(100);
    expect(credits(g)).toBeLessThan(c2);
  });

  it('PRD-8: queues are first-in-first-out with a maximum length', () => {
    const cfg = base();
    cfg.buildings!.push({ owner: 0, kind: 'hum_barracks', tx: 14, ty: 5 });
    cfg.players![0]!.credits = 10_000;
    const g = createGame(cfg);
    const bid = bld(g, 'hum_barracks')[0]!.id;
    for (let i = 0; i < 2 * (QUEUE_MAX + 7); i++) submit(g, { type: 'produce', player: 0, source: bid, kind: i % 2 === 0 ? 'hum_rifleman' : 'hum_rocketeer' });
    tick(g);
    // rocketeers need a factory, so only riflemen are accepted, and the queue stops at the maximum
    expect(QUEUE_MAX).toBe(20);
    expect(snapshot(g).buildings.find((b) => b.id === bid)!.queue.length).toBe(QUEUE_MAX);
    const accepted = snapshot(g).buildings.find((b) => b.id === bid)!.queue.map((q) => q.kind);
    expect(accepted.every((k) => k === 'hum_rifleman')).toBe(true);
    run(g, 120 * accepted.length + 5);
    expect(snapshot(g).units.map((u) => u.kind)).toEqual(accepted);
  });
});

describe('queue cancel', () => {
  it('PRD-10: a full queue can be cancelled newest-first and every cancel refunds in full', () => {
    const cfg = base();
    cfg.buildings!.push({ owner: 0, kind: 'hum_barracks', tx: 14, ty: 5 });
    cfg.players![0]!.credits = 10_000;
    const g = createGame(cfg);
    const bid = bld(g, 'hum_barracks')[0]!.id;
    for (let i = 0; i < QUEUE_MAX + 3; i++) submit(g, { type: 'produce', player: 0, source: bid, kind: 'hum_rifleman' });
    tick(g);
    expect(snapshot(g).buildings.find((b) => b.id === bid)!.queue.length).toBe(QUEUE_MAX);
    const before = credits(g);
    for (const index of [19, 18, 17, 16, 15]) submit(g, { type: 'cancel', player: 0, source: bid, index });
    tick(g);
    expect(snapshot(g).buildings.find((b) => b.id === bid)!.queue.length).toBe(QUEUE_MAX - 5);
    expect(credits(g)).toBe(before + 5 * unitDef('hum_rifleman').cost);
  });
});

describe('fog and buildings', () => {
  it('FOG-5: enemy buildings show only when visible and are remembered as ghosts until seen again', () => {
    const cfg = base({ units: [{ owner: 0, kind: 'hum_buggy', tx: 20, ty: 38 }] });
    const g = createGame(cfg);
    const scout = snapshot(g).units[0]!.id;
    expect(snapshot(g, 0).buildings.some((b) => b.owner === 1)).toBe(false);
    submit(g, { type: 'move', player: 0, units: [scout], x: 31 * FP, y: 39 * FP });
    run(g, 200);
    expect(snapshot(g, 0).buildings.some((b) => b.owner === 1)).toBe(true);
    submit(g, { type: 'move', player: 0, units: [scout], x: 10 * FP, y: 39 * FP });
    run(g, 400);
    const away = snapshot(g, 0);
    expect(away.buildings.some((b) => b.owner === 1)).toBe(false);
    expect(away.ghosts.map((b) => b.kind)).toEqual(['ali_hq']);
    // The building disappears while unseen; the ghost stays until the tile is in view again.
    g.state.buildings = g.state.buildings.filter((b) => b.kind !== 'ali_hq');
    run(g, 5);
    expect(snapshot(g, 0).ghosts).toHaveLength(1);
    submit(g, { type: 'move', player: 0, units: [scout], x: 31 * FP, y: 39 * FP });
    run(g, 400);
    expect(snapshot(g, 0).ghosts).toHaveLength(0);
  });
});

describe('determinism and UI agreement', () => {
  it('DET-1: an economy scenario hashes identically for the same seed and commands, and differently otherwise', () => {
    const play = (kind: string): number => {
      const cfg = base({ map: open(field(20, 8, 2000)), units: [{ owner: 0, kind: 'hum_hauler', tx: 14, ty: 9 }] });
      cfg.buildings!.push({ owner: 0, kind: 'hum_refinery', tx: 12, ty: 6 });
      const g = createGame(cfg);
      submit(g, { type: 'produce', player: 0, source: hq(g), kind });
      run(g, 800);
      return hash(g);
    };
    expect(play('hum_barracks')).toBe(play('hum_barracks'));
    expect(play('hum_barracks')).not.toBe(play('hum_turret'));
  });

  it('UI-1: the shared placement check agrees with the simulation for every candidate tile', () => {
    const map = open({}, [8 * W + 8, 12 * W + 14]);
    const probe = (tx: number, ty: number): { ui: boolean; sim: boolean } => {
      const g = createGame(base({ map }));
      const s = snapshot(g, 0);
      const ui = canPlace(
        {
          width: W,
          height: W,
          terrain: map.blocked,
          occupied: [...s.buildings, ...s.ghosts],
          own: s.buildings.filter((b) => b.owner === 0),
          fog: s.fog!,
        },
        'hum_barracks',
        tx,
        ty,
      );
      submit(g, { type: 'produce', player: 0, source: hq(g), kind: 'hum_barracks' });
      run(g, 401);
      submit(g, { type: 'place', player: 0, source: hq(g), tx, ty });
      tick(g);
      return { ui, sim: bld(g, 'hum_barracks').length === 1 };
    };
    let accepted = 0;
    for (let ty = 0; ty < 22; ty += 2) {
      for (let tx = 0; tx < 22; tx += 2) {
        const r = probe(tx, ty);
        expect(r.ui).toBe(r.sim);
        if (r.sim) accepted++;
      }
    }
    expect(accepted).toBeGreaterThan(5);
  }, 30_000); // builds a game per candidate tile: slow on a busy machine
});

describe('harvester pricing', () => {
  it('ECO-6: training a harvester costs less than the refinery that spawns one', () => {
    expect(unitDef('hum_hauler').cost).toBeLessThan(buildingDef('hum_refinery').cost);
    expect(unitDef('ali_gorger').cost).toBeLessThan(buildingDef('ali_extractor').cost);
  });
});
