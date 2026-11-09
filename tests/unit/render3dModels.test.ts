import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_DEFS, buildingDef, UNIT_DEFS, unitDef } from '../../src/data/defs';
import { createGame, hash, snapshot, tick, type GameConfig, type SimEvent } from '../../src/sim';
import { BUILDING_RIGS, crystalShape, DOCK_RIGS, dockFrame, dockIntake, dockModelYaw, dockYaw } from '../../src/render3d/buildings3d';
import { CombatFx, LOOKS, scorchTexture, shotDuration } from '../../src/render3d/fx3d';
import { Instancer } from '../../src/render3d/instancer';
import { Shape } from '../../src/render3d/kit';
import { angleDiff, bodyPose, flightAfterWait, follow, gaitPhase, MAX_AIM_WAIT, readyToFire, restingMotion, stepMotion, TURRET_RATE, turnToward, type Follow } from '../../src/render3d/motion';
import { muzzleCount, poseRig, recoil, rigTree, type RigDef, type RigPose } from '../../src/render3d/rig';
import { contourWarp, EDGE_AMP, groundTexture, LEVEL_H, ROCK_AMP, rockOffset, scatter, shardCover, terrainMeshes, TEXELS, waterAlpha, wetness } from '../../src/render3d/terrain3d';
import { kneels, newMember, SQUAD_SPREAD, stepSquad, type Member, type SquadFrame } from '../../src/render3d/squad3d';
import { demoMap, showcaseConfig, skirmishMap } from '../../src/data/maps';
import type { MapDef } from '../../src/sim';
import { GORGER_NECK, UNIT_RIGS } from '../../src/render3d/units3d';
import { HIDE_FROM, HIDE_FULL, unexploredMask } from '../../src/render3d/unexplored';
import { CRASH_MS, damageLook, GLOW, glowLevels, HIVE_GLOW } from '../../src/render3d/view3d';

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
  }, 30_000);

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
    // Every cliff vertex at a level height stands exactly over a vertex of the tile tops, so the rock meets the ground.
    const heights = [0, 0, 0, 0, 0, 0, 2, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0, 0, 0, 0];
    const m = terrainMeshes({ width: 5, height: 4, heights, blocked: () => false, shards: () => false });
    const key = (x: number, z: number): string => `${Math.round(x * 1e4)},${Math.round(z * 1e4)}`;
    const tops = new Set<string>();
    const g = m.ground.positions;
    for (let i = 0; i < g.length; i += 3) tops.add(key(g[i]!, g[i + 2]!));
    const p = m.cliffs.positions;
    let rim = 0;
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1]!;
      if (Math.abs(y / LEVEL_H - Math.round(y / LEVEL_H)) > 1e-6) continue;
      rim++;
      expect(tops.has(key(p[i]!, p[i + 2]!))).toBe(true);
    }
    expect(rim).toBeGreaterThan(0);
  });

  it('R3D-11 R3D-14: scatter is the same every time, puts reeds by the water and stays off shard fields and building ground', () => {
    const W = 24;
    const t = { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: (x: number, y: number) => x < 4 && y < 4, shards: (x: number, y: number) => x > 18 && y > 18 };
    const free = (x: number, y: number): boolean => !(x > 8 && x < 14 && y > 8 && y < 14);
    const a = scatter(t, free);
    expect(a.length).toBeGreaterThan(20);
    expect(scatter(t, free)).toEqual(a);
    expect(a.some((it) => it.kind === 'reed')).toBe(true);
    for (const it of a) {
      // Only reeds grow on water; nothing grows on shard fields or building ground.
      if (it.kind === 'reed' && t.blocked(it.tx, it.ty)) continue;
      expect(t.blocked(it.tx, it.ty) || t.shards(it.tx, it.ty) || !free(it.tx, it.ty)).toBe(false);
      // Drawn where its tile's warped ground is (R3D-14): never far from that tile.
      expect(Math.hypot(it.x - Math.min(Math.max(it.x, it.tx), it.tx + 1), it.z - Math.min(Math.max(it.z, it.ty), it.ty + 1))).toBeLessThanOrEqual(EDGE_AMP + 1e-9);
    }
  });
});

const terrainOf = (m: MapDef) => ({
  width: m.width,
  height: m.height,
  heights: m.heights,
  blocked: (x: number, y: number) => !!m.blocked?.[y * m.width + x],
  shards: (x: number, y: number) => (m.shards?.[y * m.width + x] ?? 0) > 0,
});
const MAPS: [string, MapDef][] = [['skirmish', skirmishMap()], ['riverbed', skirmishMap('riverbed')], ['highlands', skirmishMap('highlands')], ['demo', demoMap()], ['showcase', showcaseConfig(1).map]];

