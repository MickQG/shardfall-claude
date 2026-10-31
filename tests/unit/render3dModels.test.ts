import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_DEFS, UNIT_DEFS, unitDef } from '../../src/data/defs';
import { createGame, hash, snapshot, tick, type GameConfig, type SimEvent } from '../../src/sim';
import { BUILDING_RIGS, crystalShape } from '../../src/render3d/buildings3d';
import { CombatFx, LOOKS, shotDuration } from '../../src/render3d/fx3d';
import { Instancer } from '../../src/render3d/instancer';
import { Shape } from '../../src/render3d/kit';
import { angleDiff, bodyPose, gaitPhase, restingMotion, stepMotion, turnToward } from '../../src/render3d/motion';
import { muzzleCount, poseRig, recoil, rigTree, type RigPose } from '../../src/render3d/rig';
import { LEVEL_H, ROCK_AMP, rockOffset, scatter, terrainMeshes } from '../../src/render3d/terrain3d';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

describe('procedural models', () => {
  it('R3D-3: every unit and building kind has a procedural model of shaped parts, not blocks', () => {
    for (const kind of Object.keys(UNIT_DEFS)) expect(UNIT_RIGS[kind], kind).toBeDefined();
    for (const kind of Object.keys(BUILDING_DEFS)) expect(BUILDING_RIGS[kind], kind).toBeDefined();
    for (const [kind, make] of [...Object.entries(UNIT_RIGS), ...Object.entries(BUILDING_RIGS)]) {
      const def = make();
      let pieces = 0;
      let round = 0;
      for (const shape of Object.values(def.shapes)) {
        const s = shape();
        pieces += s.pieces.length;
        round += s.pieces.filter((p) => !(p.geo instanceof THREE.BoxGeometry)).length;
        const b = s.build(0x3fa0ff);
        expect(b.lit ?? b.glow, `${kind} builds`).not.toBeNull();
      }
      expect(pieces, `${kind} has detail`).toBeGreaterThanOrEqual(8);
      expect(round, `${kind} is not all boxes`).toBeGreaterThan(0);
      expect(def.radius).toBeGreaterThan(0);
      expect(def.height).toBeGreaterThan(0);
    }
  });

  it('R3D-3: every armed unit and building has a muzzle point; turrets turn on their own pivot', () => {
    for (const kind of Object.keys(UNIT_DEFS)) if (unitDef(kind).weapon) expect(muzzleCount(UNIT_RIGS[kind]!()), kind).toBeGreaterThan(0);
    for (const [kind, d] of Object.entries(BUILDING_DEFS)) if (d.weapon) expect(muzzleCount(BUILDING_RIGS[kind]!()), kind).toBeGreaterThan(0);
    for (const kind of ['hum_tank', 'hum_artillery', 'hum_buggy', 'hum_turret', 'ali_spire']) {
      const def = (UNIT_RIGS[kind] ?? BUILDING_RIGS[kind])!();
      expect(rigTree(def).anims.some((a) => a.anim.k === 'turret'), kind).toBe(true);
    }
  });

  it('R3D-3: team paint takes the owner colour, glowing parts are split out, crystals shrink as they deplete', () => {
    const s = new Shape().box(0.4, 0.2, 0.3, 'team').ball(0.05, 0x00ff00, { glow: true }).cyl(0.1, 0.2, 0x808080);
    const blue = s.build(0x0000ff);
    const cols = blue.lit!.attributes.color!.array;
    let teamVerts = 0;
    for (let i = 0; i < cols.length; i += 3) if (cols[i] === 0 && cols[i + 1] === 0 && cols[i + 2] === 1) teamVerts++;
    expect(teamVerts).toBeGreaterThan(0);
    expect(blue.glow!.attributes.position!.count).toBeGreaterThan(0);
    expect(crystalShape(1, 3).build(0).triangles).toBeLessThan(crystalShape(4, 3).build(0).triangles);
  });

  it('R3D-3: a strut runs exactly from one joint to the other', () => {
    const b = new Shape().strut([0.1, 0.2, -0.3], [0.4, -0.1, 0.2], 0.01, 0xffffff).build(0);
    const box = new THREE.Box3().setFromBufferAttribute(b.lit!.attributes.position as THREE.BufferAttribute);
    expect(box.min.x).toBeCloseTo(0.1, 1);
    expect(box.max.x).toBeCloseTo(0.4, 1);
    expect(box.min.y).toBeCloseTo(-0.1, 1);
    expect(box.max.z).toBeCloseTo(0.2, 1);
  });
});

