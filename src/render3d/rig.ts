import * as THREE from 'three';
import type { Shape, V3 } from './kit';
import type { WalkStyle } from './motion';

/**
 * A rig is a model split into named, separately moving parts (R3D-3, R3D-10): a tree of nodes, each optionally drawn
 * with one of the model's shapes and optionally animated. Muzzle nodes mark where shots leave the weapon (R3D-9).
 * Forward is +X, up is +Y; one tile is one unit; the origin is the model's ground centre.
 */

export type Axis = 'x' | 'y' | 'z';

export type Anim =
  /** Takes the hull's pitch, roll, bob and lunge; sinks by `drop` when kneeling. */
  | { k: 'body'; drop?: number }
  /** Turns toward the aim, relative to the hull; a swivel mount turns at most `max` radians either way (AIM-2). */
  | { k: 'turret'; max?: number }
  /** Recoils backwards along its own -X when firing. */
  | { k: 'barrel'; recoil: number }
  /** Rolls with the distance travelled (axle along Z). */
  | { k: 'wheel'; r: number }
  /** Front wheels: yaw with the hull's turning. */
  | { k: 'steer' }
  /** Legs: swing about `axis` with the gait phase, lifting by `lift` on the forward stroke; kneeling turns the leg by
   * `kneel` and lowers its hip by `drop`. */
  | { k: 'gait'; axis: Axis; amp: number; phase: number; lift?: number; kneel?: number; drop?: number; ease?: boolean }
  /**
   * A jointed leg that plants its foot (HERO-6): the node is the hip and draws the thigh, its first kid (at the knee)
   * the shin, and that kid's first kid (at the ankle) the foot. `knee` is the knee's rest offset from the hip and `ankle`
   * the ankle's from the knee, in the leg's own X-Y plane; `sole` is how far the foot reaches below the ankle. The foot
   * is planted for half the cycle, moving back `reach` either side of its stance (`fore` ahead of the ankle's rest) exactly as fast as the walker travels,
   * then swings forward lifted by `lift`; two-bone IK poses thigh and shin, and the foot stays level. The hip rides up
   * and down with the hull. The node may splay about X; its rest turn about Z is not used.
   */
  | { k: 'step'; phase: number; fore?: number; reach: number; lift: number; knee: readonly [number, number]; ankle: readonly [number, number]; sole: number }
  /** A missile pod: tilts its mouth up by `open` radians as the pod opens (HERO-7). */
  | { k: 'pod'; open: number }
  /** Rotors, radar dishes: spin with time. */
  | { k: 'spin'; axis: Axis; rate: number }
  /** Wings: beat with time. */
  | { k: 'flap'; axis: Axis; amp: number; rate: number; phase?: number }
  /** Organic structures: breathe (scale) with time. */
  | { k: 'breathe'; amp: number; rate: number }
  /** Shown only while the unit carries shards. */
  /** Carried shards: a pile that rises from `pivot` (or, `swell`, a belly that swells) with the load (R3D-19). */
  | { k: 'cargo'; pivot?: [number, number, number]; swell?: boolean }
  /** A tipping bed: raised about the hinge at `pivot` by up to `max` radians while unloading (R3D-19). */
  | { k: 'tip'; pivot: [number, number, number]; max: number }
  /** A cutter drum: turns while mining (R3D-19). */
  | { k: 'drum' };

export interface RigNode {
  /** Shape key drawn at this node. */
  geo?: string;
  at?: V3;
  rot?: V3;
  anim?: Anim;
  /** A muzzle point: where shots leave (no geometry). */
  muzzle?: boolean;
  kids?: RigNode[];
}

export type Locomotion = 'tracked' | 'wheeled' | 'walker' | 'air' | 'static';

/** How a weapon looks when it fires (chosen by the shooter's kind). */
export type WeaponLook = 'rifle' | 'mg' | 'cannon' | 'heroCannon' | 'rocket' | 'howitzer' | 'chaingun' | 'pulse' | 'claw' | 'acid' | 'acidBig' | 'heroAcid' | 'missile' | 'sting' | 'spine';

