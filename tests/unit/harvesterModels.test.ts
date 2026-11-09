import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { ELEV_DOWN_MS, ELEV_HOLD_MS, ELEV_UP_MS, elevTarget, HEAD_MS, rideMotion, slew } from '../../src/render3d/motion';
import { feedCycle, poseRig, rigTree, swallowBeat, type RigDef, type RigPose, type RigTree } from '../../src/render3d/rig';
import { HAMMER_LOCK, HAMMER_MUZZLE, HAMMER_RAISED, HAMMER_TRUNNION, UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

/** World box of every drawn part of a posed rig, optionally only parts drawn with the given shape keys. */
function bounds(def: RigDef, t: RigTree, only?: readonly string[]): THREE.Box3 {
  t.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const d of t.drawn) {
    if (d.cargo || (only && !only.includes(d.geo))) continue;
    for (const p of def.shapes[d.geo]!().pieces) {
      const pos = p.geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld));
    }
  }
  return box;
}

const node = (t: RigTree, geo: string) => t.drawn.find((d) => d.geo === geo)!;

describe('R3D-30: the Shard Hauler', () => {
  const def = UNIT_RIGS.hum_hauler!();

  it('R3D-30: it is a long heavy chassis on six wheels with a cab, a hopper, a hatch, a conveyor and a drum on arms', () => {
    const t = rigTree(def);
    expect(t.anims.filter((a) => a.anim.k === 'wheel')).toHaveLength(6);
    for (const geo of ['body', 'head', 'drum', 'cleats', 'hatch', 'cargo']) expect(def.shapes[geo], geo).toBeDefined();
    poseRig(t, STILL);
    const b = bounds(def, t);
    const size = b.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.7);
    expect(size.x).toBeLessThan(2.3);
    expect(size.z).toBeGreaterThan(0.7);
    expect(size.z).toBeLessThan(1.0);
    expect(size.y).toBeGreaterThan(0.6);
    expect(size.y).toBeLessThan(0.95);
    expect(b.min.y).toBeGreaterThan(-0.02);
    // The cab stands raised at the front, the hopper behind it.
    const body = def.shapes.body!();
    expect(body.pieces.length).toBeGreaterThan(30);
  });

  it('R3D-30: the head is raised clear of the ground while driving and lowered onto it while mining', () => {
    const t = rigTree(def);
    const drum = node(t, 'drum');
    const lowest = (head: number): number => {
      poseRig(t, { ...STILL, head });
      return bounds(def, t, ['drum']).min.y;
    };
    // Raised: the teeth are well clear. Lowered: the teeth reach the ground.
    expect(lowest(0)).toBeGreaterThan(0.15);
    expect(lowest(1)).toBeLessThan(0.03);
    expect(lowest(1)).toBeGreaterThan(-0.05);
    // The drum stays in front of the cab either way, and the head eases through the middle rather than snapping.
    for (const h of [0, 0.5, 1]) {
      poseRig(t, { ...STILL, head: h });
      t.root.updateMatrixWorld(true);
      expect(new THREE.Vector3().setFromMatrixPosition(drum.obj.matrixWorld).x).toBeGreaterThan(0.9);
    }
    const mid = lowest(0.5);
    expect(mid).toBeLessThan(lowest(0));
    expect(mid).toBeGreaterThan(lowest(1));
    // The view eases the head over 0.4 s: half-way after 0.2 s, and never a jump in one frame.
    let h = 0;
    for (let i = 0; i < 12; i++) h = slew(h, 1, 1 / 60, HEAD_MS, HEAD_MS);
    expect(h).toBeCloseTo(0.5, 5);
    expect(slew(0, 1, 1 / 60, HEAD_MS, HEAD_MS)).toBeLessThan(0.05);
    for (let i = 0; i < 12; i++) h = slew(h, 1, 1 / 60, HEAD_MS, HEAD_MS);
    expect(h).toBeCloseTo(1, 9);
  });

  it('R3D-30: while mining the head nods in a chewing rhythm and the conveyor carries its cleats up toward the hopper', () => {
    const t = rigTree(def);
    const arm = t.anims.find((a) => a.anim.k === 'arm')!;
    const angles = new Set<string>();
    for (let ms = 0; ms < 700; ms += 50) {
      poseRig(t, { ...STILL, head: 1, time: ms });
      angles.add(arm.obj.rotation.z.toFixed(4));
    }
    expect(angles.size).toBeGreaterThan(5);
    // The nod is small: a couple of degrees.
    const zs = [...angles].map(Number);
    expect(Math.max(...zs) - Math.min(...zs)).toBeLessThan(0.07);
    // Raised, the head does not nod.
    poseRig(t, { ...STILL, head: 0, time: 0 });
    const still = arm.obj.rotation.z;
    poseRig(t, { ...STILL, head: 0, time: 333 });
    expect(arm.obj.rotation.z).toBeCloseTo(still, 9);
    // The cleats slide along the trough, up toward the hopper (-X), and wrap after a pitch.
    const cleats = t.anims.find((a) => a.anim.k === 'scroll')!;
    const at = (drum: number): number => {
      poseRig(t, { ...STILL, drum });
      return cleats.obj.position.x;
    };
    expect(at(0)).toBeCloseTo(cleats.pos.x + 0, 9);
    expect(at(1)).toBeLessThan(at(0.5) + 1e-9);
    const pitch = (cleats.anim as { pitch: number }).pitch;
    expect(Math.abs(at(1000) - cleats.pos.x)).toBeLessThan(pitch + 1e-6);
  });

  it('R3D-30: it unloads through a rear hatch that opens out of the back, and the heap in the hopper grows with the load', () => {
    const t = rigTree(def);
    const hatch = t.anims.find((a) => a.anim.k === 'tip')!;
    expect(hatch.anim.k === 'tip' && hatch.anim.max).toBeLessThan(0);
    poseRig(t, { ...STILL, tip: 0 });
    const closed = bounds(def, t, ['hatch']);
    poseRig(t, { ...STILL, tip: 1 });
    const open = bounds(def, t, ['hatch']);
    expect(open.min.x).toBeLessThan(closed.min.x - 0.2); // swung out behind the hopper
    const cargo = t.anims.find((a) => a.anim.k === 'cargo')!;
    poseRig(t, { ...STILL, load: 0.1 });
    const small = cargo.obj.scale.y;
    poseRig(t, { ...STILL, load: 1 });
    expect(cargo.obj.scale.y).toBeGreaterThan(small + 0.2);
  });
});

