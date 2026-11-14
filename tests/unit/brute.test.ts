import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { poseRig, rigTree, STRIKE_HIT, STRIKE_MS, strikeAfter, strikeSideOf, strikeWeights, type RigPose, type RigTree } from '../../src/render3d/rig';
import { UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: true };

/** The Brute's triangle counts before the restyle (R3D-37), summed over its shapes as the rig used them: lit and shadow stand-in. */
const BRUTE_TRIANGLES_BEFORE = 2882;
const BRUTE_SHADOW_TRIANGLES_BEFORE = 534;
const BRUTE_SHAPES_BEFORE = 3;

const def = UNIT_RIGS.ali_brute!();

/**
 * The rig node with `geo` on the given side (+1 the right, +Z, listed first by the rig; -1 the left). The one paw shape is both
 * the hand ('hand') and the foot ('foot'): the rig lists the feet before the hands.
 */
function node(t: RigTree, geo: string, side: 1 | -1): THREE.Object3D {
  const paw = geo === 'hand' || geo === 'foot';
  const all = t.drawn.filter((d) => d.geo === (paw ? 'paw' : geo)).map((d) => d.obj);
  expect(all.length, geo).toBe(paw ? 4 : 2);
  t.root.updateMatrixWorld(true);
  return all[(geo === 'hand' ? 2 : 0) + (side > 0 ? 0 : 1)]!;
}

