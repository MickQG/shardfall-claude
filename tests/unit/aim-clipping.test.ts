import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { angleDiff, bodyPose, gunYaw, readyToFire, restingMotion, turretOnBody, walkerFacing } from '../../src/render3d/motion';
import { MAX_STEER, poseRig, rigTree, turretReach, walk, type RigDef, type RigPose, type RigTree } from '../../src/render3d/rig';
import { PALADIN_SWIVEL, UNIT_RIGS } from '../../src/render3d/units3d';

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

/** World yaw a muzzle points along (its +X axis), as the effects read it. */
function muzzleYaw(t: RigTree): number {
  t.root.updateMatrixWorld(true);
  const d = new THREE.Vector3().setFromMatrixColumn(t.muzzles[0]!.matrixWorld, 0);
  // Rigs turn by minus the game's yaw, so a game yaw a points +X along (cos a, sin a) in x and z.
  return Math.atan2(d.z, d.x);
}

describe('shots go where the gun points', () => {
  it('AIM-1: a lone walker faces its target whenever it shoots, and its turret turns on its own body', () => {
    expect(walkerFacing(true, 1.2, 0)).toBe(1.2);
    expect(walkerFacing(false, 1.2, 0.3)).toBe(0.3);
    expect(turretOnBody(1.2, 1.2)).toBe(0);
    expect(turretOnBody(1.0, 0.4)).toBeCloseTo(0.6);
    // The gun's own yaw: a full turret reaches anywhere, a swivel only so far, a fixed gun points with the body.
    expect(gunYaw(0, 2, Infinity)).toBeCloseTo(2);
    expect(gunYaw(0, 2, 0.2)).toBeCloseTo(0.2);
    expect(gunYaw(0.5, 2, 0)).toBeCloseTo(0.5);
    // A shot waits until that gun is on target.
    expect(readyToFire(true, gunYaw(0, 1, 0.2), 1, 0)).toBe(false);
    expect(readyToFire(true, gunYaw(0.9, 1, 0.2), 1, 0)).toBe(true);
  });

  it('AIM-1: with its body turned to a target off its path, a hero points its gun straight at it', () => {
    for (const kind of ['hum_paladin', 'ali_strider']) {
      const def = UNIT_RIGS[kind]!();
      const t = rigTree(def);
      // Walking along heading 0, shooting at a target 1 rad to the side: the body faces the target (the figure is turned
      // relative to the walking direction) and the turret has caught up with the aim.
      const heading = 0;
      const aim = 1;
      const body = walkerFacing(true, aim, heading);
      t.root.rotation.y = -(body - heading);
      poseRig(t, { ...STILL, walker: true, turret: turretOnBody(aim, body) });
      expect(Math.abs(angleDiff(muzzleYaw(t), aim - heading))).toBeLessThan(0.05);
      // The old way turned the turret by the aim again on top of the turned body: twice as far off.
      poseRig(t, { ...STILL, walker: true, turret: aim - heading });
      expect(Math.abs(angleDiff(muzzleYaw(t), aim - heading))).toBeGreaterThan(0.15);
    }
  });
});

