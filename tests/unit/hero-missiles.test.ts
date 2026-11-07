import { describe, expect, it } from 'vitest';
import { FLYER } from './flyer';
import { DAMAGE_PCT, unitDef } from '../../src/data/defs';
import { createGame, tick, type Game, type GameConfig } from '../../src/sim';
import { MISSILE_ARC, missileLandsAt, missileLaunchAt, missilePositions, POD_CLOSE_MS, POD_OPEN_MS, podOpen, salvoOf } from '../../src/render3d/motion';
import { poseRig, rigTree, type RigPose } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const W = 48;
const cfg = (units: GameConfig['units']): GameConfig => ({
  seed: 1,
  map: { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) },
  players: [
    { faction: 'human', credits: 0 },
    { faction: 'alien', credits: 0 },
  ],
  buildings: [
    { owner: 0, kind: 'hum_hq', tx: 2, ty: 2 },
    { owner: 1, kind: 'ali_hq', tx: 40, ty: 40 },
  ],
  units,
});

const pod = unitDef('hum_paladin').weapon2!;
interface Missile {
  tick: number;
  delay: number;
  air: boolean;
}
const hero = (g: Game) => g.state.units.find((u) => u.kind === 'hum_paladin')!;
/** Run `n` ticks with the cannon held off, collecting the missile shots the Paladin makes. */
function run(g: Game, n: number): Missile[] {
  const out: Missile[] = [];
  for (let i = 0; i < n; i++) {
    hero(g).cooldown = 1000; // the cannon stays quiet: only the pods act
    tick(g);
    for (const e of g.state.events) if (e.t === 'shot' && e.weapon === 'missile') out.push({ tick: g.state.tick, delay: e.delay ?? 0, air: e.air });
  }
  return out;
}

describe('the Paladin missile pods (HERO-7)', () => {
  it('HERO-7: the second weapon is a four-missile salvo every 80 ticks at range 9, 10 splash damage each, ground and air', () => {
    expect(pod).toMatchObject({ damage: 10, range: 9, cooldown: 80, antiAir: true, antiGround: true });
    expect(pod.salvo?.count).toBe(4);
    expect(pod.splash).toBeGreaterThan(0);
    // The cannon and the hit points are as BAL-15 left them.
    expect(unitDef('hum_paladin')).toMatchObject({ hp: 4500, weapon: { damage: 90, range: 7, cooldown: 36 } });
  });

  it('HERO-7: a salvo is four missiles launched a few ticks apart, and the next salvo comes 80 ticks after', () => {
    const g = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: 'ali_gorger', tx: 28, ty: 20 }]));
    g.state.units.find((u) => u.kind === 'ali_gorger')!.hp = 9000; // outlasts three salvos
    const shots = run(g, 200);
    const firstTick = shots[0]!.tick;
    const salvos = [...new Set(shots.map((m) => m.tick))];
    expect(salvos.slice(0, 3)).toEqual([firstTick, firstTick + 80, firstTick + 160]);
    expect(shots.filter((m) => m.tick === firstTick).map((m) => m.delay)).toEqual([0, 3, 6, 9]);
    expect(shots).toHaveLength(12);
  });

  it('HERO-7: it fires at range 9 but not beyond it', () => {
    const near = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: 'ali_gorger', tx: 28, ty: 20 }]));
    expect(run(near, 40).length).toBeGreaterThan(0);
    const far = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: 'ali_gorger', tx: 31, ty: 20 }]));
    expect(run(far, 3)).toEqual([]);
  });

  it('HERO-7: each missile does its own damage when it lands, one after another, with splash on the ground units around it', () => {
    const g = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: 'ali_gorger', tx: 28, ty: 20 }, { owner: 1, kind: 'ali_gorger', tx: 28, ty: 21 }]));
    const [a, b] = g.state.units.filter((u) => u.kind === 'ali_gorger');
    const hp = new Map<number, number>();
    let launched = -1;
    for (let i = 0; i < 40; i++) {
      hero(g).cooldown = 1000;
      tick(g);
      if (launched < 0 && g.state.events.some((e) => e.t === 'shot' && e.weapon === 'missile')) launched = g.state.tick;
      hp.set(g.state.tick, a!.hp);
    }
    expect(launched).toBeGreaterThan(0);
    const full = Math.floor((pod.damage * DAMAGE_PCT.rocket.heavy) / 100);
    const { flight, salvo } = pod;
    // Nothing lands while the first missile flies; then four separate drops, `gap` ticks apart, each a good part of a missile.
    const landing = (i: number): number => launched + flight! + i * salvo!.gap;
    expect(hp.get(landing(0) - 1)).toBe(hp.get(launched));
    for (let i = 0; i < 4; i++) {
      const drop = hp.get(landing(i) - 1)! - hp.get(landing(i))!;
      expect(drop).toBeGreaterThanOrEqual(Math.floor(full / 2));
      expect(drop).toBeLessThanOrEqual(full);
    }
    // The other Gorger, a tile away, is hurt by the same missiles.
    expect(b!.hp).toBeLessThan(unitDef('ali_gorger').hp);
  });

  it('HERO-7: it hits aircraft too', () => {
    const g = createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: FLYER, tx: 28, ty: 20 }]));
    const f = g.state.units.find((u) => u.kind === FLYER)!;
    f.hp = 5000;
    const shots = run(g, 30);
    expect(shots.some((m) => m.air)).toBe(true);
    expect(f.hp).toBeLessThan(5000);
  });

  it('HERO-7: two runs of the same match agree, the pods included', () => {
    const mk = (): Game => createGame(cfg([{ owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 }, { owner: 1, kind: 'hum_tank', tx: 27, ty: 20 }]));
    const a = mk();
    const b = mk();
    for (let i = 0; i < 300; i++) {
      tick(a);
      tick(b);
    }
    expect(a.state.units.map((u) => [u.hp, u.cooldown2])).toEqual(b.state.units.map((u) => [u.hp, u.cooldown2]));
  });
});