export interface RigDef {
  shapes: Record<string, () => Shape>;
  root: RigNode;
  move: Locomotion;
  /** Uniform model scale (small units are drawn a little larger so they read at RTS zoom). */
  scale?: number;
  /** Selection ring radius, tiles. */
  radius: number;
  /** Model height for health bars, tiles (before `scale`). */
  height: number;
  /** Tiles per full gait cycle (walkers). */
  stride?: number;
  /** Hull turn rate, radians per second. */
  turn?: number;
  /** A walker's own hull bob and sway with its steps and how gently its walk starts and stops (HERO-6). */
  walk?: WalkStyle;
  /** Shiny chitin instead of painted metal. */
  organic?: boolean;
  weapon?: WeaponLook;
  /** Smoke and steam vents (buildings), local positions. */
  vents?: readonly V3[];
}

/** Every node of a rig, depth first. */
export function walk(n: RigNode, f: (n: RigNode) => void): void {
  f(n);
  for (const k of n.kids ?? []) walk(k, f);
}

/** Muzzle count of a rig. */
export function muzzleCount(def: RigDef): number {
  let n = 0;
  walk(def.root, (x) => {
    if (x.muzzle) n++;
  });
  return n;
}

/** A node of a live rig that is drawn with one of the model's shapes. */
export interface DrawnNode {
  obj: THREE.Object3D;
  geo: string;
  /** Under a cargo node: drawn only while carrying. */
  cargo: boolean;
}

/** An animated node with its rest position and rotation. */
export interface AnimatedNode {
  obj: THREE.Object3D;
  anim: Anim;
  pos: THREE.Vector3;
  rot: THREE.Euler;
  /** A stepping leg's shin and foot (HERO-6). */
  links?: readonly THREE.Object3D[];
}

/** A live copy of a rig: plain groups (never added to a scene) whose world matrices place the drawn parts. */
export interface RigTree {
  root: THREE.Group;
  drawn: DrawnNode[];
  anims: AnimatedNode[];
  muzzles: THREE.Object3D[];
}

/** How far a rig's turret can swivel either way, radians: Infinity for a full turret, 0 for none (AIM-1). */
export function turretReach(def: RigDef): number {
  let reach = 0;
  walk(def.root, (n) => {
    if (n.anim?.k === 'turret') reach = Math.max(reach, n.anim.max ?? Infinity);
  });
  return reach;
}

export function rigTree(def: RigDef): RigTree {
  const drawn: DrawnNode[] = [];
  const anims: AnimatedNode[] = [];
  const muzzles: THREE.Object3D[] = [];
  const make = (n: RigNode, cargo: boolean): THREE.Object3D => {
    const o = new THREE.Group();
    if (n.at) o.position.set(...n.at);
    if (n.rot) o.rotation.set(...n.rot);
    const inCargo = cargo || n.anim?.k === 'cargo';
    if (n.geo) drawn.push({ obj: o, geo: n.geo, cargo: inCargo });
    const animated: AnimatedNode | null = n.anim ? { obj: o, anim: n.anim, pos: o.position.clone(), rot: o.rotation.clone() } : null;
    if (animated) anims.push(animated);
    if (n.muzzle) muzzles.push(o);
    for (const k of n.kids ?? []) o.add(make(k, inCargo));
    if (animated?.anim.k === 'step') {
      const shin = o.children[0]!;
      const foot = shin.children[0]!;
      // The foot turns back by the leg's splay last, so it can sit level whatever the leg does.
      foot.rotation.order = 'ZYX';
      animated.links = [shin, foot];
    }
    return o;
  };
  return { root: make(def.root, false) as THREE.Group, drawn, anims, muzzles };
}

/** Everything that moves a rig's parts in one frame (R3D-9, R3D-10). Angles in radians, times in ms. */
export interface RigPose {
  /** Turret yaw relative to the hull. */
  turret: number;
  /** Recoil 0..1 (1 = fully back). */
  kick: number;
  /** Melee lunge 0..1. */
  lunge: number;
  /** Body pitch, roll and lift from the motion model. */
  pitch: number;
  roll: number;
  bob: number;
  /** Gait phase, how far into a stride (0 standing, 1 walking), distance travelled (tiles) and turn rate. */
  phase: number;
  stride: number;
  dist: number;
  turnRate: number;
  /** Clock for rotors, wings and breathing. */
  time: number;
  /** How far a lunge throws the body forward, tiles. */
  reach: number;
  walker: boolean;
  /** Kneeling, 0..1 (squad members firing, R3D-15). */
  crouch?: number;
  /** Total turning of the hull, radians, for the wheels on each side. */
  turned?: number;
  /** How full a harvester is, 0..1 (R3D-19); full when absent. */
  load?: number;
  /** Unloading, 0..1: how far the bed is tipped, or how hard a belly squeezes (R3D-19). */
  tip?: number;
  /** The cutter drum's angle, radians (R3D-19). */
  drum?: number;
  /** How far the missile pods are open, 0..1 (HERO-7). */
  pod?: number;
}