const at = (o: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

/** Where a hand's claws are, in the model's frame (the hand node's own forward point). */
const claws = (t: RigTree, side: 1 | -1): THREE.Vector3 => {
  t.root.updateMatrixWorld(true);
  return new THREE.Vector3(0.2, -0.04, 0).applyMatrix4(node(t, 'hand', side).matrixWorld);
};

/** The same point in the torso's own frame, which turns with a blow: it shows whether an arm itself moved. */
const clawsOnTorso = (t: RigTree, side: 1 | -1): THREE.Vector3 => {
  const body = t.drawn.find((d) => d.geo === 'body')!.obj;
  return body.worldToLocal(claws(t, side));
};

describe('the Brute (R3D-37)', () => {
  it('R3D-37: each arm is shoulder, elbow and wrist and each leg hip, knee and ankle, as nodes that bend through a stride', () => {
    const t = rigTree(def);
    for (const side of [1, -1] as const) {
      // Upper arm -> forearm -> hand and thigh -> shin -> foot are nested nodes, each hung from the joint of the one above.
      const chains = [['uarm', 'farm', 'hand'], ['thigh', 'shin', 'foot']];
      for (const chain of chains) {
        const [a, b, c] = chain.map((g) => node(t, g!, side));
        expect(b!.parent).toBe(a);
        expect(c!.parent).toBe(b);
      }
    }
    // Elbows, wrists, knees and ankles all turn through a stride: they are not rigid pieces swung whole.
    const range = (geo: string): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let ph = 0; ph < Math.PI * 2; ph += 0.2) {
        poseRig(t, { ...STILL, phase: ph, stride: 1, dist: ph });
        const z = node(t, geo, 1).rotation.z;
        lo = Math.min(lo, z);
        hi = Math.max(hi, z);
      }
      return hi - lo;
    };
    for (const geo of ['farm', 'hand', 'shin', 'foot']) expect(range(geo), geo).toBeGreaterThan(0.2);
    // The shoulder and hip swing the whole limb, and the arm swings against the leg on its side.
    for (const geo of ['uarm', 'thigh']) expect(range(geo), geo).toBeGreaterThan(0.6);
    let against = 0;
    for (let ph = 0.1; ph < Math.PI * 2; ph += 0.3) {
      poseRig(t, { ...STILL, phase: ph, stride: 1, dist: ph });
      against += Math.sign(node(t, 'uarm', 1).rotation.z) * Math.sign(node(t, 'thigh', 1).rotation.z);
    }
    expect(against).toBeLessThan(0);
  });

  it('R3D-37: every joint is a rounded knuckle that the segments sink into', () => {
    // Each segment's shape ends in a ball at the joint below it, and the next segment's strut begins at that centre.
    const ball = (geo: string): boolean => def.shapes[geo]!().pieces.some((p) => p.geo instanceof THREE.SphereGeometry);
    for (const geo of ['uarm', 'farm', 'thigh', 'shin', 'body']) expect(ball(geo), geo).toBe(true);
    // Each knuckle is a chunky ball, wider than a hand.
    for (const geo of ['uarm', 'farm', 'thigh', 'shin']) {
      const knuckle = def.shapes[geo]!().pieces.find((p) => p.geo instanceof THREE.SphereGeometry)!;
      const b = new THREE.Box3().setFromBufferAttribute(knuckle.geo.getAttribute('position') as THREE.BufferAttribute);
      expect(b.getSize(new THREE.Vector3()).z, geo).toBeGreaterThan(0.1);
    }
  });

  it('R3D-37: the legs hang from the hips the torso sits on, so the legs belong to the hips and not to the torso that twists', () => {
    const t = rigTree(def);
    const hips = t.drawn.find((d) => d.geo === 'body')!.obj.parent!;
    for (const side of [1, -1] as const) expect(node(t, 'thigh', side).parent).toBe(hips);
    // The shots leave from where they did before the rebuild: the same point ahead of the torso, at rest.
    t.root.updateMatrixWorld(true);
    const m = at(t.muzzles[0]!);
    expect(m.x).toBeCloseTo(0.5, 6);
    expect(m.y).toBeCloseTo(0.1, 6);
    expect(m.z).toBeCloseTo(0, 6);
  });

  it('R3D-37: a claw blow drives one arm forward and down, the other arm stays, and the arms alternate from blow to blow', () => {
    const t = rigTree(def);
    poseRig(t, STILL);
    const rest = { r: claws(t, 1), l: claws(t, -1) };
    const restOnTorso = { r: clawsOnTorso(t, 1), l: clawsOnTorso(t, -1) };
    for (const side of [1, -1] as const) {
      poseRig(t, { ...STILL, strike: 0.19, strikeSide: side });
      const wind = claws(t, side);
      poseRig(t, { ...STILL, strike: STRIKE_HIT, strikeSide: side });
      const hit = claws(t, side);
      // The blow comes down and forward from the wind-up, to claws well in front of the body.
      expect(hit.x - wind.x).toBeGreaterThan(0.2);
      expect(hit.y).toBeLessThan(wind.y - 0.3);
      expect(hit.x).toBeGreaterThan(0.6);
      expect(hit.x - (side > 0 ? rest.r.x : rest.l.x)).toBeGreaterThan(0.3);
      // The other arm is where it was at rest.
      const other = clawsOnTorso(t, -side as 1 | -1);
      expect(other.distanceTo(side > 0 ? restOnTorso.l : restOnTorso.r)).toBeLessThan(0.01);
    }
    // One side after the other.
    expect([1, 2, 3, 4].map(strikeSideOf)).toEqual([1, -1, 1, -1]);
    // At rest, or after the blow, nothing is under way.
    expect(strikeAfter(-5)).toBe(0);
    expect(strikeAfter(STRIKE_MS + 1)).toBe(0);
    expect(strikeWeights(0)).toEqual([0, 0]);
    expect(strikeWeights(1)).toEqual([0, 0]);
  });

  it('R3D-37: the blow lands with the damage: its contact comes no later than the old lunge peaked, 130 ms after the shot', () => {
    expect(STRIKE_HIT * STRIKE_MS).toBeLessThanOrEqual(130);
    expect(strikeWeights(STRIKE_HIT)).toEqual([0, 1]);
    expect(strikeAfter(STRIKE_HIT * STRIKE_MS)).toBeCloseTo(STRIKE_HIT, 6);
  });

  it('R3D-37: the torso twists and leans into the blow while the legs stay planted and joined at the hips', () => {
    const t = rigTree(def);
    poseRig(t, STILL);
    t.root.updateMatrixWorld(true);
    const parts = ['thigh', 'shin', 'foot'].flatMap((g) => ([1, -1] as const).map((s) => node(t, g, s)));
    const body = t.drawn.find((d) => d.geo === 'body')!.obj;
    const before = parts.map((o) => at(o));
    const hips = body.parent!;
    const hipsAt = at(hips);
    const waist = body;
    const yaw0 = waist.rotation.y;
    for (const side of [1, -1] as const) {
      for (const k of [0.05, 0.19, 0.3, STRIKE_HIT, 0.6, 0.9]) {
        poseRig(t, { ...STILL, strike: k, strikeSide: side });
        t.root.updateMatrixWorld(true);
        // Hips, knees and ankles have not moved, and the hips they hang from are where they were.
        parts.forEach((o, i) => expect(at(o).distanceTo(before[i]!), `${side} ${k}`).toBeLessThan(1e-9));
        expect(at(hips).distanceTo(hipsAt)).toBeLessThan(1e-9);
      }
      poseRig(t, { ...STILL, strike: STRIKE_HIT, strikeSide: side });
      // The striking shoulder comes forward: the torso turns toward the arm that strikes, and leans forward.
      expect(Math.sign(waist.rotation.y - yaw0)).toBe(side);
      expect(Math.abs(waist.rotation.y - yaw0)).toBeGreaterThan(0.15);
      expect(waist.rotation.z).toBeLessThan(-0.1);
    }
  });

  it('R3D-37: the back armour carries the team colour and the shoulder plates too', () => {
    const body = def.shapes.body!();
    const arm = def.shapes.uarm!();
    expect(body.pieces.some((p) => p.paint === 'teamDark')).toBe(true);
    expect(arm.pieces.some((p) => p.paint === 'team')).toBe(true);
    const colour = (team: number): number[] => Array.from(def.shapes.body!().build(team).lit!.attributes.color!.array);
    expect(colour(0xff0000)).not.toEqual(colour(0x0000ff));
  });

  it('R3D-37 PERF-7: the Brute uses no more triangles than before the restyle, for the model and for its shadow stand-in', () => {
    const t = rigTree(def);
    const uses = new Map<string, number>();
    for (const d of t.drawn) uses.set(d.geo, (uses.get(d.geo) ?? 0) + 1);
    let tris = 0;
    let shadow = 0;
    for (const [geo, n] of uses) {
      const b = def.shapes[geo]!().build(0x3fa0ff);
      tris += n * b.triangles;
      shadow += n * (b.shadowTriangles ?? 0);
    }
    expect(tris).toBeLessThanOrEqual(BRUTE_TRIANGLES_BEFORE);
    expect(shadow).toBeLessThanOrEqual(BRUTE_SHADOW_TRIANGLES_BEFORE);
    // Left and right share every limb shape; the extra draw calls are one per distinct shape (R3D-13).
    expect(uses.size).toBeGreaterThan(BRUTE_SHAPES_BEFORE);
    expect(uses.size).toBeLessThanOrEqual(6);
  });
});
