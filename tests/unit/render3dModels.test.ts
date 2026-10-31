import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BUILDING_DEFS, UNIT_DEFS, unitDef } from '../../src/data/defs';
import { createGame, hash, snapshot, tick, type GameConfig, type SimEvent } from '../../src/sim';
import { BUILDING_RIGS, crystalShape } from '../../src/render3d/buildings3d';
import { CombatFx, LOOKS, scorchTexture, shotDuration } from '../../src/render3d/fx3d';
import { Instancer } from '../../src/render3d/instancer';
import { Shape } from '../../src/render3d/kit';
import { angleDiff, bodyPose, follow, gaitPhase, restingMotion, stepMotion, turnToward, type Follow } from '../../src/render3d/motion';
import { muzzleCount, poseRig, recoil, rigTree, type RigPose } from '../../src/render3d/rig';
import { contourWarp, EDGE_AMP, groundTexture, LEVEL_H, ROCK_AMP, rockOffset, scatter, shardCover, terrainMeshes } from '../../src/render3d/terrain3d';
import { kneels, newMember, SQUAD_SPREAD, stepSquad, type Member, type SquadFrame } from '../../src/render3d/squad3d';
import { demoMap, showcaseConfig, skirmishMap } from '../../src/data/maps';
import type { MapDef } from '../../src/sim';
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

  it('R3D-11: scatter is the same every time and stays off water, shard fields and building ground', () => {
    const W = 24;
    const t = { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: (x: number, y: number) => x < 4 && y < 4, shards: (x: number, y: number) => x > 18 && y > 18 };
    const free = (x: number, y: number): boolean => !(x > 8 && x < 14 && y > 8 && y < 14);
    const a = scatter(t, free);
    expect(a.length).toBeGreaterThan(20);
    expect(scatter(t, free)).toEqual(a);
    for (const it of a) {
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
const MAPS: [string, MapDef][] = [['skirmish', skirmishMap()], ['demo', demoMap()], ['showcase', showcaseConfig(1).map]];

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
  });

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