describe('R3D-31: the Gorger', () => {
  const def = UNIT_RIGS.ali_gorger!();
  const walker = true;

  it('R3D-31: its body pitch is 0 and it does not lunge while mining or unloading, only a slow side-to-side sway', () => {
    const t = rigTree(def);
    const body = t.anims.find((a) => a.anim.k === 'body')!;
    const roll: number[] = [];
    for (let ms = 0; ms < 4400; ms += 100) {
      // A chomp's lunge, the walker's own pitch and a kick all try to tip it; none may.
      poseRig(t, { ...STILL, walker, feed: 1, lunge: 1, reach: 0.2, pitch: 0.2, kick: 1, time: ms, tip: ms % 200 ? 0 : 1 });
      expect(body.obj.rotation.z, `pitch at ${ms}`).toBe(body.rot.z);
      expect(body.obj.position.x, `shift at ${ms}`).toBeCloseTo(body.pos.x - 0.01, 9);
      roll.push(body.obj.rotation.x);
    }
    // The sway is slow (one cycle in about 2 s) and only a few degrees.
    expect(Math.max(...roll)).toBeGreaterThan(0.03);
    expect(Math.max(...roll)).toBeLessThan(0.07);
    expect(Math.min(...roll)).toBeLessThan(-0.03);
    const crossings = roll.slice(1).filter((r, i) => Math.sign(r) !== Math.sign(roll[i]!)).length;
    expect(crossings).toBeGreaterThanOrEqual(3);
    expect(crossings).toBeLessThanOrEqual(5);
    // Other walkers still lunge.
    const rifle = rigTree(UNIT_RIGS.ali_skitter!());
    const rb = rifle.anims.find((a) => a.anim.k === 'body')!;
    poseRig(rifle, { ...STILL, walker, lunge: 1, reach: 0.2 });
    expect(rb.obj.rotation.z).toBeLessThan(rb.rot.z);
  });

  it('R3D-31: mandibles and feeding tendrils reach out, close and draw back in a calm rhythm of 0.7 to 1 s', () => {
    const t = rigTree(def);
    const feeds = t.anims.filter((a) => a.anim.k === 'feed');
    const jaws = feeds.filter((a) => a.anim.k === 'feed' && a.anim.axis === 'y');
    const tendrils = feeds.filter((a) => a.anim.k === 'feed' && a.anim.axis === 'z');
    expect(jaws.length).toBeGreaterThanOrEqual(2);
    expect(tendrils.length).toBeGreaterThanOrEqual(6); // two to four tendrils of several segments
    const period = (2 * Math.PI) / (feeds[0]!.anim as { rate: number }).rate;
    expect(period).toBeGreaterThanOrEqual(0.7);
    expect(period).toBeLessThanOrEqual(1);
    // At rest they are curled in and closed; feeding, they move.
    poseRig(t, { ...STILL, walker, feed: 0, time: 500 });
    const rest = feeds.map((a) => (a.anim.k === 'feed' ? a.obj.rotation[a.anim.axis] : 0));
    const swing = feeds.map(() => 0);
    for (let ms = 0; ms < period * 1000; ms += 20) {
      poseRig(t, { ...STILL, walker, feed: 1, time: ms });
      feeds.forEach((a, i) => {
        if (a.anim.k === 'feed') swing[i] = Math.max(swing[i]!, Math.abs(a.obj.rotation[a.anim.axis] - rest[i]!));
      });
    }
    swing.forEach((d, i) => expect(d, `limb ${i}`).toBeGreaterThan(0.1));
    // The cycle runs out and back.
    expect(feedCycle(0, 7.4, 0)).toBeCloseTo(0, 9);
    expect(feedCycle(period * 500, 7.4, 0)).toBeCloseTo(1, 6);
    expect(feedCycle(period * 1000, 7.4, 0)).toBeCloseTo(0, 6);
    // Reaching, the first tendril's tip is well out ahead of and below where it curls at rest.
    const tipOf = (feed: number, ms: number): THREE.Vector3 => {
      poseRig(t, { ...STILL, walker, feed, time: ms });
      t.root.updateMatrixWorld(true);
      return new THREE.Vector3(0.13, 0, 0).applyMatrix4(node(t, 'tendTip').obj.matrixWorld);
    };
    const curled = tipOf(0, 0);
    const reach = tipOf(1, (period * 1000) / 2);
    expect(reach.x - curled.x).toBeGreaterThan(0.15);
    expect(curled.y - reach.y).toBeGreaterThan(0.2);
  });

  it('R3D-31: the throat pulses with each swallow, the belly swells with the load and contracts in waves front to back when unloading', () => {
    const t = rigTree(def);
    const throat = t.anims.find((a) => a.anim.k === 'pulse' && a.anim.swallow && a.anim.swallow > 0.2)!;
    let peak = 1;
    let low = 1;
    for (let ms = 0; ms < 1000; ms += 20) {
      poseRig(t, { ...STILL, walker, feed: 1, time: ms });
      peak = Math.max(peak, throat.obj.scale.x);
      low = Math.min(low, throat.obj.scale.x);
    }
    expect(peak).toBeGreaterThan(1.15);
    expect(low).toBe(1); // between swallows it rests
    poseRig(t, { ...STILL, walker, feed: 0, time: 400 });
    expect(throat.obj.scale.x).toBe(1);
    expect(swallowBeat(0, 7.4, 0)).toBe(0);
    // The belly swells with the load.
    const belly = t.anims.find((a) => a.anim.k === 'cargo')!;
    poseRig(t, { ...STILL, walker, load: 0.1 });
    const small = belly.obj.scale.y;
    poseRig(t, { ...STILL, walker, load: 1 });
    expect(belly.obj.scale.y).toBeGreaterThan(small + 0.2);
    // Unloading, the segments pulse one after another, the front one first.
    const segs = ['seg0', 'seg1', 'seg2'].map((g) => node(t, g).obj);
    const firstPeak = segs.map(() => -1);
    const peaks = segs.map(() => 0);
    for (let ms = 0; ms < 1100; ms += 10) {
      poseRig(t, { ...STILL, walker, tip: 1, time: ms });
      segs.forEach((o, i) => {
        if (o.scale.x > peaks[i]! + 1e-9) {
          peaks[i] = o.scale.x;
          firstPeak[i] = ms;
        }
      });
    }
    for (const p of peaks) expect(p).toBeGreaterThan(1.05);
    expect(firstPeak[0]!).toBeLessThan(firstPeak[1]!);
    expect(firstPeak[1]!).toBeLessThan(firstPeak[2]!);
  });

  it('R3D-31: the body stays level while unloading and only the head nods', () => {
    const t = rigTree(def);
    const head = t.anims.find((a) => a.anim.k === 'tip')!;
    poseRig(t, { ...STILL, walker, tip: 1, time: 0 });
    expect(Math.abs(head.obj.rotation.z)).toBeLessThan(0.35);
    const body = t.anims.find((a) => a.anim.k === 'body')!;
    expect(body.obj.rotation.z).toBe(0);
  });
});