/** Pose every animated node of a rig. Pure apart from writing the nodes' transforms. */
/**
 * Set one rotation axis only when it changes (PERF-1): every write makes three.js rebuild the node's quaternion, and many
 * parts (idle legs, parked turrets) hold still from frame to frame.
 */
function turn(obj: THREE.Object3D, axis: 'x' | 'y' | 'z', v: number): void {
  if (obj.rotation[axis] !== v) obj.rotation[axis] = v;
}

/**
 * How high a foot is lifted through its stride, 0..1: up on the forward swing, planted on the back stroke. Eased lifts
 * rise and set down gently (the square of the plain curve), so a heavy walker never jerks at touch-down (HERO-1).
 */
export function footLift(phase: number, ease: boolean): number {
  const up = Math.max(0, Math.cos(phase));
  return ease ? up * up : up;
}

/** 0 to 1 with zero slope at both ends: a walk fades in and out gently rather than at a constant rate (HERO-6). */
export const smoothstep = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * Where a stepping foot is through its cycle at phase `u` (HERO-6): `fore` from the hip, in units of the leg's reach
 * (+1 front, -1 back), and `lift` 0..1. Planted while cos(u) <= 0, it moves back from +1 to -1 at a constant rate, so
 * it stays put on the ground as the body passes over it; then it swings forward on a curve whose speed matches the
 * stance at both ends (a cubic Hermite), lifting with the eased `footLift`, so it leaves and meets the ground smoothly.
 */
export function stepPath(u: number): { fore: number; lift: number } {
  const TAU = Math.PI * 2;
  // s runs 0..1 over the swing (u from -pi/2 to pi/2), then 1..2 over the stance.
  const s = ((((u + Math.PI / 2) % TAU) + TAU) % TAU) / Math.PI;
  if (s >= 1) return { fore: 1 - 2 * (s - 1), lift: 0 };
  // Positions -1 and +1, both end slopes -2 (the stance's own speed).
  const fore = -8 * s ** 3 + 12 * s ** 2 - 2 * s - 1;
  return { fore, lift: footLift(u, true) };
}

/**
 * Two-bone IK in a plane (HERO-6): with the hip at the origin, the knee of a thigh `l1` long and a shin `l2` long that
 * puts the ankle at (`tx`, `ty`), bending back (the knee behind the line from hip to ankle, to -X when the foot hangs
 * below). An ankle out of reach is drawn in to it.
 */
export function kneeFor(l1: number, l2: number, tx: number, ty: number): [number, number] {
  const d = Math.max(Math.abs(l1 - l2) + 1e-6, Math.min(l1 + l2 - 1e-6, Math.hypot(tx, ty)));
  const a = Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const th = Math.atan2(ty, tx) - a;
  return [l1 * Math.cos(th), l1 * Math.sin(th)];
}

/** How far front wheels steer either way, radians: clear of the body and mudguards (AIM-2). */
export const MAX_STEER = 0.3;