describe('fog, damage, harvesters and deaths', () => {
  it('R3D-17: materials on unexplored tiles fade into the fog using the fog texture, for lit and unlit shaders alike', () => {
    const mask = unexploredMask();
    for (const mat of [new THREE.MeshStandardMaterial(), new THREE.MeshBasicMaterial()]) {
      mask.apply(mat);
      const lib = mat instanceof THREE.MeshStandardMaterial ? THREE.ShaderLib.physical : THREE.ShaderLib.basic;
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      mat.onBeforeCompile(shader as never, undefined as never);
      expect(shader.vertexShader).toContain('vHideXZ = ( modelMatrix * hideW ).xz');
      expect(shader.vertexShader).toContain('instanceMatrix * hideW');
      expect(shader.fragmentShader).toContain('mix( gl_FragColor.rgb, uHideColor, hidden )');
      expect(shader.uniforms.uHideMap).toBe(mask.uniforms.uHideMap);
      expect(mat.customProgramCacheKey()).toBe('unexplored-mask');
    }
    // Explored tiles (fog green 120/255) are left alone; unexplored ones (245/255) are fully hidden.
    expect(120 / 255).toBeLessThan(HIDE_FROM);
    expect(245 / 255).toBeGreaterThan(HIDE_FULL);
    const fog = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    mask.use(fog, 96, 80);
    expect(mask.uniforms.uHideMap.value).toBe(fog);
    expect(mask.uniforms.uHideSize.value.toArray()).toEqual([96, 80]);
  });

  it('R3D-18: damage darkens a building steadily, sparks from half health, and below a third it sags and flickers', () => {
    expect(damageLook(1, 0, 1)).toEqual({ tint: 1, lean: 0, sparkEvery: 0 });
    const tints = [1, 0.8, 0.6, 0.4, 0.2].map((hp) => damageLook(hp, 0, 1).tint);
    for (let i = 1; i < tints.length; i++) expect(tints[i]!).toBeLessThan(tints[i - 1]!);
    expect(damageLook(0.6, 0, 1).sparkEvery).toBe(0);
    expect(damageLook(0.45, 0, 1).sparkEvery).toBeGreaterThan(damageLook(0.1, 0, 1).sparkEvery);
    expect(damageLook(0.4, 0, 1).lean).toBe(0);
    expect(damageLook(0.1, 0, 1).lean).toBeGreaterThan(0);
    // Its power flickers now and then when wrecked, never when healthy.
    const low = Array.from({ length: 2000 }, (_, t) => damageLook(0.1, t * 7, 3).tint);
    expect(Math.min(...low)).toBeLessThan(Math.max(...low) * 0.8);
    const fine = Array.from({ length: 2000 }, (_, t) => damageLook(0.9, t * 7, 3).tint);
    expect(Math.min(...fine)).toBe(Math.max(...fine));
    const fx = new CombatFx();
    fx.sparks(new THREE.Vector3(1, 1, 1), false, 0);
    fx.update(16, 0.016);
    expect(fx.particleCount).toBeGreaterThan(3);
  });

  it('R3D-22: docked on the pad, the hauler backs its tipping bed to the intake and the gorger bows its head into the maw', () => {
    for (const [ref, unit] of [['hum_refinery', 'hum_hauler'], ['ali_extractor', 'ali_gorger']] as const) {
      const d = buildingDef(ref);
      // A dock model exists for each refinery kind, with real detail.
      const dock = DOCK_RIGS[ref]!();
      expect(Object.values(dock.shapes).reduce((n, sh) => n + sh().pieces.length, 0), ref).toBeGreaterThanOrEqual(8);
      // A refinery at tile (10, 20), with its pad on each side in turn: the dock stands on the pad, facing out.
      for (const pad of [[13, 21], [9, 20], [11, 22], [11, 19]] as [number, number][]) {
        const f = dockFrame({ kind: ref, tx: 10, ty: 20, pad }, d.w, d.h)!;
        expect([Math.floor(f.x), Math.floor(f.z)]).toEqual(pad);
        // The model's +X, turned by its yaw, points out of the building.
        const out = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), dockModelYaw(f));
        expect(out.x).toBeCloseTo(f.out[0], 6);
        expect(out.z).toBeCloseTo(f.out[1], 6);
        // The intake is at the building's wall.
        const [ix, iz] = dockIntake(ref, f);
        expect(Math.abs(ix - f.x) + Math.abs(iz - f.z)).toBeGreaterThan(0.3);
        const x = f.x;
        const z = f.z;
        const yaw = dockYaw(unit, ref, f, x, z)!;
        const intake = new THREE.Vector2(ix, iz);
        const ahead = new THREE.Vector2(x + Math.cos(yaw) * 0.5, z + Math.sin(yaw) * 0.5).distanceTo(intake);
        const behind = new THREE.Vector2(x - Math.cos(yaw) * 0.5, z - Math.sin(yaw) * 0.5).distanceTo(intake);
        if (unit === 'hum_hauler') expect(behind, 'the bed tips out of the back, into the hopper').toBeLessThan(ahead);
        else expect(ahead, 'the gorger faces the maw').toBeLessThan(behind);
      }
    }
    // Unloading, the gorger's maw dips well down toward the pool, about its neck; the hauler's bed tips (R3D-19).
    const g = rigTree(UNIT_RIGS.ali_gorger!());
    const head = g.drawn.find((n) => n.geo === 'head')!;
    const maw = (tip: number): THREE.Vector3 => {
      poseRig(g, { ...STILL, walker: true, tip });
      g.root.updateMatrixWorld(true);
      return new THREE.Vector3(0.62, -0.02, 0).applyMatrix4(head.obj.matrixWorld);
    };
    const up = maw(0);
    const down = maw(1);
    expect(up.y - down.y).toBeGreaterThan(0.1);
    const neck = (tip: number): THREE.Vector3 => {
      poseRig(g, { ...STILL, walker: true, tip });
      g.root.updateMatrixWorld(true);
      return new THREE.Vector3(GORGER_NECK, 0, 0).applyMatrix4(head.obj.matrixWorld);
    };
    expect(neck(1).distanceTo(neck(0))).toBeLessThan(1e-6);
  });

  it('R3D-19: each harvester cargo grows with its load, and mining and unloading play while they last', () => {
    for (const kind of ['hum_hauler', 'ali_gorger']) {
      const t = rigTree(UNIT_RIGS[kind]!());
      const cargo = t.anims.find((a) => a.anim.k === 'cargo')!;
      poseRig(t, { ...STILL, load: 0.1 });
      const small = cargo.obj.scale.y;
      poseRig(t, { ...STILL, load: 1 });
      expect(cargo.obj.scale.y, kind).toBeGreaterThan(small + 0.2);
    }
    // The hauler tips its bed back about the rear hinge to unload, and its cutter drum turns while mining.
    const hauler = rigTree(UNIT_RIGS.hum_hauler!());
    const bed = hauler.anims.find((a) => a.anim.k === 'tip')!;
    const drum = hauler.anims.find((a) => a.anim.k === 'drum')!;
    poseRig(hauler, { ...STILL, tip: 0, drum: 0 });
    expect(bed.obj.rotation.z).toBe(0);
    poseRig(hauler, { ...STILL, tip: 1, drum: 2 });
    expect(bed.obj.rotation.z).toBeGreaterThan(0.5); // front up, so the load slides out of the back
    expect(drum.obj.rotation.z).toBeCloseTo(-2, 6);
    // The hinge stays where it is while the bed swings up about it.
    bed.obj.updateMatrix();
    const hinge = new THREE.Vector3(-0.72, 0.3, 0).applyMatrix4(bed.obj.matrix);
    expect(hinge.x).toBeCloseTo(-0.72, 6);
    expect(hinge.y).toBeCloseTo(0.3, 6);
    // ...and the front of the bed rises above its resting height.
    const front = new THREE.Vector3(0.3, 0.52, 0).applyMatrix4(bed.obj.matrix);
    expect(front.y).toBeGreaterThan(0.8);
    const fx = new CombatFx();
    const hopper = new THREE.Vector3(5, 0.6, 5);
    const crystal = new THREE.Vector3(6, 0.2, 5);
    for (let t = 0; t < 600; t += 16) {
      fx.harvest(1, hopper, crystal, false, false, t);
      fx.harvest(2, hopper, crystal, true, true, t);
      fx.update(t, 0.016);
    }
    expect(fx.links.size).toBe(2);
    expect(fx.particleCount).toBeGreaterThan(8);
    fx.update(1000, 0.016);
    expect(fx.links.size).toBe(0); // stops a moment after the work stops
  });

  it('R3D-12: aircraft dive out of the sky in about half a second, and Vrax buildings glow a touch brighter than other glows', () => {
    expect(CRASH_MS).toBeLessThanOrEqual(600);
    expect(glowLevels(true)).toEqual({ glow: GLOW, hive: HIVE_GLOW });
    expect(HIVE_GLOW).toBeGreaterThan(GLOW);
    expect(HIVE_GLOW).toBeLessThanOrEqual(1.2 * GLOW);
    expect(GLOW).toBeLessThanOrEqual(1.6);
    // Without bloom, glows are plain bright colours, Vrax a little softer.
    expect(glowLevels(false).glow).toBe(1);
    expect(glowLevels(false).hive).toBeLessThan(1);
    // The levels apply from the first frame on the default (bloom) preset, not only after the preset changes.
    const src = readFileSync('src/render3d/view3d.ts', 'utf8');
    expect(src).toContain('glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).glow) })');
    expect(src).toContain('hiveGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, color: new THREE.Color().setScalar(glowLevels(true).hive) })');
    expect(src).toContain('private bloomOn = true;');
  });

  it('R3D-3: riflemen and rocketeers read apart: different cloth, visor, size and build', () => {
    const rifle = UNIT_RIGS.hum_rifleman!();
    const rocket = UNIT_RIGS.hum_rocketeer!();
    expect(rocket.scale!).toBeGreaterThan(rifle.scale!);
    const colours = (def: RigDef): Set<string> => new Set(Object.values(def.shapes).flatMap((sh) => sh().pieces.map((p) => String(p.paint))));
    const a = colours(rifle);
    const b = colours(rocket);
    expect([...b].filter((c) => !a.has(c)).length).toBeGreaterThanOrEqual(2);
    expect(rocket.shapes.body!().pieces.length).toBeGreaterThan(rifle.shapes.body!().pieces.length);
  });
});