describe('events name who fired and what died', () => {
  const W = 30;
  const cfg: GameConfig = {
    seed: 5,
    map: { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0) },
    units: [
      { owner: 0, kind: 'hum_tank', tx: 10, ty: 10 },
      { owner: 1, kind: 'ali_skitter', tx: 13, ty: 10 },
    ],
  };
  const run = (): { events: SimEvent[]; hash: number } => {
    const g = createGame(cfg);
    const events: SimEvent[] = [];
    for (let i = 0; i < 400; i++) {
      tick(g);
      events.push(...snapshot(g).events);
    }
    return { events, hash: hash(g) };
  };

  it('R3D-8: shots carry the shooter id, deaths the id and kind; the simulation stays deterministic', () => {
    const a = run();
    const ids = new Set(snapshot(createGame(cfg)).units.map((u) => u.id));
    const shots = a.events.filter((e): e is Extract<SimEvent, { t: 'shot' }> => e.t === 'shot');
    expect(shots.length).toBeGreaterThan(0);
    for (const s of shots) expect(ids.has(s.src)).toBe(true);
    const deaths = a.events.filter((e): e is Extract<SimEvent, { t: 'die' }> => e.t === 'die');
    expect(deaths.length).toBeGreaterThan(0);
    for (const d of deaths) {
      expect(ids.has(d.id)).toBe(true);
      expect(['hum_tank', 'ali_skitter']).toContain(d.kind);
    }
    expect(run().hash).toBe(a.hash);
  });
});

describe('shots leave the barrel', () => {
  const tank = (): ReturnType<typeof rigTree> => {
    const t = rigTree(UNIT_RIGS.hum_tank!());
    t.root.position.set(5, 0, 5);
    return t;
  };
  const muzzle = (t: ReturnType<typeof rigTree>): THREE.Vector3 => {
    t.root.updateMatrixWorld(true);
    return t.muzzles[0]!.getWorldPosition(new THREE.Vector3());
  };

  it('R3D-9: the muzzle point is at the barrel tip in world space and follows the turret and recoil', () => {
    const t = tank();
    poseRig(t, STILL);
    const ahead = muzzle(t);
    expect(ahead.x).toBeGreaterThan(5.6); // well in front of the hull centre
    expect(ahead.z).toBeCloseTo(5, 2);
    expect(ahead.y).toBeGreaterThan(0.25); // up on the turret, not at the hull's feet
    poseRig(t, { ...STILL, turret: Math.PI / 2 }); // turret turned to face +Z
    const side = muzzle(t);
    expect(side.z).toBeGreaterThan(5.5);
    expect(side.x).toBeCloseTo(5 - 0.04, 1);
    poseRig(t, { ...STILL, kick: 1 });
    expect(muzzle(t).x).toBeLessThan(ahead.x - 0.05); // the barrel kicks back
    expect(recoil(20)).toBeGreaterThan(0);
    expect(recoil(2000)).toBeLessThan(0.001);
  });

  it('R3D-9: tracers fly at their speed; shells, rockets and acid take exactly the simulation flight time', () => {
    expect(shotDuration('rifle', 3.8, 0)).toBeCloseTo((3.8 / LOOKS.rifle.speed) * 1000);
    expect(shotDuration('cannon', 5, 200)).toBe(200);
    expect(shotDuration('howitzer', 9, 700)).toBe(700);
    expect(shotDuration('acidBig', 9, 700)).toBe(700);
    for (const look of Object.keys(LOOKS) as (keyof typeof LOOKS)[]) expect(shotDuration(look, 6, 300)).toBeGreaterThan(0);
  });

  it('R3D-9: a shot and its impact play out in the effects (melee impacts at once)', () => {
    const fx = new CombatFx();
    const from = new THREE.Vector3(0, 0.3, 0);
    const to = new THREE.Vector3(3, 0.2, 0);
    fx.muzzle('cannon', from, new THREE.Vector3(1, 0, 0), 0);
    fx.shot('cannon', from, to, 200, 0);
    fx.update(16, 0.016);
    const flying = fx.particleCount;
    expect(flying).toBeGreaterThan(0);
    fx.update(260, 0.016); // landed: explosion particles
    expect(fx.particleCount).toBeGreaterThan(flying);
    const claw = new CombatFx();
    claw.shot('claw', from, to, 0, 0);
    claw.update(1, 0.001);
    expect(claw.particleCount).toBeGreaterThan(0);
  });
});