describe('R3D-32: the Hammer Artillery', () => {
  const def = UNIT_RIGS.hum_artillery!();

  /** The muzzle's world point and the barrel's world direction (its +X). */
  function muzzle(t: RigTree, pose: Partial<RigPose>): { at: THREE.Vector3; dir: THREE.Vector3 } {
    poseRig(t, { ...STILL, ...pose });
    t.root.updateMatrixWorld(true);
    const m = t.muzzles[0]!;
    return { at: new THREE.Vector3().setFromMatrixPosition(m.matrixWorld), dir: new THREE.Vector3().setFromMatrixColumn(m.matrixWorld, 0).normalize() };
  }

  it('R3D-32: a long low tracked hull on seven road wheels, an enclosed turret toward the rear, and no outriggers or crew', () => {
    const t = rigTree(def);
    expect(t.anims.filter((a) => a.anim.k === 'wheel')).toHaveLength(14);
    poseRig(t, STILL);
    const hullBox = bounds(def, t, ['hull', 'track']);
    expect(hullBox.getSize(new THREE.Vector3()).x).toBeGreaterThan(1.4);
    expect(hullBox.max.y).toBeLessThan(0.5);
    const turret = bounds(def, t, ['turret']);
    expect(turret.getCenter(new THREE.Vector3()).x).toBeLessThan(0);
    // Nothing open: no hazard-yellow ammunition racks, no skin or cloth of a crew.
    const paints = new Set<unknown>();
    for (const sh of Object.values(def.shapes)) for (const p of sh().pieces) paints.add(p.paint);
    for (const crew of [0xe0aa2c, 0xb98a6a, 0x5c6a4e]) expect(paints.has(crew), crew.toString(16)).toBe(false);
    // The glacis carries a travel lock.
    expect(def.shapes.hull!().pieces.length).toBeGreaterThan(14);
  });

  it('R3D-32: elevation 0 rests the barrel nearly level in its lock, 1 raises it steeply, and the muzzle rides the barrel tip in both', () => {
    const t = rigTree(def);
    const lock = muzzle(t, { elev: 0 });
    const up = muzzle(t, { elev: 1 });
    expect(Math.asin(lock.dir.y)).toBeCloseTo(HAMMER_LOCK, 6);
    expect(Math.asin(up.dir.y)).toBeCloseTo(HAMMER_RAISED, 6);
    expect(HAMMER_RAISED).toBeGreaterThanOrEqual(0.6);
    expect(HAMMER_RAISED).toBeLessThanOrEqual(0.75);
    expect(HAMMER_LOCK).toBeLessThan(0.08);
    // The muzzle is where the barrel's tip is: the trunnion plus the barrel's length along its own direction.
    const trunnion = (el: number): THREE.Vector3 => {
      poseRig(t, { ...STILL, elev: el });
      t.root.updateMatrixWorld(true);
      return new THREE.Vector3(...HAMMER_TRUNNION).applyMatrix4(t.drawn.find((d) => d.geo === 'turret')!.obj.matrixWorld);
    };
    for (const [el, m] of [[0, lock], [1, up]] as const) {
      expect(m.at.distanceTo(trunnion(el).addScaledVector(m.dir, HAMMER_MUZZLE)), `elev ${el}`).toBeLessThan(1e-6);
    }
    // Raised, the muzzle is much higher but the barrel's yaw is unchanged (AIM-1).
    expect(up.at.y).toBeGreaterThan(lock.at.y + 0.5);
    expect(Math.atan2(up.dir.z, up.dir.x)).toBeCloseTo(Math.atan2(lock.dir.z, lock.dir.x), 9);
    // The barrel reaches out over the hull front in the lock.
    expect(lock.at.x).toBeGreaterThan(1.0);
    // Turned toward a target, the muzzle still points along the aim at either elevation.
    for (const el of [0, 1]) {
      const m = muzzle(t, { elev: el, turret: 1.1 });
      expect(Math.atan2(m.dir.z, m.dir.x)).toBeCloseTo(1.1, 6);
    }
    // Recoil slides the muzzle back along the barrel, not along the ground.
    const kick = muzzle(t, { elev: 1, kick: 1 });
    expect(kick.at.clone().sub(up.at).normalize().dot(up.dir)).toBeLessThan(-0.9);
  });

  it('R3D-32: the barrel never clips into the hull or the turret at elevation 0 or 1, nor as the turret turns', () => {
    const t = rigTree(def);
    const solids = (geo: string) => def.shapes[geo]!().pieces.map((p) => {
      const pos = p.geo.getAttribute('position');
      const vs: THREE.Vector3[] = [];
      for (let i = 0; i < pos.count; i++) vs.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      const size = new THREE.Box3().setFromPoints(vs).getSize(new THREE.Vector3());
      return Math.min(size.x, size.y, size.z) > 0.01 && Math.max(size.x, size.y, size.z) >= 0.05 ? { hull: new ConvexHull().setFromPoints(vs) } : null;
    }).filter((x) => x !== null);
    const barrelPts = def.shapes.barrel!().pieces.flatMap((p) => {
      const pos = p.geo.getAttribute('position');
      return Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i));
    });
    const worst: Record<string, number> = {};
    for (const el of [0, 0.5, 1]) {
      for (const yaw of [0, 0.7, 1.6, 3.1]) {
        poseRig(t, { ...STILL, elev: el, turret: yaw });
        t.root.updateMatrixWorld(true);
        const barrel = node(t, 'barrel').obj.matrixWorld;
        for (const geo of ['hull', 'turret']) {
          const into = new THREE.Matrix4().copy(node(t, geo).obj.matrixWorld).invert().multiply(barrel);
          const v = new THREE.Vector3();
          for (const s of solids(geo)) {
            for (const p of barrelPts) {
              v.copy(p).applyMatrix4(into);
              let inside = Infinity;
              for (const f of s!.hull.faces) {
                const d = f.normal.dot(v) - f.constant;
                if (d > 0) {
                  inside = 0;
                  break;
                }
                inside = Math.min(inside, -d);
              }
              const k = `${geo} elev ${el}`;
              worst[k] = Math.max(worst[k] ?? 0, inside);
            }
          }
        }
      }
    }
    for (const [k, d] of Object.entries(worst)) expect(d, k).toBeLessThan(0.012);
  });

  it('R3D-32: the barrel raises over 0.6 s while it has a target or fired in the last 3 s, and returns to the lock over 1 s otherwise', () => {
    expect(elevTarget(true, 1e9)).toBe(1);
    expect(elevTarget(false, 2999)).toBe(1);
    expect(elevTarget(false, ELEV_HOLD_MS + 1)).toBe(0);
    expect(ELEV_UP_MS).toBe(600);
    expect(ELEV_DOWN_MS).toBe(1000);
    let e = 0;
    for (let i = 0; i < 36; i++) e = slew(e, 1, 1 / 60, ELEV_UP_MS, ELEV_DOWN_MS);
    expect(e).toBeCloseTo(1, 6);
    expect(slew(0, 1, 1 / 60, ELEV_UP_MS, ELEV_DOWN_MS)).toBeLessThan(0.03);
    for (let i = 0; i < 30; i++) e = slew(e, 0, 1 / 60, ELEV_UP_MS, ELEV_DOWN_MS);
    expect(e).toBeGreaterThan(0.45);
    for (let i = 0; i < 30; i++) e = slew(e, 0, 1 / 60, ELEV_UP_MS, ELEV_DOWN_MS);
    expect(e).toBe(0);
  });
});