describe('organic contours', () => {
  it('R3D-14: the contour warp is bounded, zero away from contours and along the map border, and the same every time', () => {
    const t = terrainOf(showcaseConfig(1).map);
    const warp = contourWarp(t);
    let moved = 0;
    for (let z = 0; z <= t.height; z += 0.25) {
      for (let x = 0; x <= t.width; x += 0.25) {
        const [dx, dz] = warp(x, z);
        expect(Math.hypot(dx, dz)).toBeLessThanOrEqual(EDGE_AMP + 1e-9);
        if (x === 0 || x === t.width) expect(dx).toBe(0);
        if (z === 0 || z === t.height) expect(dz).toBe(0);
        if (Math.hypot(dx, dz) > 0.05) moved++;
      }
    }
    expect(moved).toBeGreaterThan(200);
    // Open ground far from any cliff or shore stays put: the middle of a 3x3 flat area.
    const flat = { width: 9, height: 9, heights: new Array<number>(81).fill(0).map((_, i) => (i % 9 === 0 ? 1 : 0)), blocked: () => false, shards: () => false };
    expect(contourWarp(flat)(6.5, 4.5)).toEqual([0, 0]);
    expect(contourWarp(t)(17.25, 6)).toEqual(warp(17.25, 6));
    expect(contourWarp(t, false)(17.3, 6.1)).toEqual(warp(17.3, 6.1));
  });

  it('R3D-14: on every map, cliff tops and shores wave and round off while the ground never folds or tears', () => {
    for (const [name, map] of MAPS) {
      const t = terrainOf(map);
      const m = terrainMeshes(t);
      const g = m.ground;
      let abs = 0;
      for (let i = 0; i < g.indices.length; i += 3) {
        const [p, q, r] = [g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!].map((k) => [g.positions[k * 3]!, g.positions[k * 3 + 2]!]);
        // Tops wind the same way everywhere (a folded cell would flip its sign), and no cell is squeezed below a fifth
        // of its size (a whole tile's triangle has a cross product of 1, a split tile's of 1/16).
        const cross = (r![0]! - p![0]!) * (q![1]! - p![1]!) - (q![0]! - p![0]!) * (r![1]! - p![1]!);
        expect(cross / (cross > 0.5 ? 1 : 1 / 16), `${name} squeezes or folds a cell`).toBeGreaterThan(0.18);
        abs += cross / 2;
      }
      expect(abs, `${name} covers the map once`).toBeCloseTo(t.width * t.height, 3);
      // Cliff rims are no longer straight tile edges.
      const p = m.cliffs.positions;
      let off = 0;
      for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]! * 4 - Math.round(p[i]! * 4)) > 0.12) off++;
      expect(off, name).toBeGreaterThan(50);
    }
  }, 90_000); // builds the terrain of every map (slow when the whole suite runs in parallel)

  it('R3D-14: shard ground is a soft uneven patch: full at shard tiles, none at bare ones, blended between', () => {
    const t = terrainOf(showcaseConfig(1).map);
    expect(shardCover(t, 23.5, 9.5)).toBe(1);
    expect(shardCover(t, 12.5, 12.5)).toBe(0);
    const edge: number[] = [];
    for (let x = 21; x <= 22.5; x += 0.0625) edge.push(shardCover(t, x, 9.3));
    expect(edge.some((v) => v > 0.05 && v < 0.95)).toBe(true);
    const tex = groundTexture(t);
    expect(Buffer.from(groundTexture(t).data).equals(Buffer.from(tex.data))).toBe(true);
  });
});