describe('movement feel (render only)', () => {
  it('R3D-10: hulls turn toward travel at a bounded rate and keep their heading when they stop', () => {
    expect(angleDiff(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(turnToward(0, 2, 0.5)).toBeCloseTo(0.5);
    expect(turnToward(0, 0.2, 0.5)).toBeCloseTo(0.2);
    let m = restingMotion(0);
    for (let i = 0; i < 10; i++) m = stepMotion(m, 0, 0.05, 1 / 60, 2); // moving along +Z (heading PI/2)
    expect(m.heading).toBeCloseTo((10 * 2) / 60, 3); // turned only as far as the rate allows
    for (let i = 0; i < 120; i++) m = stepMotion(m, 0, 0.05, 1 / 60, 2);
    expect(m.heading).toBeCloseTo(Math.PI / 2, 3);
    const h = m.heading;
    for (let i = 0; i < 60; i++) m = stepMotion(m, 0, 0, 1 / 60, 2);
    expect(m.heading).toBe(h);
    expect(m.stride).toBeLessThan(0.01); // the gait has faded out
  });

  it('R3D-10: legs swing with the distance walked, wheels roll with it, and nothing moves standing still', () => {
    expect(gaitPhase(0.32, 0.32)).toBeCloseTo(2 * Math.PI);
    const inf = rigTree(UNIT_RIGS.hum_rifleman!());
    const legs = inf.anims.filter((a) => a.anim.k === 'gait');
    expect(legs.length).toBe(2);
    poseRig(inf, { ...STILL, phase: Math.PI / 2, stride: 0 });
    for (const l of legs) expect(l.obj.rotation.z).toBeCloseTo(l.rot.z);
    poseRig(inf, { ...STILL, phase: Math.PI / 2, stride: 1 });
    const [a, b] = legs.map((l) => l.obj.rotation.z - l.rot.z);
    expect(a! * b!).toBeLessThan(0); // left and right legs swing opposite ways
    const buggy = rigTree(UNIT_RIGS.hum_buggy!());
    const wheels = buggy.anims.filter((x) => x.anim.k === 'wheel');
    expect(wheels.length).toBe(4);
    poseRig(buggy, { ...STILL, dist: 0.11 });
    for (const w of wheels) expect(w.obj.rotation.z).toBeCloseTo(-1); // one radius travelled = one radian rolled
  });

  it('R3D-10: vehicles squat on acceleration and lean out of turns; aircraft bank into them', () => {
    const fast = { ...restingMotion(0), speed: 2, accel: 1, turnRate: 0.8, stride: 1 };
    expect(bodyPose('tracked', fast, 0, 0, 0).pitch).toBeGreaterThan(0);
    expect(bodyPose('wheeled', fast, 0, 0, 0).roll).toBeLessThan(0);
    expect(bodyPose('air', fast, 0, 0, 0).roll).toBeGreaterThan(0);
    expect(bodyPose('walker', { ...fast, stride: 0 }, 1, 0, 0).bob).toBe(0);
  });
});

describe('terrain detail', () => {
  it('R3D-11: rock offsets depend only on position and vanish at every level height, so cliffs stay watertight', () => {
    for (let k = 0; k <= 3; k++) expect(Math.hypot(...rockOffset(3, k * LEVEL_H, 7))).toBeLessThan(1e-9);
    const mid = rockOffset(3, LEVEL_H / 2, 7);
    expect(Math.hypot(...mid)).toBeGreaterThan(0);
    expect(Math.hypot(...mid)).toBeLessThanOrEqual(ROCK_AMP * 1.8);
    expect(rockOffset(3, LEVEL_H / 2, 7)).toEqual(mid);
    // Every cliff vertex at a level height sits exactly on the tile grid, where the tile tops meet it.
    const heights = [0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0];
    const m = terrainMeshes({ width: 5, height: 4, heights, blocked: () => false, shards: () => false });
    const p = m.cliffs.positions;
    let rim = 0;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1]!;
      if (Math.abs(y / LEVEL_H - Math.round(y / LEVEL_H)) > 1e-6) continue;
      rim++;
      expect(Math.abs(p[i]! * 4 - Math.round(p[i]! * 4))).toBeLessThan(1e-6);
      expect(Math.abs(p[i + 2]! * 4 - Math.round(p[i + 2]! * 4))).toBeLessThan(1e-6);
    }
    expect(rim).toBeGreaterThan(0);
  });

  it('R3D-11: scatter is the same every time and stays off water, shard fields and building ground', () => {
    const W = 24;
    const t = { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: (x: number, y: number) => x < 4 && y < 4, shards: (x: number, y: number) => x > 18 && y > 18 };
    const free = (x: number, y: number): boolean => !(x > 8 && x < 14 && y > 8 && y < 14);
    const a = scatter(t, free);
    expect(a.length).toBeGreaterThan(20);
    expect(scatter(t, free)).toEqual(a);
    for (const it of a) {
      const x = Math.floor(it.x);
      const y = Math.floor(it.z);
      expect(t.blocked(x, y) || t.shards(x, y) || !free(x, y)).toBe(false);
    }
  });
});

