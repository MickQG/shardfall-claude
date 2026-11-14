import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { angleDiff, bodyPose, gunYaw, readyToFire, restingMotion, turretOnBody, walkerFacing } from '../../src/render3d/motion';
import { MAX_STEER, poseRig, rigTree, turretReach, walk, type RigDef, type RigPose, type RigTree } from '../../src/render3d/rig';
import type { Shape } from '../../src/render3d/kit';
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

/** Every pose AIM-2 and AIM-4 check a unit in: aiming all round, a full stride, steering, leaning, recoiling, lunging, kneeling, unloading. */
export function aimPoses(def: RigDef): [string, RigPose][] {
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
    // The new harvesting and gun motions (R3D-30..32): head lowered and chewing, limbs reaching, a wave, barrel raised.
    ['head down', { ...STILL, walker, head: 1, time: 100, drum: 1 }],
    ['feeding', { ...STILL, walker, feed: 1, time: 450 }],
    ['feeding, other beat', { ...STILL, walker, feed: 1, time: 150 }],
    ['unload wave', { ...STILL, walker, tip: 1, time: 600 }],
    ['barrel raised', { ...STILL, walker, elev: 1 }],
    ['barrel raised and firing', { ...STILL, walker, elev: 1, kick: 1, turret: 1.2 }],
    ['turning', { ...STILL, walker, turnRate: 3, turned: 2, dist: 1 }],
    ['lean forward', { ...STILL, walker, pitch: hero ? 0.16 : lean, bob: hero ? -0.07 : 0 }],
    ['lean back', { ...STILL, walker, pitch: hero ? -0.16 : -lean, bob: hero ? -0.07 : 0 }],
    ['roll', { ...STILL, walker, roll: walker ? 0.012 : 0.1 }],
    ['walk and fire', { ...STILL, walker, phase: 1, stride: 1, dist: 1, kick: 1, pitch: hero ? 0.2 : lean }],
  );
  return poses;
}

/** The claw blow of a creature that has one (the Brute, R3D-37) with either arm, from the wind-up through contact to the recovery, standing and mid-stride. */
export function strikePoses(def: RigDef): [string, RigPose][] {
  if (!rigTree(def).anims.some((a) => a.anim.k === 'torso')) return [];
  const poses: [string, RigPose][] = [];
  for (const side of [1, -1] as const) {
    for (const t of [0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 0.95]) {
      poses.push([`strike ${side > 0 ? 'right' : 'left'} arm at ${t}`, { ...STILL, walker: def.move === 'walker', strike: t, strikeSide: side }]);
      poses.push([`strike ${side > 0 ? 'right' : 'left'} arm at ${t} mid-stride`, { ...STILL, walker: def.move === 'walker', strike: t, strikeSide: side, phase: 1.3, stride: 1, dist: 1.3 }]);
    }
  }
  return poses;
}

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
      const poses = [...aimPoses(def), ...strikePoses(def)];
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