describe('R3D-33: the Scout Buggy', () => {
  const def = UNIT_RIGS.hum_buggy!();

  it('R3D-33: it has no driver or crew figure anywhere, only a closed cab under a tinted canopy', () => {
    expect(Object.keys(def.shapes).filter((k) => /driver|crew|pilot/i.test(k))).toEqual([]);
    const paints = new Set<unknown>();
    const glows: number[] = [];
    for (const sh of Object.values(def.shapes)) {
      for (const p of sh().pieces) {
        paints.add(p.paint);
        if (p.glow && typeof p.paint === 'number') glows.push(p.paint);
      }
    }
    for (const crew of [0xb98a6a, 0x5c6a4e]) expect(paints.has(crew), crew.toString(16)).toBe(false); // no skin or cloth
    // The canopy is a dark blue-grey and does not glow.
    expect(paints.has(0x2c3a48)).toBe(true);
    expect(glows).not.toContain(0x2c3a48);
    // No open roll cage: no thin tubes standing in the cab.
    const body = def.shapes.body!();
    const tall = body.pieces.filter((p) => {
      p.geo.computeBoundingBox();
      const s = p.geo.boundingBox!.getSize(new THREE.Vector3());
      return s.y > 0.25 && s.x < 0.05 && s.z < 0.05;
    });
    expect(tall.length).toBe(1); // only the sensor mast
  });

  it('R3D-33: four wheels, the front pair steering, a sensor mast at the back and a twin-barrelled weapon that still shoots', () => {
    const t = rigTree(def);
    expect(t.anims.filter((a) => a.anim.k === 'wheel')).toHaveLength(4);
    expect(t.anims.filter((a) => a.anim.k === 'steer')).toHaveLength(2);
    expect(t.muzzles).toHaveLength(2);
    poseRig(t, STILL);
    const b = bounds(def, t);
    const size = b.getSize(new THREE.Vector3());
    expect(size.x).toBeGreaterThan(1.0);
    expect(size.x).toBeLessThan(1.4);
    expect(size.z).toBeLessThan(0.8);
    expect(size.y).toBeLessThan(0.7);
    expect(b.min.y).toBeGreaterThan(-0.02);
    // The mast is at the back, higher than the canopy.
    const body = def.shapes.body!();
    let mast = false;
    for (const p of body.pieces) {
      p.geo.computeBoundingBox();
      const bb = p.geo.boundingBox!;
      if (bb.max.y > 0.6 && bb.getCenter(new THREE.Vector3()).x < -0.3) mast = true;
    }
    expect(mast).toBe(true);
    // Suspension arms run from the body to each wheel hub: pieces reaching out across the wheel line.
    const arms = body.pieces.filter((p) => {
      p.geo.computeBoundingBox();
      const bb = p.geo.boundingBox!;
      return bb.max.z > 0.2 && bb.min.z < 0.17 && bb.max.y < 0.35 && bb.getSize(new THREE.Vector3()).x < 0.2;
    });
    expect(arms.length).toBeGreaterThanOrEqual(6);
  });

  it('R3D-33: the body bobs and rolls a little over the ground as it races, calmly, and not at all when parked', () => {
    expect(def.ride).toBeGreaterThan(0);
    const park = rideMotion(def.ride!, 0, 1234, 1);
    expect(park).toEqual({ pitch: 0, roll: 0, bob: 0 });
    let roll = 0;
    let bob = 0;
    let pitch = 0;
    const rolls = new Set<string>();
    for (let t = 0; t < 4000; t += 25) {
      const r = rideMotion(def.ride!, 1, t, 3);
      roll = Math.max(roll, Math.abs(r.roll));
      pitch = Math.max(pitch, Math.abs(r.pitch));
      bob = Math.max(bob, Math.abs(r.bob));
      rolls.add(r.roll.toFixed(3));
    }
    expect(rolls.size).toBeGreaterThan(20);
    expect(roll).toBeGreaterThan(0.02);
    expect(roll).toBeLessThan(0.06);
    expect(pitch).toBeLessThan(0.04);
    expect(bob).toBeGreaterThan(0.003);
    expect(bob).toBeLessThan(0.03);
  });
});
