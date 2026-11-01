import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES } from '../../src/ai/ai';
import { FLYER } from './flyer';
import { DAMAGE_PCT, unitDef, UNIT_DEFS } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, snapshot, submit, tick, type Game, type GameConfig } from '../../src/sim';
import { queueRefusal } from '../../src/ui/feedback';

const W = 48;
const cfg = (units: GameConfig['units'] = []): GameConfig => ({
  seed: 1,
  map: { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) },
  players: [
    { faction: 'human', credits: 20000 },
    { faction: 'alien', credits: 5000 },
  ],
  buildings: [
    { owner: 0, kind: 'hum_hq', tx: 5, ty: 5 },
    { owner: 0, kind: 'hum_reactor', tx: 9, ty: 5 },
    { owner: 0, kind: 'hum_reactor', tx: 12, ty: 5 },
    { owner: 0, kind: 'hum_factory', tx: 5, ty: 10 },
    { owner: 0, kind: 'hum_factory', tx: 10, ty: 10 },
    { owner: 0, kind: 'hum_lab', tx: 15, ty: 10 },
    { owner: 1, kind: 'ali_hq', tx: 38, ty: 38 },
  ],
  units,
});
const factories = (g: Game): number[] => snapshot(g).buildings.filter((b) => b.owner === 0 && b.kind === 'hum_factory').map((b) => b.id);
const queued = (g: Game, kind: string): number => snapshot(g).buildings.reduce((n, b) => n + b.queue.filter((q) => q.kind === kind).length, 0);

describe('the Paladin hero', () => {
  it('HERO-1: the Aegis Gunship is gone; the Paladin is a tough, self-repairing ground tank that hits ground and air', () => {
    expect(UNIT_DEFS.hum_gunship).toBeUndefined();
    const d = unitDef('hum_paladin');
    expect(d).toMatchObject({ faction: 'human', builtAt: 'hum_factory', requires: ['hum_lab'], hero: true, armor: 'heavy' });
    expect(d.air).toBeFalsy();
    expect(d.weapon).toMatchObject({ antiAir: true, antiGround: true });
    expect(DAMAGE_PCT[d.weapon!.type].air).toBeGreaterThanOrEqual(100);
    expect(d.hp).toBeGreaterThanOrEqual(2.5 * unitDef('hum_tank').hp);
    expect(d.regen).toBeGreaterThan(0);
    // No Aegis unit flies any more.
    expect(Object.values(UNIT_DEFS).filter((u) => u.faction === 'human' && u.air)).toEqual([]);
  });

  it('HERO-1: only one at a time: a second is refused while one is queued or alive, and allowed again after it dies', () => {
    const g = createGame(cfg());
    const [a, b] = factories(g);
    submit(g, { type: 'produce', player: 0, source: a!, kind: 'hum_paladin' });
    submit(g, { type: 'produce', player: 0, source: b!, kind: 'hum_paladin' });
    submit(g, { type: 'produce', player: 0, source: a!, kind: 'hum_paladin' });
    tick(g);
    expect(queued(g, 'hum_paladin')).toBe(1);
    // Built and alive: still one at a time.
    for (let i = 0; i < 2000 && !g.state.units.some((u) => u.kind === 'hum_paladin'); i++) tick(g);
    expect(g.state.units.filter((u) => u.kind === 'hum_paladin')).toHaveLength(1);
    submit(g, { type: 'produce', player: 0, source: b!, kind: 'hum_paladin' });
    tick(g);
    expect(queued(g, 'hum_paladin')).toBe(0);
    // Once it dies, another may be ordered.
    g.state.units.find((u) => u.kind === 'hum_paladin')!.hp = 0;
    tick(g);
    submit(g, { type: 'produce', player: 0, source: b!, kind: 'hum_paladin' });
    tick(g);
    expect(queued(g, 'hum_paladin')).toBe(1);
  });

  it('HERO-1: the sidebar says why a second cannot be ordered', () => {
    expect(queueRefusal('hum_paladin', ['hum_factory', 'hum_lab'], 9999, true, true)).toBe('Only one at a time');
    expect(queueRefusal('hum_paladin', ['hum_factory', 'hum_lab'], 9999, true, false)).toBeNull();
  });

  it('HERO-1: it shoots aircraft as well as ground units', () => {
    const g = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: FLYER, tx: 23, ty: 20 }]));
    const wasp = g.state.units.find((u) => u.kind === FLYER)!;
    const hp0 = wasp.hp;
    for (let i = 0; i < 60; i++) tick(g);
    expect(g.state.units.find((u) => u.id === wasp.id)?.hp ?? 0).toBeLessThan(hp0);
  });

  it('HERO-1: the AI never has two at once', () => {
    const base = skirmishConfig(3, { credits: 30000 });
    const c: GameConfig = { ...base, buildings: [...(base.buildings ?? []), { owner: 0, kind: 'hum_factory', tx: 20, ty: 10 }, { owner: 0, kind: 'hum_factory', tx: 24, ty: 10 }, { owner: 0, kind: 'hum_lab', tx: 20, ty: 15 }, { owner: 0, kind: 'hum_reactor', tx: 26, ty: 15 }, { owner: 0, kind: 'hum_reactor', tx: 26, ty: 18 }] };
    const g = createGame(c);
    const ai = new AI(0, 'human', DIFFICULTIES.hard, c.map, 3);
    let most = 0;
    for (let t = 0; t < 3000; t++) {
      if (g.state.tick % ai.diff.thinkEvery === 0) for (const cmd of ai.think(snapshot(g, 0))) submit(g, cmd);
      tick(g);
      const n = g.state.units.filter((u) => u.owner === 0 && u.kind === 'hum_paladin').length + queued(g, 'hum_paladin');
      most = Math.max(most, n);
    }
    expect(most).toBe(1); // it does build one, and never a second
  }, 120_000);
});

