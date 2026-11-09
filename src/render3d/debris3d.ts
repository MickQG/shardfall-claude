import * as THREE from 'three';
import { Rng } from './fx3d';

/**
 * Debris (R3D-27): a destroyed vehicle or building throws a few chunks that arc under gravity, tumble, bounce once or
 * twice on the ground, settle, then shrink and sink away within about 3.5 seconds. The chunks are a pooled set of
 * instanced meshes, one draw per chunk shape, capped at a fixed number; when the pool is full the oldest chunk is reused.
 * The throws are seeded by the unit's id. A tiny CPU step moves the few live chunks; nothing is allocated per frame.
 * Render only: the simulation never sees any of it.
 */

/** Pool sizes: High about 96 chunks, Low a quarter of that. */
export const DEBRIS_CAP = { high: 96, low: 24 } as const;

/** What threw the debris: metal chunks and plates, or the chitin shards of an organic body. */
export type DebrisKind = 'vehicle' | 'building' | 'organic';

/** Shapes: three rough lumps, a flat plate, a long shard. */
const SHAPES = 5;
const SHARD = 4;
const PLATE = 3;

const GRAVITY = 15;
const RESTITUTION = 0.36;
const FRICTION = 0.6;
/** The most a chunk can bounce before it must lie still. */
const MAX_BOUNCES = 2;
const LIFE_MIN = 3000;
const LIFE_MAX = 3600;
/** How long a chunk takes to shrink and sink at the end of its life, ms. */
const SINK_MS = 900;

/** One pooled chunk: preallocated and reused. */
export interface Chunk {
  active: boolean;
  shape: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  wx: number;
  wy: number;
  wz: number;
  /** Size in tiles, which is also how high its centre rests above the ground. */
  scale: number;
  born: number;
  life: number;
  bounces: number;
  settled: boolean;
  color: number;
}

export function newChunk(): Chunk {
  return { active: false, shape: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, scale: 0.1, born: 0, life: 1, bounces: 0, settled: false, color: 0xffffff };
}

/** How many chunks a death throws: a vehicle 4 to 7, a building 8 to 14 growing with its size (tiles across), shards 4 to 6. */
export function chunkCount(kind: DebrisKind, seed: number, size: number): number {
  const h = Math.abs(Math.imul(seed | 0, 2654435761) >>> 16);
  if (kind === 'vehicle') return 4 + (h % 4);
  if (kind === 'organic') return 4 + (h % 3);
  const base = 8 + Math.max(0, Math.min(5, Math.round((size - 2) * 1.5)));
  return Math.min(14, base + (h % 2));
}

/** Advance one chunk by `dt` seconds over ground at height `groundY`: ballistic flight, damped bounces, then it lies still. */
export function stepChunk(c: Chunk, dt: number, groundY: number): void {
  if (c.settled) return;
  c.vy -= GRAVITY * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  c.z += c.vz * dt;
  c.rx += c.wx * dt;
  c.ry += c.wy * dt;
  c.rz += c.wz * dt;
  const rest = groundY + c.scale * 0.4;
  if (c.y <= rest && c.vy < 0) {
    c.y = rest;
    c.bounces++;
    c.vy = -c.vy * RESTITUTION;
    c.vx *= FRICTION;
    c.vz *= FRICTION;
    c.wx *= FRICTION;
    c.wy *= FRICTION;
    c.wz *= FRICTION;
    if (c.bounces > MAX_BOUNCES || c.vy < 0.7) {
      c.settled = true;
      c.vx = c.vy = c.vz = c.wx = c.wy = c.wz = 0;
    }
  }
}

/** How much of its size a chunk still has `age` ms into a life of `life` ms: whole, then shrinking away at the end. */
export function chunkVisible(age: number, life: number): number {
  const k = (life - age) / SINK_MS;
  return k >= 1 ? 1 : k <= 0 ? 0 : k * k * (3 - 2 * k);
}

/** Seeded lumpy copy of a shape: each vertex moves by an amount hashed from its place, so shared corners stay together. */
function rough(g: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const key = (Math.round(x * 64) * 73856093) ^ (Math.round(y * 64) * 19349663) ^ (Math.round(z * 64) * 83492791) ^ seed;
    const r = new Rng(key);
    p.setXYZ(i, x * (1 + r.range(-amount, amount)), y * (1 + r.range(-amount, amount)), z * (1 + r.range(-amount, amount)));
  }
  g.computeVertexNormals();
  return g;
}

function shapeGeometry(i: number): THREE.BufferGeometry {
  if (i === 0) return rough(new THREE.IcosahedronGeometry(0.5, 0), 0.3, 11);
  if (i === 1) return rough(new THREE.BoxGeometry(0.8, 0.6, 0.7), 0.28, 23);
  if (i === 2) return rough(new THREE.TetrahedronGeometry(0.62, 0), 0.25, 37);
  if (i === PLATE) return rough(new THREE.BoxGeometry(1, 0.12, 0.7), 0.2, 41);
  const shard = new THREE.ConeGeometry(0.2, 1.1, 4, 1);
  shard.rotateZ(Math.PI / 2);
  return rough(shard, 0.18, 53);
}

const DARK = 0x2b2d31;

