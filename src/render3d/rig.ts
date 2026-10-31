import * as THREE from 'three';
import type { Shape, V3 } from './kit';

/**
 * A rig is a model split into named, separately moving parts (R3D-3, R3D-10): a tree of nodes, each optionally drawn
 * with one of the model's shapes and optionally animated. Muzzle nodes mark where shots leave the weapon (R3D-9).
 * Forward is +X, up is +Y; one tile is one unit; the origin is the model's ground centre.
 */

export type Axis = 'x' | 'y' | 'z';

export type Anim =
  /** Takes the hull's pitch, roll, bob and lunge; sinks by `drop` when kneeling. */
  | { k: 'body'; drop?: number }
  /** Turns toward the aim, relative to the hull. */
  | { k: 'turret' }
  /** Recoils backwards along its own -X when firing. */
  | { k: 'barrel'; recoil: number }
  /** Rolls with the distance travelled (axle along Z). */
  | { k: 'wheel'; r: number }
  /** Front wheels: yaw with the hull's turning. */
  | { k: 'steer' }
  /** Legs: swing about `axis` with the gait phase, lifting by `lift` on the forward stroke; kneeling turns the leg by
   * `kneel` and lowers its hip by `drop`. */
  | { k: 'gait'; axis: Axis; amp: number; phase: number; lift?: number; kneel?: number; drop?: number }
  /** Rotors, radar dishes: spin with time. */
  | { k: 'spin'; axis: Axis; rate: number }
  /** Wings: beat with time. */
  | { k: 'flap'; axis: Axis; amp: number; rate: number; phase?: number }
  /** Organic structures: breathe (scale) with time. */
  | { k: 'breathe'; amp: number; rate: number }
  /** Shown only while the unit carries shards. */
  /** Carried shards: a pile that rises from `pivot` (or, `swell`, a belly that swells) with the load (R3D-19). */
  | { k: 'cargo'; pivot?: [number, number, number]; swell?: boolean };

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
export type WeaponLook = 'rifle' | 'mg' | 'cannon' | 'rocket' | 'howitzer' | 'chaingun' | 'pulse' | 'claw' | 'acid' | 'acidBig' | 'sting' | 'spine';

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
}

/** A live copy of a rig: plain groups (never added to a scene) whose world matrices place the drawn parts. */
export interface RigTree {
  root: THREE.Group;
  drawn: DrawnNode[];
  anims: AnimatedNode[];
  muzzles: THREE.Object3D[];
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
    if (n.anim) anims.push({ obj: o, anim: n.anim, pos: o.position.clone(), rot: o.rotation.clone() });
    if (n.muzzle) muzzles.push(o);
    for (const k of n.kids ?? []) o.add(make(k, inCargo));
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
}

/** Pose every animated node of a rig. Pure apart from writing the nodes' transforms. */
export function poseRig(tree: RigTree, p: RigPose): void {
  for (const a of tree.anims) {
    const an = a.anim;
    const obj = a.obj;
    switch (an.k) {
      case 'body':
        obj.position.set(a.pos.x + p.lunge * p.reach - p.kick * 0.01, a.pos.y + p.bob - (p.crouch ?? 0) * (an.drop ?? 0), a.pos.z);
        obj.rotation.set(a.rot.x + p.roll, a.rot.y, a.rot.z + p.pitch - p.kick * (p.walker ? 0 : 0.03) - p.lunge * 0.15);
        break;
      case 'turret':
        obj.rotation.y = a.rot.y - p.turret;
        break;
      case 'barrel':
        obj.position.x = a.pos.x - an.recoil * p.kick;
        break;
      case 'wheel':
        // Each side rolls its own distance: turning on the spot, the inside wheels run backwards (R3D-10).
        obj.rotation.z = a.rot.z - (p.dist - (p.turned ?? 0) * a.pos.z) / an.r;
        break;
      case 'steer':
        obj.rotation.y = a.rot.y - Math.max(-0.45, Math.min(0.45, p.turnRate * 0.3));
        break;
      case 'gait': {
        const c = p.crouch ?? 0;
        obj.rotation[an.axis] = a.rot[an.axis] + Math.sin(p.phase + an.phase) * an.amp * p.stride + c * (an.kneel ?? 0);
        if (an.lift || an.drop) obj.position.y = a.pos.y + (an.lift ?? 0) * Math.max(0, Math.cos(p.phase + an.phase)) * p.stride - c * (an.drop ?? 0);
        break;
      }
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
        const sxz = an.swell ? 0.55 + 0.45 * f : 0.7 + 0.3 * f;
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