describe('the Dreadstrider hero', () => {
  const alien = (): GameConfig => ({
    seed: 1,
    map: { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) },
    players: [
      { faction: 'alien', credits: 20000 },
      { faction: 'human', credits: 5000 },
    ],
    buildings: [
      { owner: 0, kind: 'ali_hq', tx: 5, ty: 5 },
      { owner: 0, kind: 'ali_generator', tx: 9, ty: 5 },
      { owner: 0, kind: 'ali_generator', tx: 12, ty: 5 },
      { owner: 0, kind: 'ali_generator', tx: 15, ty: 5 },
      { owner: 0, kind: 'ali_pit', tx: 5, ty: 10 },
      { owner: 0, kind: 'ali_pit', tx: 10, ty: 10 },
      { owner: 0, kind: 'ali_evolver', tx: 15, ty: 10 },
      { owner: 1, kind: 'hum_hq', tx: 38, ty: 38 },
    ],
  });

  it('HERO-2: the Wasp is gone; the Dreadstrider is a tough, regenerating six-legged walker that hits ground and air', () => {
    expect(UNIT_DEFS.ali_wasp).toBeUndefined();
    const d = unitDef('ali_strider');
    expect(d).toMatchObject({ faction: 'alien', builtAt: 'ali_pit', requires: ['ali_evolver'], hero: true, armor: 'heavy' });
    expect(d.air).toBeFalsy();
    expect(d.weapon).toMatchObject({ antiAir: true, antiGround: true });
    expect(d.regen).toBeGreaterThan(0);
    // A match for the Paladin.
    const p = unitDef('hum_paladin');
    expect(d.hp).toBe(p.hp);
    expect(d.weapon!.damage / d.weapon!.cooldown).toBeCloseTo(p.weapon!.damage / p.weapon!.cooldown, 5);
    expect(d.cost).toBe(p.cost);
    // Neither faction fields aircraft any more.
    expect(Object.entries(UNIT_DEFS).filter(([k, u]) => u.air && !k.startsWith('test_'))).toEqual([]);
  });

  it('HERO-2: only one at a time, like the Paladin', () => {
    const g = createGame(alien());
    const pits = snapshot(g).buildings.filter((b) => b.owner === 0 && b.kind === 'ali_pit').map((b) => b.id);
    for (const p of [...pits, ...pits]) submit(g, { type: 'produce', player: 0, source: p, kind: 'ali_strider' });
    tick(g);
    expect(queued(g, 'ali_strider')).toBe(1);
    expect(queueRefusal('ali_strider', ['ali_pit', 'ali_evolver'], 9999, true, true)).toBe('Only one at a time');
  });

  it('HERO-2: it shoots aircraft as well as ground units', () => {
    const g = createGame({ ...alien(), units: [{ owner: 0, kind: 'ali_strider', tx: 20, ty: 20 }, { owner: 1, kind: FLYER, tx: 23, ty: 20 }, { owner: 1, kind: 'hum_rifleman', tx: 20, ty: 23 }] });
    const flyer = g.state.units.find((u) => u.kind === FLYER)!;
    for (let i = 0; i < 160; i++) tick(g);
    expect(g.state.units.find((u) => u.id === flyer.id)?.hp ?? 0).toBeLessThan(unitDef(FLYER).hp);
  });
});