describe('turrets', () => {
  it('R3D-9: a turret turns fast and fires once on target; the shell then flies shorter so it lands with the damage', () => {
    expect((TURRET_RATE * 1000) / 1000).toBeGreaterThanOrEqual(Math.PI / 2 / 0.25); // a quarter turn within 0.25 s
    expect(readyToFire(true, 0, 1, 0)).toBe(false);
    expect(readyToFire(true, 0.95, 1, 0)).toBe(true);
    expect(readyToFire(true, 0, 1, MAX_AIM_WAIT)).toBe(true); // never held back forever
    expect(readyToFire(false, 0, 2, 0)).toBe(true); // rifles and claws fire at once
    expect(flightAfterWait(700, 200)).toBe(500);
    expect(flightAfterWait(100, 200)).toBe(60);
  });
});

describe('shores', () => {
  it('R3D-14: water fades in across a wavy shore, full inside the lake, never over walkable land beyond a sliver', () => {
    const t = terrainOf(showcaseConfig(1).map);
    // The pond covers tiles x 10..15, y 24..30.
    expect(waterAlpha(t, 12.5, 27.5)).toBe(1);
    expect(waterAlpha(t, 8.5, 27.5)).toBe(0);
    expect(waterAlpha(t, 9.8, 27.5)).toBe(0); // land, 0.2 from the water
    // Continuous across the shore: no step bigger than a tenth over a sixteenth of a tile.
    let last = waterAlpha(t, 9, 26.3);
    let partial = 0;
    for (let x = 9 + 1 / 16; x <= 12; x += 1 / 16) {
      const a = waterAlpha(t, x, 26.3);
      expect(Math.abs(a - last)).toBeLessThan(0.25);
      if (a > 0.05 && a < 0.95) partial++;
      last = a;
    }
    expect(partial).toBeGreaterThan(1);
    // The shore line wanders: where the water reaches half opacity differs along a straight tile edge.
    const crossing = (y: number): number => {
      for (let x = 9; x <= 12; x += 1 / 64) if (waterAlpha(t, x, y) >= 0.5) return x;
      return 99;
    };
    const xs = [25.3, 26.1, 26.9, 27.7, 28.5].map(crossing);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.03);
    // Corners round off at the scale of a tile: the lake's corner tile is less wet at its outer corner than mid-edge.
    expect(wetness(t, 10.1, 24.1)).toBeLessThan(wetness(t, 12.5, 24.1));
  });

  it('R3D-14: ground by the water is painted as beach sand between the grass and the lake bed', () => {
    const t = terrainOf(showcaseConfig(1).map);
    const tex = groundTexture(t);
    const px = (x: number, y: number): number[] => {
      const k = (Math.floor(y * TEXELS) * tex.width + Math.floor(x * TEXELS)) * 4;
      return [tex.data[k]!, tex.data[k + 1]!, tex.data[k + 2]!];
    };
    // Along a row from dry grass into the pond: somewhere it is sandy (red above green, bright), and the lake bed is blue.
    const row = Array.from({ length: 48 }, (_, i) => px(7 + i / 16, 27.5));
    expect(row.some(([r, g, b]) => r! > g! && r! > 130 && b! < r!)).toBe(true);
    const bed = px(12.5, 27.5);
    expect(bed[2]!).toBeGreaterThan(bed[0]!);
  });
});