describe('models do not come apart', () => {
  /** How finely surfaces are sampled, model units: points of two surfaces are compared, so a measured gap overstates the true one by up to about this. */
  const SPACING = 0.012;

  /** Points spread over every triangle of a shape (corners, edges and an interior grid no coarser than SPACING), in the shape's own frame. */
  function surface(shape: Shape): Float32Array {
    const out: number[] = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    for (const piece of shape.pieces) {
      const pos = piece.geo.getAttribute('position');
      const idx = piece.geo.getIndex();
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const at = (k: number): number => (idx ? idx.getX(i + k) : i + k);
        a.fromBufferAttribute(pos, at(0));
        b.fromBufferAttribute(pos, at(1));
        c.fromBufferAttribute(pos, at(2));
        const steps = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / SPACING));
        for (let u = 0; u <= steps; u++) {
          for (let v = 0; u + v <= steps; v++) {
            const wa = (steps - u - v) / steps;
            out.push(a.x * wa + b.x * (u / steps) + c.x * (v / steps), a.y * wa + b.y * (u / steps) + c.y * (v / steps), a.z * wa + b.z * (u / steps) + c.z * (v / steps));
          }
        }
      }
    }
    return Float32Array.from(out);
  }

  /**
   * The parts of a posed model that are not joined to its body (empty when it is one connected piece). Two parts are joined
   * when some point of one's surface lies within `gap` tiles of a point on the other's. Starting from the body, parts are
   * added as they touch one already reached; a part never reached is apart. Points are compared through a grid of cells `gap`
   * wide, so every pair within `gap` is found. Sampling can only overstate a gap, never hide one: a join that is found is real
   * to within `gap`, and a gap wider than `gap` plus the sampling spacing is always reported.
   */
  function apart(def: RigDef, t: RigTree, samples: Map<string, Float32Array>, pose: RigPose, gap: number): string[] {
    poseRig(t, pose);
    t.root.updateMatrixWorld(true);
    const ps = t.drawn.filter((d) => !d.cargo);
    const g = gap / (def.scale ?? 1);
    const g2 = g * g;
    const v = new THREE.Vector3();
    const boxes: THREE.Box3[] = [];
    const world = ps.map((d) => {
      const src = samples.get(d.geo)!;
      const w = new Float32Array(src.length);
      const box = new THREE.Box3();
      for (let k = 0; k < src.length; k += 3) {
        v.set(src[k]!, src[k + 1]!, src[k + 2]!).applyMatrix4(d.obj.matrixWorld);
        w[k] = v.x;
        w[k + 1] = v.y;
        w[k + 2] = v.z;
        box.expandByPoint(v);
      }
      boxes.push(box.expandByScalar(g));
      return w;
    });
    // A hash of the integer cell; a clash only adds a candidate, and every candidate is measured.
    const hash = (x: number, y: number, z: number): number => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    const grids = new Map<number, Map<number, number[]>>();
    const grid = (i: number): Map<number, number[]> => {
      let m = grids.get(i);
      if (!m) {
        m = new Map();
        const w = world[i]!;
        for (let k = 0; k < w.length; k += 3) {
          const h = hash(Math.floor(w[k]! / g), Math.floor(w[k + 1]! / g), Math.floor(w[k + 2]! / g));
          const c = m.get(h);
          if (c) c.push(k);
          else m.set(h, [k]);
        }
        grids.set(i, m);
      }
      return m;
    };
    /** Whether any point of part `a` lies within `gap` of a point of part `b`. */
    const touch = (a: number, b: number): boolean => {
      if (!boxes[a]!.intersectsBox(boxes[b]!)) return false;
      const wa = world[a]!;
      const wb = world[b]!;
      const m = grid(b);
      for (let k = 0; k < wa.length; k += 3) {
        const x = wa[k]!;
        const y = wa[k + 1]!;
        const z = wa[k + 2]!;
        const cx = Math.floor(x / g);
        const cy = Math.floor(y / g);
        const cz = Math.floor(z / g);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const c = m.get(hash(cx + dx, cy + dy, cz + dz));
              if (!c) continue;
              for (const q of c) {
                const ex = wb[q]! - x;
                const ey = wb[q + 1]! - y;
                const ez = wb[q + 2]! - z;
                if (ex * ex + ey * ey + ez * ez <= g2) return true;
              }
            }
      }
      return false;
    };
    const main = ps.findIndex((d) => d.geo === 'body' || d.geo === 'hull');
    const reached = new Set<number>([Math.max(0, main)]);
    for (let grew = true; grew; ) {
      grew = false;
      for (let u = 0; u < ps.length; u++) {
        if (reached.has(u)) continue;
        for (const r of reached) {
          if (touch(u, r)) {
            reached.add(u);
            grew = true;
            break;
          }
        }
      }
    }
    return ps.flatMap((d, i) => (reached.has(i) ? [] : [d.geo]));
  }

  /** Parts that float free of the body by design, per unit kind, with the reason: none today. */
  const FLOATING: Record<string, readonly string[]> = {};
  /** Walkers that come apart in some pose and are not repaired here, with the reason (to be filed separately): none today. */
  const KNOWN: Record<string, string> = {};

  it('AIM-4: on every walking unit, in every pose and every attack pose, each limb meets the next and the body (no gap over 0.03 tiles)', () => {
    const problems: string[] = [];
    let walkers = 0;
    for (const [kind, mk] of Object.entries(UNIT_RIGS)) {
      const def = mk();
      if (def.move !== 'walker') continue;
      walkers++;
      const t = rigTree(def);
      const samples = new Map<string, Float32Array>();
      for (const d of t.drawn) if (!samples.has(d.geo)) samples.set(d.geo, surface(def.shapes[d.geo]!()));
      const found = new Set<string>();
      for (const [name, pose] of [...aimPoses(def), ...strikePoses(def)]) {
        for (const geo of apart(def, t, samples, pose, 0.03)) if (!(FLOATING[kind] ?? []).includes(geo)) found.add(`${geo} (${name})`);
      }
      if (found.size > 0 && !KNOWN[kind]) problems.push(`${kind}: ${[...found].slice(0, 6).join(', ')}${found.size > 6 ? ` and ${found.size - 6} more` : ''}`);
    }
    expect(walkers).toBeGreaterThanOrEqual(8);
    expect(problems).toEqual([]);
  }, 300_000);
});