describe('models do not clip', () => {
  /** Each drawn part's pieces: their points and, for solid pieces, a convex hull, in the part's own frame. */
  function parts(def: RigDef, t: RigTree) {
    return t.drawn
      .filter((d) => !d.cargo)
      .map((d) => ({
        d,
        pieces: def.shapes[d.geo]!().pieces.map((p) => {
          const pos = p.geo.getAttribute('position');
          const seen = new Map<string, THREE.Vector3>();
          for (let k = 0; k < pos.count; k++) {
            const v = new THREE.Vector3().fromBufferAttribute(pos, k);
            seen.set(`${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`, v);
          }
          const vs = [...seen.values()];
          const size = new THREE.Box3().setFromPoints(vs).getSize(new THREE.Vector3());
          const solid = Math.min(size.x, size.y, size.z) > 0.004 && Math.max(size.x, size.y, size.z) >= 0.05 && vs.length >= 4;
          return { vs, hull: solid ? new ConvexHull().setFromPoints(vs) : null };
        }),
      }));
  }

  /** How deep each part's points reach into each other part's solid pieces, keyed by part pair. */
  function depths(t: RigTree, ps: ReturnType<typeof parts>, pose: RigPose): Map<string, number> {
    poseRig(t, pose);
    t.root.updateMatrixWorld(true);
    const out = new Map<string, number>();
    const rel = new THREE.Matrix4();
    const v = new THREE.Vector3();
    ps.forEach((A, ia) =>
      ps.forEach((B, ib) => {
        if (A === B) return;
        rel.copy(B.d.obj.matrixWorld).invert().multiply(A.d.obj.matrixWorld);
        A.pieces.forEach((pa, ka) =>
          B.pieces.forEach((pb, kb) => {
            if (!pb.hull) return;
            let worst = 0;
            for (const p of pa.vs) {
              v.copy(p).applyMatrix4(rel);
              let inside = Infinity;
              for (const f of pb.hull.faces) {
                const dist = f.normal.dot(v) - f.constant;
                if (dist > 0) {
                  inside = 0;
                  break;
                }
                inside = Math.min(inside, -dist);
              }
              worst = Math.max(worst, inside);
            }
            if (worst > 0) out.set(`${A.d.geo}#${ia}.${ka}|${B.d.geo}#${ib}.${kb}`, worst);
          }),
        );
      }),
    );
    return out;
  }

  it('AIM-2: no part pushes into another as units aim, walk, steer, lean, recoil or lunge (beyond a barrel sliding into its own mount)', () => {
    const problems: string[] = [];
    for (const [kind, mk] of Object.entries(UNIT_RIGS)) {
      const def = mk();
      const t = rigTree(def);
      const ps = parts(def, t);
      const walker = def.move === 'walker';
      const hero = def.weapon === 'heroCannon' || def.weapon === 'heroAcid';
      const lean = walker ? 0.04 : 0.08;
      const poses: [string, RigPose][] = [];
      for (let a = -Math.PI; a < Math.PI; a += Math.PI / 8) poses.push([`turret ${a.toFixed(2)}`, { ...STILL, walker, turret: a }]);
      for (let ph = 0; ph < Math.PI * 2; ph += Math.PI / 6) {
        // A walker with its own walk (HERO-6) bobs and sways its hull with each step as well.
        const own = def.walk ? bodyPose('walker', { ...restingMotion(), stride: 1 }, ph, 0, 0, def.walk) : { pitch: 0, roll: 0, bob: 0 };
        poses.push([`gait ${ph.toFixed(2)}`, { ...STILL, walker, phase: ph, stride: 1, dist: ph, ...own }]);
      }
      poses.push(
        ['recoil', { ...STILL, walker, kick: 1 }],
        ['lunge', { ...STILL, walker, lunge: 1, reach: def.radius * 0.25 }],
        ['kneel', { ...STILL, walker, crouch: 1 }],
        ['unload', { ...STILL, walker, tip: 1 }],
        ['turning', { ...STILL, walker, turnRate: 3, turned: 2, dist: 1 }],
        ['lean forward', { ...STILL, walker, pitch: hero ? 0.16 : lean, bob: hero ? -0.07 : 0 }],
        ['lean back', { ...STILL, walker, pitch: hero ? -0.16 : -lean, bob: hero ? -0.07 : 0 }],
        ['roll', { ...STILL, walker, roll: walker ? 0.012 : 0.1 }],
        ['walk and fire', { ...STILL, walker, phase: 1, stride: 1, dist: 1, kick: 1, pitch: hero ? 0.2 : lean }],
      );
      const rest = depths(t, ps, { ...STILL, walker });
      for (const [name, pose] of poses) {
        for (const [key, d] of depths(t, ps, pose)) {
          const extra = (d - (rest.get(key) ?? 0)) * (def.scale ?? 1);
          if (extra <= 0.03) continue;
          // A barrel recoiling into its own mount is how a gun works (checked below to stay inside it).
          const [a, b] = key.split('|').map((x) => x.split('#')[0]);
          if (pose.kick > 0 && (a === 'barrel' || b === 'barrel') && ['turret', 'body', 'cradle', 'barrel'].includes(a === 'barrel' ? b! : a!)) continue;
          problems.push(`${kind}: ${key} +${extra.toFixed(3)} tiles (${name})`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);

  it('AIM-2: a recoiling barrel stays inside its mount, never poking out of the back', () => {
    for (const [kind, mk] of Object.entries(UNIT_RIGS)) {
      const def = mk();
      const t = rigTree(def);
      const barrel = t.drawn.find((d) => d.geo === 'barrel');
      if (!barrel) continue;
      poseRig(t, { ...STILL, kick: 1, walker: def.move === 'walker' });
      t.root.updateMatrixWorld(true);
      const mount = t.drawn.find((d) => d.obj === barrel.obj.parent) ?? t.drawn.find((d) => d.geo === 'body')!;
      const inMount = (d: { obj: THREE.Object3D; geo: string }): THREE.Box3 => {
        const m = new THREE.Matrix4().copy(mount.obj.matrixWorld).invert().multiply(d.obj.matrixWorld);
        const b = new THREE.Box3();
        for (const p of def.shapes[d.geo]!().pieces) {
          const pos = p.geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) b.expandByPoint(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
        }
        return b;
      };
      expect(inMount(barrel).min.x, kind).toBeGreaterThanOrEqual(inMount(mount).min.x - 1e-6);
    }
  });

  it('AIM-2: feet, wheels and tracks stand on the ground, neither sunk into it nor floating', () => {
    for (const [kind, mk] of Object.entries(UNIT_RIGS)) {
      const def = mk();
      const t = rigTree(def);
      poseRig(t, { ...STILL, walker: def.move === 'walker' });
      t.root.updateMatrixWorld(true);
      let low = Infinity;
      const v = new THREE.Vector3();
      for (const d of t.drawn) {
        if (d.cargo) continue;
        for (const p of def.shapes[d.geo]!().pieces) {
          const pos = p.geo.getAttribute('position');
          for (let i = 0; i < pos.count; i++) low = Math.min(low, v.fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld).y);
        }
      }
      // Tyres may squash onto the ground a touch; nothing sinks in or hovers.
      expect(low * (def.scale ?? 1), kind).toBeGreaterThan(-0.02);
      expect(low * (def.scale ?? 1), kind).toBeLessThan(0.02);
    }
  });

  it('AIM-2: the Paladin hull rides rigidly on its legs; only its cannon cradle swivels, a little', () => {
    const def = UNIT_RIGS.hum_paladin!();
    const turrets: string[] = [];
    walk(def.root, (n) => {
      if (n.anim?.k === 'turret') turrets.push(n.geo ?? '');
    });
    expect(turrets).toEqual(['cradle']);
    expect(turretReach(def)).toBe(PALADIN_SWIVEL);
    expect(PALADIN_SWIVEL).toBeLessThanOrEqual(0.3);
    expect(turretReach(UNIT_RIGS.hum_tank!())).toBe(Infinity);
    expect(MAX_STEER).toBeLessThanOrEqual(0.3);
  });
});