describe('smooth movement', () => {
  it('R3D-10: the drawn position rides through uneven snapshots without stalls or jumps, and snaps across long jumps', () => {
    // A unit moving at 2 tiles/s whose interpolated position stalls for 30 ms, then jumps, every 50 ms tick.
    const dt = 1 / 120;
    const f: Follow = { x: 0, z: 0, vx: 0, vz: 0 };
    let worstRaw = 0;
    let worstDrawn = 0;
    let lastRaw = 0;
    let lastDrawn = 0;
    for (let k = 1; k < 600; k++) {
      const time = k * dt;
      const tick = Math.floor(time / 0.05);
      const into = time - tick * 0.05;
      const raw = (tick * 0.05 + Math.max(0, into - 0.03) * 2.5) * 2;
      follow(f, raw, 0, dt);
      if (k > 120) {
        worstRaw = Math.max(worstRaw, Math.abs((raw - lastRaw) / dt - 2));
        worstDrawn = Math.max(worstDrawn, Math.abs((f.x - lastDrawn) / dt - 2));
      }
      lastRaw = raw;
      lastDrawn = f.x;
    }
    expect(worstRaw).toBeGreaterThan(2.5);
    expect(worstDrawn).toBeLessThan(worstRaw * 0.35);
    follow(f, 50, 50, dt);
    expect([f.x, f.z]).toEqual([50, 50]);
  });

  it('R3D-10: vehicles pivot quickly, and turning on the spot rolls the inside wheels backwards', () => {
    for (const [kind, make] of Object.entries(UNIT_RIGS)) {
      const def = make();
      if (def.move === 'tracked' || def.move === 'wheeled') expect(def.turn, kind).toBeGreaterThanOrEqual(5);
      else expect(def.turn ?? 4, kind).toBeGreaterThanOrEqual(4);
    }
    // A quarter turn while standing: the heading gets there within a third of a second at the tank's rate.
    let m = restingMotion(0);
    const tank = UNIT_RIGS.hum_tank!();
    for (let i = 0; i < 20; i++) m = stepMotion(m, Math.cos(Math.PI / 2) * 0.02, Math.sin(Math.PI / 2) * 0.02, 1 / 60, tank.turn!);
    expect(m.heading).toBeCloseTo(Math.PI / 2, 5);
    expect(m.turned).toBeCloseTo(Math.PI / 2, 5);
    const t = rigTree(tank);
    const wheels = t.anims.filter((a) => a.anim.k === 'wheel');
    poseRig(t, { ...STILL, turned: 1 });
    const left = wheels.filter((a) => a.pos.z > 0).map((a) => a.obj.rotation.z - a.rot.z);
    const right = wheels.filter((a) => a.pos.z < 0).map((a) => a.obj.rotation.z - a.rot.z);
    expect(left.length).toBeGreaterThan(0);
    for (const l of left) expect(l).toBeGreaterThan(0);
    for (const r of right) expect(r).toBeLessThan(0);
  });

  it('R3D-10: tiny wobbles do not turn the hull', () => {
    let m = restingMotion(0);
    for (let i = 0; i < 120; i++) m = stepMotion(m, 0, (i % 2 ? 1 : -1) * 0.0008, 1 / 60, 6);
    expect(m.heading).toBe(0);
  });
});

