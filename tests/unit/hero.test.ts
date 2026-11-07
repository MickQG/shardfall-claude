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
    const legs = (p.root.kids ?? []).filter((k) => k.anim?.k === 'step');
    expect(legs).toHaveLength(4);
    // A diagonal trot: each front leg is in step with the hind leg on the other side.
    const phase = (x: number, z: number): number => (legs.find((l) => Math.sign(l.at![0]) === x && Math.sign(l.at![2]) === z)!.anim as { phase: number }).phase;
    expect(phase(1, 1)).toBe(phase(-1, -1));
    expect(phase(1, -1)).toBe(phase(-1, 1));
    expect(phase(1, 1)).not.toBe(phase(1, -1));
    expect((p.scale ?? 1) / (tank.scale ?? 1)).toBeGreaterThanOrEqual(2);
    // Long and low on thick legs: measured from the built model.
    const THREE = await import('three');
    const { rigTree } = await import('../../src/render3d/rig');
    const tree = rigTree(p);
    tree.root.updateMatrixWorld(true);
    const all = new THREE.Box3();
    let legBox: InstanceType<typeof THREE.Box3> | undefined;
    const sizeOf: Record<string, InstanceType<typeof THREE.Vector3>> = {};
    for (const d of tree.drawn) {
      const b = p.shapes[d.geo]!().build(0xffffff);
      const geo = (b.lit ?? b.glow)!;
      geo.computeBoundingBox();
      const box = geo.boundingBox!.clone().applyMatrix4(d.obj.matrixWorld);
      all.union(box);
      sizeOf[d.geo] = box.getSize(new THREE.Vector3());
      // A leg is its thigh, shin and foot together (HERO-6): measured as one, the first leg's.
      if (['thigh', 'shin', 'foot'].includes(d.geo) && tree.drawn.indexOf(d) < tree.drawn.findIndex((x) => x.geo === 'thigh') + 3) (legBox ??= new THREE.Box3()).union(box);
    }
    sizeOf.leg = legBox!.getSize(new THREE.Vector3());
    const whole = all.getSize(new THREE.Vector3());
    expect(whole.x / whole.y).toBeGreaterThanOrEqual(1.4);
    expect(sizeOf.leg!.y).toBeLessThan(sizeOf.hull!.x);
    expect(Math.min(sizeOf.leg!.x, sizeOf.leg!.z)).toBeGreaterThanOrEqual(0.25);
    expect(sizeOf.pod).toBeDefined(); // the missile pods are parts of their own (HERO-3)
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

  it('HERO-1: the Paladin walks smoothly with a long stride and gently eased feet', async () => {
    const { UNIT_RIGS } = await import('../../src/render3d/units3d');
    const { footLift } = await import('../../src/render3d/rig');
    const p = UNIT_RIGS.hum_paladin!();
    expect(p.stride ?? 1).toBeGreaterThanOrEqual(1.8);
    const legs = (p.root.kids ?? []).filter((k) => k.anim?.k === 'step');
    expect(legs).toHaveLength(4);
    // Each foot lifts on the eased curve (HERO-6 steps through footLift).
    const { stepPath } = await import('../../src/render3d/rig');
    for (let ph = 0; ph < 7; ph += 0.1) expect(stepPath(ph).lift).toBeCloseTo(footLift(ph, true), 12);
    // An eased foot sets down with no jerk: its height approaches the ground flat, unlike the plain curve.
    const slope = (ease: boolean): number => (footLift(Math.PI / 2 - 1e-3, ease) - footLift(Math.PI / 2 - 2e-3, ease)) / 1e-3;
    expect(Math.abs(slope(true))).toBeLessThan(0.01);
    expect(Math.abs(slope(false))).toBeGreaterThan(0.9);
    for (let ph = 0; ph < 7; ph += 0.1) {
      expect(footLift(ph, true)).toBeGreaterThanOrEqual(0);
      expect(footLift(ph, true)).toBeLessThanOrEqual(footLift(ph, false));
    }
  });

  it('HERO-1: the Paladin cannons fire with a bigger flash, recoil, shake and side blasts than an ordinary cannon', async () => {
    const { UNIT_RIGS } = await import('../../src/render3d/units3d');
    const { CombatFx, LOOKS } = await import('../../src/render3d/fx3d');
    const THREE = await import('three');
    const p = UNIT_RIGS.hum_paladin!();
    expect(p.weapon).toBe('heroCannon');
    expect(LOOKS.heroCannon.flash).toBeGreaterThan(LOOKS.cannon.flash);
    expect(LOOKS.heroCannon.shake).toBeGreaterThan(LOOKS.cannon.shake);
    expect(LOOKS.heroCannon.len).toBeGreaterThan(LOOKS.cannon.len);
    let recoil = 0;
    const find = (n: { anim?: { k: string; recoil?: number }; kids?: unknown[] }): void => {
      if (n.anim?.k === 'barrel') recoil = n.anim.recoil ?? 0;
      for (const k of (n.kids ?? []) as never[]) find(k);
    };
    find(p.root as never);
    expect(recoil).toBeGreaterThanOrEqual(0.12);
    const count = (look: 'cannon' | 'heroCannon'): number => {
      const fx = new CombatFx();
      fx.muzzle(look, new THREE.Vector3(5, 1, 5), new THREE.Vector3(1, 0, 0), 0);
      fx.update(10, 0.01);
      return fx.particleCount;
    };
    expect(count('heroCannon')).toBeGreaterThan(count('cannon') + 5);
  });

  it('HERO-3: a hero is blown apart: parts thrown out one by one with the blasts, the hull last, each landing and coming to rest', async () => {
    const { planBreakup, pieceAt, BREAK_FINAL_MS, BREAK_FIRST_MS } = await import('../../src/render3d/breakup');
    const starts = [
      { x: 0, y: 1.2, z: 0, size: 1.2 }, // hull
      { x: 0.7, y: 0.6, z: 0.6, size: 0.6 },
      { x: 0.7, y: 0.6, z: -0.6, size: 0.6 },
      { x: -0.8, y: 0.6, z: 0.6, size: 0.6 },
      { x: -0.8, y: 0.6, z: -0.6, size: 0.6 },
      { x: 1.2, y: 0.9, z: 0, size: 0.8 },
      { x: -0.2, y: 1.5, z: 0.7, size: 0.3 },
    ];
    const plan = planBreakup(starts, 7);
    expect(planBreakup(starts, 7)).toEqual(plan); // deterministic
    expect(plan[0]!.at).toBe(BREAK_FINAL_MS);
    const others = plan.slice(1).map((p) => p.at);
    expect(Math.min(...others)).toBeGreaterThanOrEqual(BREAK_FIRST_MS);
    expect(Math.max(...others)).toBeLessThan(BREAK_FINAL_MS);
    expect(new Set(others.map((a) => Math.floor(a / 170))).size).toBeGreaterThan(3); // one after another
    plan.forEach((p, i) => {
      const s = starts[i]!;
      // Still in place (only shaking) before its blast.
      const before = pieceAt(p, p.at - 1);
      expect(Math.hypot(before.x - s.x, before.z - s.z)).toBeLessThan(0.02);
      // Never below its resting height; flies outward from where it sat; ends at rest.
      let maxY = 0;
      for (let a = p.at; a < p.at + 4000; a += 10) {
        const q = pieceAt(p, a);
        expect(q.y).toBeGreaterThanOrEqual(p.floor - 1e-9);
        maxY = Math.max(maxY, q.y);
      }
      expect(maxY).toBeGreaterThan(s.y);
      const end = pieceAt(p, p.at + 4000);
      expect(end.resting).toBe(true);
      expect(end.y).toBeCloseTo(p.floor);
      expect(pieceAt(p, p.at + 5000)).toEqual(end);
      if (i > 0) expect(end.x * s.x + end.z * s.z).toBeGreaterThan(s.x * s.x + s.z * s.z);
    });
  });

  it('R3D-12: Aegis shells and rockets burst dimmer than a death', async () => {
    const { SHOT_BLAST_DIM } = await import('../../src/render3d/fx3d');
    expect(SHOT_BLAST_DIM).toBeGreaterThan(0.4);
    expect(SHOT_BLAST_DIM).toBeLessThanOrEqual(0.7);
  });

  it('HERO-4: heroes fire slow, heavy shots that burst over an area, with no less sustained firepower than before', () => {
    const tank = unitDef('hum_tank').weapon!;
    for (const kind of ['hum_paladin', 'ali_strider']) {
      const w = unitDef(kind).weapon!;
      expect(w.cooldown, kind).toBeGreaterThanOrEqual(30); // 1.5 s at 20 ticks a second
      expect(w.damage, kind).toBeGreaterThanOrEqual(2 * tank.damage);
      expect(w.splash ?? 0, kind).toBeGreaterThan(0);
      expect(w.antiAir, kind).toBe(true);
      // The old weapon: 46 damage every 16 ticks.
      expect(w.damage / w.cooldown, kind).toBeGreaterThanOrEqual(46 / 16);
    }
  });

  it('HERO-4: a hero shell hurts every enemy close to its target, and still hits an aircraft it is aimed at', () => {
    const run = (enemy: string): number[] => {
      const g = createGame(cfg([
        { owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 },
        { owner: 1, kind: enemy, tx: 25, ty: 20 },
        { owner: 1, kind: enemy, tx: 25, ty: 21 },
      ]));
      const start = g.state.units.filter((u) => u.owner === 1).map((u) => u.hp);
      const hero = g.state.units.find((u) => u.kind === 'hum_paladin')!;
      const first = g.state.units.find((u) => u.owner === 1)!;
      submit(g, { type: 'attack', player: 0, units: [hero.id], target: first.id });
      for (let t = 0; t < 30; t++) tick(g); // one shot lands (it flies 8 ticks; the next leaves after 36)
      return g.state.units.filter((u) => u.owner === 1).map((u, i) => (start[i] as number) - u.hp);
    };
    const [hit, beside] = run('ali_brute');
    expect(hit).toBeGreaterThan(0);
    expect(beside).toBeGreaterThan(0); // never aimed at, hurt by the burst
    const [air] = run(FLYER);
    expect(air).toBeGreaterThan(0);
  });

  it('HERO-4: the hero shot has its own animation: the body heaves, and shells and acid globs are heavier than other weapons', async () => {
    const { heroHeave, HEAVE_RISE_MS } = await import('../../src/render3d/motion');
    const { UNIT_RIGS } = await import('../../src/render3d/units3d');
    const { CombatFx, LOOKS } = await import('../../src/render3d/fx3d');
    const THREE = await import('three');
    // The Paladin rocks back (nose up, squatting); the Dreadstrider lunges (head down); both settle within two seconds.
    expect(heroHeave('heroCannon', HEAVE_RISE_MS).pitch).toBeGreaterThan(0.08);
    expect(heroHeave('heroCannon', HEAVE_RISE_MS).bob).toBeLessThan(0);
    expect(heroHeave('heroAcid', HEAVE_RISE_MS).pitch).toBeLessThan(-0.08);
    expect(Math.abs(heroHeave('heroCannon', 2000).pitch)).toBeLessThan(0.01);
    expect(heroHeave('cannon', HEAVE_RISE_MS)).toEqual({ pitch: 0, roll: 0, bob: 0 });
    expect(heroHeave('heroCannon', -5).pitch).toBe(0);
    expect(UNIT_RIGS.ali_strider!().weapon).toBe('heroAcid');
    // A flat, straight shell (BAL-4) with a smoke trail, longer than a tank's; a bigger acid bolt than the Lobber's glob.
    expect(LOOKS.heroCannon.arc).toBe(0);
    expect(LOOKS.heroCannon.len).toBeGreaterThan(LOOKS.cannon.len);
    expect(LOOKS.heroCannon.smokeTrail).toBe(true);
    expect(LOOKS.heroAcid.width).toBeGreaterThan(LOOKS.acidBig.width);
    expect(LOOKS.heroAcid.flash).toBeGreaterThan(LOOKS.acidBig.flash);
    const count = (look: 'acidBig' | 'heroAcid'): number => {
      const fx = new CombatFx();
      fx.muzzle(look, new THREE.Vector3(5, 1, 5), new THREE.Vector3(1, 0, 0), 0);
      fx.update(10, 0.01);
      return fx.particleCount;
    };
    expect(count('heroAcid')).toBeGreaterThan(count('acidBig') + 5);
  });
});