describe('hero looks and deaths', () => {
  it('HERO-1: the Paladin is a four-legged walker about twice the size of a tank, with 3000 hit points', async () => {
    const { UNIT_RIGS } = await import('../../src/render3d/units3d');
    const p = UNIT_RIGS.hum_paladin!();
    const tank = UNIT_RIGS.hum_tank!();
    expect(p.move).toBe('walker');
    const legs = (p.root.kids ?? []).filter((k) => k.geo === 'leg');
    expect(legs).toHaveLength(4);
    // A diagonal trot: each front leg is in step with the hind leg on the other side.
    const phase = (x: number, z: number): number => (legs.find((l) => Math.sign(l.at![0]) === x && Math.sign(l.at![2]) === z)!.anim as { phase: number }).phase;
    expect(phase(1, 1)).toBe(phase(-1, -1));
    expect(phase(1, -1)).toBe(phase(-1, 1));
    expect(phase(1, 1)).not.toBe(phase(1, -1));
    const size = (d: { height: number; scale?: number }): number => d.height * (d.scale ?? 1);
    expect(size(p) / size(tank)).toBeGreaterThan(3.5); // much taller: a walker rather than a hull
    expect((p.scale ?? 1) / (tank.scale ?? 1)).toBeGreaterThanOrEqual(2);
    expect(unitDef('hum_paladin').hp).toBe(3000);
    expect(unitDef('ali_strider').hp).toBe(3000);
  });

  it('HERO-3: a hero dies in a long chain of blasts, a final shockwave with debris, lasting fires and a hard shake', async () => {
    const { CombatFx } = await import('../../src/render3d/fx3d');
    const THREE = await import('three');
    for (const organic of [false, true]) {
      const fx = new CombatFx();
      fx.heroDeath(new THREE.Vector3(10, 0, 10), organic, 2.4, 0);
      fx.update(16, 0.016);
      const first = fx.particleCount;
      expect(first).toBeGreaterThan(10);
      expect(fx.shake).toBeGreaterThan(0.1);
      // Blasts keep coming for over a second; the final one shakes harder.
      fx.update(700, 0.016);
      expect(fx.particleCount).toBeGreaterThan(10);
      fx.update(1400, 0.016);
      expect(fx.shake).toBeGreaterThan(0.2); // the earlier shake has died away; this is the final blast's
      // Several seconds later the wreck still burns and smokes.
      for (let t = 1400; t <= 6000; t += 100) fx.update(t, 0.1);
      expect(fx.particleCount).toBeGreaterThan(5);
    }
  });

  it('R3D-12: Aegis shells and rockets burst dimmer than a death', async () => {
    const { SHOT_BLAST_DIM } = await import('../../src/render3d/fx3d');
    expect(SHOT_BLAST_DIM).toBeGreaterThan(0.4);
    expect(SHOT_BLAST_DIM).toBeLessThanOrEqual(0.7);
  });
});