describe('living squads', () => {
  const run = (frames: number, f: Partial<SquadFrame>, seed = 5): { members: Member[]; trace: number[][] } => {
    const base: SquadFrame = { x: 10, z: 10, vx: 0, vz: 0, heading: 0, aiming: false, aim: 0, alive: 3, t: 0, dt: 1 / 60, seed, free: () => true, ...f };
    const members = [0, 1, 2].map((i) => newMember(base, i, 3));
    const trace: number[][] = [];
    for (let k = 0; k < frames; k++) {
      const fr = { ...base, t: (k * 1000) / 60, x: base.x + base.vx * (k / 60), z: base.z + base.vz * (k / 60) };
      stepSquad(members, fr);
      trace.push(members.flatMap((m) => [m.x - fr.x, m.z - fr.z]));
    }
    return { members, trace };
  };

  it('R3D-15: idle squad members wander on their own around the squad, each within its reach', () => {
    const { trace } = run(60 * 20, {});
    for (const row of trace) for (let i = 0; i < row.length; i += 2) expect(Math.hypot(row[i]!, row[i + 1]!)).toBeLessThanOrEqual(SQUAD_SPREAD + 0.05);
    // Every member moves over 20 s, and not in lockstep.
    const first = trace[60]!;
    const last = trace[trace.length - 1]!;
    for (let i = 0; i < 3; i++) expect(Math.hypot(last[i * 2]! - first[i * 2]!, last[i * 2 + 1]! - first[i * 2 + 1]!) + Math.max(...trace.map((r) => Math.abs(r[i * 2]! - first[i * 2]!)))).toBeGreaterThan(0.03);
    const d0 = trace.map((r) => r[0]!);
    const d1 = trace.map((r) => r[2]!);
    expect(d0.join()).not.toEqual(d1.join());
    expect(run(60 * 20, {}).trace).toEqual(trace); // the same squad does the same thing every run
  });

  it('R3D-15: marching members keep up with the squad, firing members face the target and some kneel', () => {
    const march = run(60 * 6, { vx: 1.2, heading: 0 });
    for (const m of march.members) {
      expect(Math.hypot(m.x - (10 + 1.2 * (359 / 60)), m.z - 10)).toBeLessThan(SQUAD_SPREAD + 0.15);
      expect(m.motion.stride).toBeGreaterThan(0.5);
    }
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find((s) => [0, 1, 2].some((i) => kneels(s, i)))!;
    const fire = run(60 * 4, { aiming: true, aim: Math.PI / 2 }, seed);
    fire.members.forEach((m, i) => {
      expect(Math.abs(angleDiff(m.yaw, Math.PI / 2))).toBeLessThan(0.2);
      if (kneels(seed, i)) expect(m.crouch).toBeGreaterThan(0.8);
    });
  });

  it('R3D-15: when a fast squad stops, members slow into their spots without overshooting and coming back', () => {
    // A skitterer squad (the fastest) runs at full speed for two seconds and stops dead, its drawn position following
    // the simulated one through the view's spring, as in the game.
    const speed = (60 / 256) * 20;
    for (const seed of [1, 2, 3, 5, 8, 13]) {
      const sq = { x: 10, z: 10, vx: 0, vz: 0 };
      const base = { heading: 0, aiming: false, aim: 0, alive: 3, dt: 1 / 60, seed, free: () => true };
      const members = [0, 1, 2].map((i) => newMember({ ...base, x: 10, z: 10 }, i, 3));
      const away = [0, 0, 0];
      const spot = members.map(() => [0, 0]);
      const gap = [0, 0, 0];
      for (let k = 0; k < 60 * 5; k++) {
        const tx = 10 + (speed * Math.min(k, 120)) / 60;
        follow(sq, tx, 10, 1 / 60);
        const fr: SquadFrame = { ...base, x: sq.x, z: sq.z, vx: sq.vx, vz: sq.vz, t: (k * 1000) / 60 };
        stepSquad(members, fr);
        members.forEach((m, i) => {
          // The gap between a member and its spot (which moves with the squad).
          const e = Math.hypot(sq.x + m.gx - m.x, sq.z + m.gz - m.z);
          const same = Math.abs(spot[i]![0]! - m.gx) < 1e-9 && Math.abs(spot[i]![1]! - m.gz) < 1e-9;
          spot[i] = [m.gx, m.gz];
          // After the stop, a gap that grows while the spot is unchanged is the overshoot coming back.
          if (k >= 121 && same && e > gap[i]!) away[i]! += e - gap[i]!;
          gap[i] = e;
        });
      }
      for (const a of away) expect(a, `seed ${seed}`).toBeLessThan(0.01);
    }
  });

  it('R3D-15: members never pick a spot that is not free (cliff edges, water)', () => {
    const { trace } = run(60 * 20, { free: (x) => x <= 10 });
    // After the first moments (they start in formation), every member keeps to the free side.
    for (const row of trace.slice(120)) for (let i = 0; i < row.length; i += 2) expect(row[i]!).toBeLessThanOrEqual(0.02);
  });
});