export function poseRig(tree: RigTree, p: RigPose): void {
  for (const a of tree.anims) {
    const an = a.anim;
    const obj = a.obj;
    switch (an.k) {
      case 'body':
        obj.position.set(a.pos.x + p.lunge * p.reach - p.kick * 0.01, a.pos.y + p.bob - (p.crouch ?? 0) * (an.drop ?? 0), a.pos.z);
        {
          const rx = a.rot.x + p.roll;
          const rz = a.rot.z + p.pitch - p.kick * (p.walker ? 0 : 0.03) - p.lunge * 0.15;
          const r = obj.rotation;
          if (r.x !== rx || r.y !== a.rot.y || r.z !== rz) r.set(rx, a.rot.y, rz);
        }
        break;
      case 'turret':
        turn(obj, 'y', a.rot.y - (an.max === undefined ? p.turret : Math.max(-an.max, Math.min(an.max, p.turret))));
        break;
      case 'pod':
        turn(obj, 'z', a.rot.z + an.open * (p.pod ?? 0));
        break;
      case 'barrel':
        obj.position.x = a.pos.x - an.recoil * p.kick;
        break;
      case 'wheel':
        // Each side rolls its own distance: turning on the spot, the inside wheels run backwards (R3D-10).
        turn(obj, 'z', a.rot.z - (p.dist - (p.turned ?? 0) * a.pos.z) / an.r);
        break;
      case 'steer':
        turn(obj, 'y', a.rot.y - Math.max(-MAX_STEER, Math.min(MAX_STEER, p.turnRate * 0.3)));
        break;
      case 'gait': {
        const c = p.crouch ?? 0;
        turn(obj, an.axis, a.rot[an.axis] + Math.sin(p.phase + an.phase) * an.amp * p.stride + c * (an.kneel ?? 0));
        if (an.lift || an.drop) obj.position.y = a.pos.y + (an.lift ?? 0) * footLift(p.phase + an.phase, !!an.ease) * p.stride - c * (an.drop ?? 0);
        break;
      }
      case 'step': {
        const [shin, foot] = a.links!;
        const e = smoothstep(p.stride);
        const { fore, lift } = stepPath(p.phase + an.phase);
        const hipY = a.pos.y + p.bob;
        const splay = a.rot.x;
        // The ankle's target in the leg's plane: under the hip, moved fore and aft, at the height that sets the sole on
        // the ground (or lifted); the plane is tilted by the splay, so heights stretch by 1 / cos(splay).
        const rx = an.knee[0] + an.ankle[0] + (an.fore ?? 0);
        const tx = rx + an.reach * fore * e;
        const ty = -(hipY - an.sole - an.lift * lift * e) / Math.cos(splay);
        const l1 = Math.hypot(an.knee[0], an.knee[1]);
        const l2 = Math.hypot(an.ankle[0], an.ankle[1]);
        const [kx, ky] = kneeFor(l1, l2, tx, ty);
        const thigh = Math.atan2(ky, kx) - Math.atan2(an.knee[1], an.knee[0]);
        const total = Math.atan2(ty - ky, tx - kx) - Math.atan2(an.ankle[1], an.ankle[0]);
        obj.position.y = hipY;
        turn(obj, 'z', thigh);
        turn(shin!, 'z', total - thigh);
        // Level: undo the leg's swing and its splay.
        const fr = foot!.rotation;
        if (fr.x !== -splay || fr.z !== -total) fr.set(-splay, 0, -total);
        break;
      }
      case 'tip': {
        // Rotate about the hinge: the node turns by the angle and shifts so the hinge stays put.
        const ang = (p.tip ?? 0) * an.max;
        const [hx, hy] = an.pivot;
        const c = Math.cos(ang);
        const sn = Math.sin(ang);
        turn(obj, 'z', a.rot.z + ang);
        obj.position.set(a.pos.x + hx - (hx * c - hy * sn), a.pos.y + hy - (hx * sn + hy * c), a.pos.z);
        break;
      }
      case 'drum':
        turn(obj, 'z', a.rot.z - (p.drum ?? 0));
        break;
      case 'spin':
        obj.rotation[an.axis] = a.rot[an.axis] + ((an.rate * p.time) / 1000) % (Math.PI * 2);
        break;
      case 'flap':
        obj.rotation[an.axis] = a.rot[an.axis] + an.amp * Math.sin((an.rate * p.time) / 1000 + (an.phase ?? 0));
        break;
      case 'breathe':
        obj.scale.setScalar(1 + an.amp * Math.sin((an.rate * p.time) / 1000));
        break;
      case 'cargo': {
        const f = Math.max(0, Math.min(1, p.load ?? 1));
        const [px, py, pz] = an.pivot ?? [0, 0, 0];
        // A belly squeezes rhythmically while it empties.
        const squeeze = an.swell ? 1 - 0.12 * (p.tip ?? 0) * Math.max(0, Math.sin(p.time * 0.012)) : 1;
        const sxz = (an.swell ? 0.55 + 0.45 * f : 0.7 + 0.3 * f) * squeeze;
        const sy = an.swell ? sxz : 0.15 + 0.85 * f;
        obj.scale.set(sxz, sy, sxz);
        obj.position.set(a.pos.x + px * (1 - sxz), a.pos.y + py * (1 - sy), a.pos.z + pz * (1 - sxz));
        break;
      }
    }
  }
}

/** Recoil over time since a shot: snaps back within 40 ms, then eases out. */
export const recoil = (sinceMs: number): number => (sinceMs < 0 ? 0 : sinceMs < 40 ? sinceMs / 40 : Math.exp(-(sinceMs - 40) / 110));