describe('effects budget and batching', () => {
  it('R3D-12: the low preset thins effects: no dust and fewer explosion particles', () => {
    const rich = new CombatFx();
    const lean = new CombatFx();
    lean.quality = { rich: false };
    const at = new THREE.Vector3(1, 0, 1);
    for (const fx of [rich, lean]) {
      fx.dust(at, 1, 0);
      fx.explosion(at, 0.6, 0);
      fx.update(200, 0.016);
    }
    expect(lean.particleCount).toBeLessThan(rich.particleCount);
    const dustOnly = new CombatFx();
    dustOnly.quality = { rich: false };
    dustOnly.dust(at, 1, 0);
    dustOnly.update(10, 0.016);
    expect(dustOnly.particleCount).toBe(0);
  });

  it('R3D-13: one draw call per model part and team, however many units; particles stay within budget', () => {
    const scene = new THREE.Scene();
    const inst = new Instancer(scene);
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshBasicMaterial();
    const m = new THREE.Matrix4();
    for (const n of [10, 400]) {
      inst.begin();
      for (let i = 0; i < n; i++) {
        inst.push('tank/hull|blue', geo, mat, true, m.makeTranslation(i, 0, 0));
        inst.push('tank/turret|blue', geo, mat, true, m);
      }
      inst.end();
      expect(inst.drawCalls).toBe(2);
      expect(inst.instances).toBe(2 * n);
    }
    // Growing a batch keeps what was queued before it grew.
    const hull = scene.children.find((c) => (c as THREE.InstancedMesh).count === 400) as THREE.InstancedMesh;
    const got = new THREE.Matrix4();
    hull.getMatrixAt(399, got);
    expect(new THREE.Vector3().setFromMatrixPosition(got).x).toBe(399);
    const fx = new CombatFx();
    for (let i = 0; i < 400; i++) fx.explosion(new THREE.Vector3(i % 20, 0, 0), 1, 0);
    fx.update(100, 0.016);
    expect(fx.particleCount).toBeLessThanOrEqual(2560 + 2048);
  });
});
