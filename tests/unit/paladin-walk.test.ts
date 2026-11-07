import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { FP, TICKS_PER_SECOND } from '../../src/sim';
import { unitDef } from '../../src/data/defs';
import { bodyPose, gaitPhase, restingMotion, stepMotion, type MotionState } from '../../src/render3d/motion';
import { kneeFor, poseRig, rigTree, stepPath, type AnimatedNode, type RigPose, type RigTree } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: true };
const def = UNIT_RIGS.hum_paladin!();
const SCALE = def.scale ?? 1;
const STRIDE = def.stride ?? 1;
/** The Paladin's ground speed, tiles per second. */
const SPEED = (unitDef('hum_paladin').speed * TICKS_PER_SECOND) / FP;

/** Pose the rig as the game does for a unit `dist` tiles along its way with motion `m`; the root moves with it. */
function pose(t: RigTree, m: MotionState): void {
  const phase = gaitPhase(m.dist, STRIDE);
  const b = bodyPose('walker', m, phase, 0, 0, def.walk);
  poseRig(t, { ...STILL, phase, stride: m.stride, dist: m.dist, pitch: b.pitch, roll: b.roll, bob: b.bob });
  t.root.position.x = m.dist / SCALE;
  t.root.updateMatrixWorld(true);
}

const walking = (dist: number): MotionState => ({ ...restingMotion(), dist, speed: SPEED, stride: 1 });
const legsOf = (t: RigTree): AnimatedNode[] => t.anims.filter((a) => a.anim.k === 'step');
/** World position in tiles of a point given in a node's own frame. */
const world = (o: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(o.matrixWorld).multiplyScalar(SCALE);
const sole = (leg: AnimatedNode): THREE.Vector3 => world(leg.links![1]!, 0, -0.06, 0);
const planted = (leg: AnimatedNode, dist: number): boolean => Math.cos(gaitPhase(dist, STRIDE) + (leg.anim as { phase: number }).phase) <= 0;

describe('the Paladin walks smoothly', () => {
  it('HERO-6: a planted foot stays put on the ground, level, while the hull moves over it (it used to slide about 0.48 tiles a step)', () => {
    const t = rigTree(def);
    const legs = legsOf(t);
    expect(legs).toHaveLength(4);
    let worst = 0;
    let steps = 0;
    for (const leg of legs) {
      let first: THREE.Vector3 | null = null;
      for (let d = 0; d < 3 * STRIDE; d += STRIDE / 200) {
        if (!planted(leg, d)) {
          if (first) steps++;
          first = null;
          continue;
        }
        pose(t, walking(d));
        const p = sole(leg);
        first ??= p;
        worst = Math.max(worst, Math.hypot(p.x - first.x, p.z - first.z));
        // On the ground, neither sunk nor floating, and lying flat.
        expect(Math.abs(p.y)).toBeLessThan(0.01);
        const up = new THREE.Vector3().setFromMatrixColumn(leg.links![1]!.matrixWorld, 1).normalize();
        expect(up.y).toBeGreaterThan(0.9999);
      }
    }
    expect(steps).toBeGreaterThanOrEqual(8);
    expect(worst).toBeLessThan(0.02);
  });

  it('HERO-6: a foot lifts off, swings forward and plants again; posing is a pure function of the pose', () => {
    // Over its swing the foot rises and comes down smoothly, and leaves and meets the ground at the stance's own speed.
    expect(stepPath(-Math.PI / 2).fore).toBeCloseTo(-1, 9);
    expect(stepPath(Math.PI / 2).fore).toBeCloseTo(1, 9);
    expect(stepPath(Math.PI).lift).toBe(0);
    expect(stepPath(0).lift).toBeCloseTo(1, 9);
    const speed = (u: number): number => (stepPath(u + 1e-5).fore - stepPath(u - 1e-5).fore) / 2e-5;
    for (const u of [-Math.PI / 2, Math.PI / 2]) expect(speed(u)).toBeCloseTo(speed(Math.PI), 3);
    const t = rigTree(def);
    const legs = legsOf(t);
    let high = 0;
    for (let d = 0; d < STRIDE; d += STRIDE / 100) {
      pose(t, walking(d));
      for (const l of legs) high = Math.max(high, sole(l).y);
    }
    expect(high).toBeGreaterThan(0.08);
    pose(t, walking(0.7));
    const a = legs.map((l) => sole(l).toArray());
    pose(t, walking(1.3));
    pose(t, walking(0.7));
    expect(legs.map((l) => sole(l).toArray())).toEqual(a);
  });

  it('HERO-6: each leg bends at the knee, thigh and shin at changing angles, the knee always behind', () => {
    const t = rigTree(def);
    const leg = legsOf(t)[0]!;
    const [shin, foot] = leg.links!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let d = 0; d < STRIDE; d += STRIDE / 100) {
      pose(t, walking(d));
      const hip = world(leg.obj);
      const knee = world(shin!);
      const ankle = world(foot!);
      const thigh = knee.clone().sub(hip).normalize();
      const shank = ankle.clone().sub(knee).normalize();
      const bend = Math.acos(thigh.dot(shank));
      lo = Math.min(lo, bend);
      hi = Math.max(hi, bend);
      // A reverse joint: the knee sits behind the line from hip to ankle.
      const mid = hip.clone().lerp(ankle, (knee.y - hip.y) / (ankle.y - hip.y));
      expect(knee.x).toBeLessThan(mid.x);
    }
    expect(lo).toBeGreaterThan(0.3);
    expect(hi - lo).toBeGreaterThan(0.3);
    // The IK puts the ankle where it is asked to go.
    const [kx, ky] = kneeFor(0.3, 0.3, 0.1, -0.45);
    expect(Math.hypot(kx, ky)).toBeCloseTo(0.3, 9);
    expect(Math.hypot(0.1 - kx, -0.45 - ky)).toBeCloseTo(0.3, 9);
    expect(kx).toBeLessThan(0.1 * (ky / -0.45));
  });

  it('HERO-6: the hull bobs and sways gently and smoothly in time with the steps', () => {
    const t = rigTree(def);
    const body = t.anims.find((a) => a.anim.k === 'body')!.obj;
    const ys: number[] = [];
    const rolls: number[] = [];
    const N = 200;
    for (let i = 0; i <= N; i++) {
      pose(t, walking((i / N + 0.125) * STRIDE));
      ys.push(world(body).y);
      rolls.push(body.rotation.x);
    }
    const range = Math.max(...ys) - Math.min(...ys);
    expect(range).toBeGreaterThan(0.01);
    expect(range).toBeLessThan(0.035);
    // Twice per cycle, once per step: highest as each diagonal pair stands under it.
    let peaks = 0;
    for (let i = 1; i < N; i++) if (ys[i]! > ys[i - 1]! && ys[i]! >= ys[i + 1]!) peaks++;
    expect(peaks).toBe(2);
    // Smooth: no kinks, the change from one sample to the next itself changes only a little.
    let kink = 0;
    for (let i = 1; i < N; i++) kink = Math.max(kink, Math.abs(ys[i + 1]! - 2 * ys[i]! + ys[i - 1]!));
    expect(kink).toBeLessThan(range * 0.01);
    expect(Math.max(...rolls) - Math.min(...rolls)).toBeGreaterThan(0.02);
    expect(Math.max(...rolls.map(Math.abs))).toBeLessThan(0.03);
    // The hips ride with the hull, so the legs stay attached to it.
    const leg = legsOf(t)[0]!;
    for (const d of [0, STRIDE / 4]) {
      pose(t, walking(d));
      expect(leg.obj.position.y - body.position.y).toBeCloseTo(0.53 - 0.57, 9);
    }
  });

  it('HERO-6: the walk eases in as it starts and out as it stops, rather than snapping', () => {
    const dt = 1 / 60;
    /** Stand, walk for 3 s, then stop for 2 s, returning the biggest frame-to-frame move of any foot or the hull, in
     * tiles relative to the hull, while starting, at a steady walk, and while stopping. */
    const run = (blend: number): { start: number; steady: number; stop: number; rampS: number } => {
      const t = rigTree(def);
      const legs = legsOf(t);
      const body = t.anims.find((a) => a.anim.k === 'body')!.obj;
      let m = restingMotion();
      let prev: THREE.Vector3[] | null = null;
      const out = { start: 0, steady: 0, stop: 0, rampS: 0 };
      for (let f = 0; f < 310; f++) {
        const moving = f >= 10 && f < 190;
        m = stepMotion(m, moving ? SPEED * dt : 0, 0, dt, 4, blend);
        if (!out.rampS && m.stride >= 0.9) out.rampS = (f - 10) * dt;
        pose(t, m);
        const root = world(t.root);
        const pts = [...legs.map((l) => sole(l).sub(root)), world(body).sub(root)];
        if (prev) {
          const step = Math.max(...pts.map((p, i) => p.distanceTo(prev![i]!)));
          const k = f < 70 ? 'start' : f < 190 ? 'steady' : 'stop';
          out[k] = Math.max(out[k], step);
        }
        prev = pts;
      }
      return out;
    };
    const paladin = run(def.walk!.blend);
    // Starting and stopping never jerk the legs harder than walking does, and the walk takes a while to build up.
    expect(paladin.start).toBeLessThanOrEqual(paladin.steady * 1.05);
    expect(paladin.stop).toBeLessThanOrEqual(paladin.steady * 1.05);
    expect(paladin.rampS).toBeGreaterThan(0.4);
    expect(paladin.rampS).toBeLessThan(1.5);
    // A walk that snapped on would jump in a single frame.
    const snap = run(1e6);
    expect(snap.start).toBeGreaterThan(paladin.steady * 2);
  });

  it('HERO-6: only the Paladin walks this way; the Dreadstrider and other walkers keep their gait', () => {
    for (const [kind, mk] of Object.entries(UNIT_RIGS)) {
      if (kind === 'hum_paladin') continue;
      const d = mk();
      expect(d.walk, kind).toBeUndefined();
      expect(rigTree(d).anims.some((a) => a.anim.k === 'step'), kind).toBe(false);
    }
    // Without a walk style a walker's body moves exactly as before.
    const m = { ...restingMotion(), stride: 1 };
    expect(bodyPose('walker', m, 0.7, 0, 0)).toEqual({ pitch: 0.04, roll: 0.012 * Math.sin(0.7), bob: 0.006 * Math.abs(Math.sin(0.7)) });
  });
});