export class Debris {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.3, flatShading: true });
  /** Ground height under a point; the view sets it. */
  groundAt: (x: number, z: number) => number = () => 0;
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly chunks: Chunk[] = [];
  private cap: number = DEBRIS_CAP.high;
  private next = 0;
  private live = 0;
  private spawned = 0;
  private readonly counts = new Int32Array(SHAPES);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    for (let i = 0; i < DEBRIS_CAP.high; i++) this.chunks.push(newChunk());
    for (let i = 0; i < SHAPES; i++) {
      const mesh = new THREE.InstancedMesh(shapeGeometry(i), this.material, DEBRIS_CAP.high);
      mesh.setColorAt(0, this.c.setHex(0xffffff));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.meshes.push(mesh);
      this.root.add(mesh);
    }
  }

  /** The pool size for a quality preset (Low throws fewer chunks). */
  setQuality(rich: boolean): void {
    const cap = rich ? DEBRIS_CAP.high : DEBRIS_CAP.low;
    if (cap === this.cap) return;
    this.cap = cap;
    this.next %= cap;
    for (let i = cap; i < this.chunks.length; i++) this.chunks[i]!.active = false;
  }

  /** Chunks flying, bouncing or lying about now. */
  get active(): number {
    return this.live;
  }

  /** Chunks thrown since the start. */
  get thrown(): number {
    return this.spawned;
  }

  get capacity(): number {
    return this.cap;
  }

  /** Show one chunk of each shape so their programs compile before the first death, or put things back. */
  warm(on: boolean): void {
    for (const m of this.meshes) m.count = on ? 1 : 0;
    if (on) {
      this.p.set(0, -50, 0);
      this.m.compose(this.p, this.q.identity(), this.s.set(0.1, 0.1, 0.1));
      for (const m of this.meshes) m.setMatrixAt(0, this.m);
    }
  }

  /**
   * Throw the debris of a death at `at` (ground position), seeded by the unit's `seed` (R3D-27). `size` is the body's
   * radius for a vehicle or its width in tiles for a building; `color` is the team colour that tints some of the chunks.
   */
  spawn(kind: DebrisKind, at: { x: number; y: number; z: number }, seed: number, size: number, color: number, now: number): void {
    if (this.cap <= 0) return;
    const r = new Rng(Math.imul(seed | 0, 2654435761) ^ 0x5bd1e995);
    const n = chunkCount(kind, seed, size);
    const big = kind === 'building';
    const team = this.c.setHex(color).multiplyScalar(0.55).getHex();
    for (let i = 0; i < n; i++) {
      const c = this.chunks[this.next]!;
      this.next = (this.next + 1) % this.cap;
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(1.3, 3.2) * (big ? 1.15 : 1);
      c.active = true;
      c.shape = kind === 'organic' ? (i % 3 === 0 ? 0 : SHARD) : i % 4 === 3 ? PLATE : i % 3;
      const spread = big ? size * 0.3 : size * 0.4;
      c.x = at.x + Math.cos(a) * r.range(0, spread);
      c.z = at.z + Math.sin(a) * r.range(0, spread);
      c.y = at.y + (big ? 0.5 : 0.3) + r.range(0, 0.2);
      c.vx = Math.cos(a) * sp;
      c.vz = Math.sin(a) * sp;
      c.vy = r.range(4, 7.2);
      c.rx = r.range(0, 6.28);
      c.ry = r.range(0, 6.28);
      c.rz = r.range(0, 6.28);
      c.wx = r.range(-9, 9);
      c.wy = r.range(-9, 9);
      c.wz = r.range(-9, 9);
      c.scale = big ? r.range(0.16, 0.34) : kind === 'organic' ? r.range(0.12, 0.24) : r.range(0.1, 0.22);
      c.born = now;
      c.life = r.range(LIFE_MIN, LIFE_MAX);
      c.bounces = 0;
      c.settled = false;
      c.color = kind === 'organic' ? (i % 2 ? 0x3d2a45 : 0x6b5a3a) : i % 2 ? team : DARK;
      this.spawned++;
    }
  }

  /** Move the live chunks and write their transforms; hides what has sunk away. */
  update(now: number, dt: number): void {
    const step = Math.min(dt, 0.05);
    this.counts.fill(0);
    let live = 0;
    for (let i = 0; i < this.cap; i++) {
      const c = this.chunks[i]!;
      if (!c.active) continue;
      const age = now - c.born;
      if (age >= c.life) {
        c.active = false;
        continue;
      }
      live++;
      if (!c.settled) stepChunk(c, step, this.groundAt(c.x, c.z));
      const k = chunkVisible(age, c.life);
      const j = this.counts[c.shape]!++;
      const mesh = this.meshes[c.shape]!;
      // Sinking as it shrinks, so nothing pops away.
      this.p.set(c.x, c.y - (1 - k) * c.scale * 0.4, c.z);
      this.q.setFromEuler(this.e.set(c.rx, c.ry, c.rz));
      this.m.compose(this.p, this.q, this.s.setScalar(c.scale * k));
      mesh.setMatrixAt(j, this.m);
      mesh.setColorAt(j, this.c.setHex(c.color));
    }
    this.live = live;
    for (let i = 0; i < SHAPES; i++) {
      const mesh = this.meshes[i]!;
      mesh.count = this.counts[i]!;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