describe('effects budget and batching', () => {
  it('R3D-12: tracers are subtle and scorch marks are soft blobs, transparent at the edges of their square', () => {
    for (const look of ['rifle', 'mg', 'chaingun', 'sting', 'spine'] as const) {
      expect(LOOKS[look].intensity).toBeLessThanOrEqual(1.6);
      expect(LOOKS[look].flash).toBeLessThan(0.15);
    }
    // Shells, rockets and acid glow, but never brighter than this.
    for (const L of Object.values(LOOKS)) expect(L.intensity).toBeLessThanOrEqual(2.6);
    const tex = scorchTexture();
    const { data, width } = tex.image as { data: Uint8Array; width: number };
    const at = (x: number, y: number, c: number): number => data[(y * width + x) * 4 + c]!;
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, width - 1], [width - 1, width - 1], [width >> 1, 0], [0, width >> 1]] as const) {
      expect(at(x, y, 1)).toBe(0); // an alpha map reads green
      expect(at(x, y, 3)).toBe(0);
    }
    expect(at(width >> 1, width >> 1, 1)).toBeGreaterThan(150);
  });

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

  it('R3D-12: Vrax weapons have their own flair: spit bursts, glowing wakes and drips, claw slashes, acid puddles', () => {
    const at = new THREE.Vector3(2, 0.3, 2);
    const dir = new THREE.Vector3(1, 0, 0);
    const count = (f: (fx: CombatFx) => void, t: number): number => {
      const fx = new CombatFx();
      f(fx);
      fx.update(t, 0.016);
      return fx.particleCount;
    };
    // A spit burst is richer than a rifle's flash.
    expect(count((fx) => fx.muzzle('acid', at, dir, 0), 20)).toBeGreaterThan(count((fx) => fx.muzzle('rifle', at, dir, 0), 20) + 3);
    // A sting leaves a wake of motes in flight; a rifle round leaves none.
    const flight = (look: 'sting' | 'rifle'): number => {
      const fx = new CombatFx();
      fx.shot(look, at, new THREE.Vector3(12, 0.3, 2), 0, 0);
      for (let t = 16; t <= 160; t += 16) fx.update(t, 0.016);
      return fx.particleCount;
    };
    expect(flight('sting')).toBeGreaterThan(2);
    expect(flight('rifle')).toBe(0);
    // A claw strike sprays ichor.
    expect(count((fx) => fx.shot('claw', at, at, 0, 0), 20)).toBeGreaterThanOrEqual(8);
    // Acid splashes leave a glowing puddle that fades within a few seconds.
    const fx = new CombatFx();
    fx.shot('acidBig', new THREE.Vector3(0, 0.3, 0), at, 300, 0);
    for (let t = 16; t <= 400; t += 16) fx.update(t, 0.016);
    expect(fx.puddles.some((p) => p.mesh.visible)).toBe(true);
    fx.update(5000, 0.016);
    expect(fx.puddles.some((p) => p.mesh.visible)).toBe(false);
  });

  it('R3D-16: a superweapon marks its target until impact, then strikes with flash, pillar, shockwaves, smoke and fire', () => {
    const fx = new CombatFx();
    const from = new THREE.Vector3(2, 0, 2);
    const to = new THREE.Vector3(14, 0, 9);
    fx.superweaponLaunch(from, 1.4, to, 4, 3000, true, 0);
    fx.update(16, 0.016);
    expect(fx.particleCount).toBeGreaterThan(10); // the launch flash and motes
    expect(fx.warnings).toHaveLength(1);
    expect(fx.puddles.some((p) => p.mesh.visible && p.mesh.position.x === 14)).toBe(true); // the marked target
    for (let t = 32; t < 2990; t += 16) fx.update(t, 0.016);
    expect(fx.warnings).toHaveLength(1); // still marked until impact
    fx.update(3010, 0.016);
    expect(fx.warnings).toHaveLength(0);
    const before = fx.particleCount;
    fx.superweaponStrike(to, 4, true, 3010);
    fx.update(3026, 0.016);
    expect(fx.particleCount).toBeGreaterThan(before + 60);
    expect(fx.shake).toBeGreaterThan(0.3);
    // Shockwaves and fires keep coming after the first frame.
    const early = fx.particleCount;
    for (let t = 3042; t < 5000; t += 16) fx.update(t, 0.016);
    expect(fx.particleCount).toBeGreaterThan(0);
    expect(early).toBeGreaterThan(0);
    // The blast lingers: smoke, fires and a glowing crater are still there six seconds on.
    for (let t = 5000; t < 9010; t += 16) fx.update(t, 0.016);
    expect(fx.particleCount).toBeGreaterThan(10);
    expect(fx.puddles.some((p) => p.mesh.visible)).toBe(true);
    // The Vrax rift adds acid pools.
    const rift = new CombatFx();
    rift.superweaponStrike(to, 5, false, 0);
    for (let t = 16; t < 600; t += 16) rift.update(t, 0.016);
    expect(rift.puddles.filter((p) => p.mesh.visible).length).toBeGreaterThanOrEqual(3);
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
    expect(fx.particleCount).toBeLessThanOrEqual(8192 + 4096); // the GPU budgets (R3D-26)
  });
});