describe('the Paladin missile pods in 3D (HERO-7)', () => {
  const v = salvoOf('hum_paladin', 50);
  const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: true };

  it('HERO-7: the pods are closed at rest, open while the missiles leave and fold shut afterwards, as a pure function of time', () => {
    expect(v.count).toBe(4);
    expect(podOpen(-10, v)).toBe(0);
    expect(podOpen(0, v)).toBe(0);
    expect(podOpen(POD_OPEN_MS / 2, v)).toBeCloseTo(0.5);
    expect(podOpen(POD_OPEN_MS, v)).toBe(1);
    expect(podOpen(missileLaunchAt(v, 3), v)).toBe(1);
    expect(podOpen(missileLaunchAt(v, 3) + POD_CLOSE_MS, v)).toBe(0);
    expect(podOpen(700, v)).toBe(podOpen(700, v));
    // Closed pods sit as modelled; open ones tilt their mouths up.
    const tree = rigTree(UNIT_RIGS.hum_paladin!());
    const pods = tree.anims.filter((x) => x.anim.k === 'pod');
    expect(pods).toHaveLength(2);
    poseRig(tree, { ...STILL, pod: 0 });
    const closed = pods.map((p) => p.obj.rotation.z);
    poseRig(tree, { ...STILL, pod: 1 });
    for (const [i, p] of pods.entries()) expect(p.obj.rotation.z).toBeGreaterThan(closed[i]! + 0.3);
    poseRig(tree, { ...STILL, pod: 0 });
    for (const [i, p] of pods.entries()) expect(p.obj.rotation.z).toBeCloseTo(closed[i]!);
  });

  it('HERO-7: missiles leave one after another and fly an arc from the pod to the landing, each landing in its turn', () => {
    const from = [0, 2, 0] as const;
    const to = [8, 0, 0] as const;
    const at = (t: number) => missilePositions(from, to, t, v);
    expect(at(0).every((p) => p === null)).toBe(true);
    const t1 = missileLaunchAt(v, 0) + v.flightMs / 2;
    expect(at(t1)[0]).not.toBeNull();
    expect(at(t1)[3]).toBeNull();
    const mid = at(t1)[0]!;
    // Halfway along: halfway across, and above the straight line by the arc.
    expect(mid[0]).toBeCloseTo(4);
    expect(mid[1]).toBeCloseTo(1 + MISSILE_ARC * Math.hypot(8, 2));
    // Pure: the same time gives the same positions, and each missile is gone the moment it lands.
    expect(at(t1)).toEqual(at(t1));
    for (let i = 0; i < 4; i++) {
      expect(at(missileLandsAt(v, i) - 1)[i]).not.toBeNull();
      expect(at(missileLandsAt(v, i))[i]).toBeNull();
    }
    expect(missileLandsAt(v, 3) - missileLandsAt(v, 0)).toBe(3 * v.gapMs);
  });
});
