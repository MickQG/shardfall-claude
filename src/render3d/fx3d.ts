import * as THREE from 'three';
import { valueNoise } from '../render/terrainNext';
import type { WeaponLook } from './rig';

/**
 * Combat and ambient effects for the 3D view (R3D-6, R3D-9, R3D-12): pooled particles (glowing and smoky), tracer and
 * projectile streaks, muzzle flashes, explosions, pooled point lights, shockwaves and scorch marks. Everything is
 * pooled: no per-shot allocations of materials or geometry. Render-side randomness is a seeded generator.
 */

export type Vec = THREE.Vector3;

interface Look {
  /** Streak colour (linear, may exceed 1 for bloom). */
  color: number;
  intensity: number;
  /** Tiles per second for straight shots; 0 = uses the simulation's flight time. */
  speed: number;
  len: number;
  width: number;
  /** Arc height as a fraction of the distance. */
  arc: number;
  flash: number;
  flashColor: number;
  smokeTrail: boolean;
  /** Impact flavour. */
  hit: 'spark' | 'blast' | 'acid' | 'slash' | 'bone';
  shake: number;
  /** Vrax weapons: bioluminescent spit, drips and wakes instead of fire and smoke (R3D-12). */
  bio?: boolean;
}

/** Vrax bioluminescence: body glow and the deep green it fades to. */
/** Brightness of shell and rocket bursts from shots, against a death's full fireball (R3D-12). */
export const SHOT_BLAST_DIM = 0.6;
const BIO = 0xa8ff3c;
const BIO_DEEP = 0x3f8a10;

/** Superweapon palettes (R3D-16): the Aegis orbital lance burns blue-white, the Vrax rift green and violet. */
const SW = {
  aegis: { core: 0xeef8ff, glow: 0x7fd0ff, deep: 0x2a5aff, fire: 0xffa040 },
  vrax: { core: 0xf0ffc0, glow: BIO, deep: 0x8a3cff, fire: 0x9dff3c },
} as const;

export const LOOKS: Record<WeaponLook, Look> = {
  rifle: { color: 0xffe2a0, intensity: 1.3, speed: 38, len: 0.26, width: 0.0065, arc: 0, flash: 0.09, flashColor: 0xffd27a, smokeTrail: false, hit: 'spark', shake: 0 },
  mg: { color: 0xffcf80, intensity: 1.35, speed: 42, len: 0.29, width: 0.008, arc: 0, flash: 0.11, flashColor: 0xffc070, smokeTrail: false, hit: 'spark', shake: 0 },
  chaingun: { color: 0xffc070, intensity: 1.5, speed: 46, len: 0.34, width: 0.009, arc: 0, flash: 0.12, flashColor: 0xffb060, smokeTrail: false, hit: 'spark', shake: 0 },
  pulse: { color: 0x80e8ff, intensity: 1.8, speed: 30, len: 0.4, width: 0.018, arc: 0, flash: 0.17, flashColor: 0x9ff0ff, smokeTrail: false, hit: 'spark', shake: 0 },
  cannon: { color: 0xffd090, intensity: 2.2, speed: 0, len: 0.26, width: 0.026, arc: 0.02, flash: 0.55, flashColor: 0xffc068, smokeTrail: false, hit: 'blast', shake: 0.04 },
  // The Paladin's twin heavy cannons (HERO-1): a long, hot shell trace, a big flash with side jets from the muzzle brakes,
  // a shock ring and a rolling cloud of gun smoke, and a heavier burst where the shell lands.
  heroCannon: { color: 0xffe2a8, intensity: 2.6, speed: 0, len: 0.42, width: 0.04, arc: 0.025, flash: 0.85, flashColor: 0xffc068, smokeTrail: true, hit: 'blast', shake: 0.07 },
  howitzer: { color: 0xffb060, intensity: 2.2, speed: 0, len: 0.22, width: 0.035, arc: 0.38, flash: 0.8, flashColor: 0xffb050, smokeTrail: true, hit: 'blast', shake: 0.08 },
  rocket: { color: 0xffa040, intensity: 2.6, speed: 0, len: 0.14, width: 0.03, arc: 0.12, flash: 0.22, flashColor: 0xffb060, smokeTrail: true, hit: 'blast', shake: 0.02 },
  claw: { color: 0xd8ffb0, intensity: 2.5, speed: 0, len: 0, width: 0.02, arc: 0, flash: 0, flashColor: 0, smokeTrail: false, hit: 'slash', shake: 0, bio: true },
  acid: { color: 0xb8ff40, intensity: 2, speed: 0, len: 0.1, width: 0.05, arc: 0.28, flash: 0.16, flashColor: 0xc8ff4a, smokeTrail: false, hit: 'acid', shake: 0, bio: true },
  acidBig: { color: 0xb8ff40, intensity: 2.4, speed: 0, len: 0.16, width: 0.09, arc: 0.45, flash: 0.35, flashColor: 0xc8ff4a, smokeTrail: false, hit: 'acid', shake: 0.05, bio: true },
  sting: { color: 0xe8ff70, intensity: 1.35, speed: 26, len: 0.2, width: 0.013, arc: 0, flash: 0.07, flashColor: 0xe0ff80, smokeTrail: false, hit: 'spark', shake: 0, bio: true },
  spine: { color: 0xf0e6cc, intensity: 1.1, speed: 22, len: 0.26, width: 0.017, arc: 0.04, flash: 0.09, flashColor: 0xb6ff5c, smokeTrail: false, hit: 'bone', shake: 0, bio: true },
};

/**
 * How long a shot is in the air (R3D-9), ms: tracers fly at their look's speed; shells, rockets and acid take exactly
 * the simulation's flight time, so they land when the damage does.
 */
export function shotDuration(look: WeaponLook, distance: number, flightMs: number): number {
  const L = LOOKS[look];
  return L.speed > 0 ? Math.max(30, (distance / L.speed) * 1000) : Math.max(80, flightMs);
}

/** Seeded generator for effect scatter (render only). */
export class Rng {
  constructor(private s = 0x9e3779b9) {}
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
}

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Lifetime, ms. */
  life: number;
  /** Size at birth and death, world units. */
  size0: number;
  size1: number;
  color0: number;
  color1?: number;
  /** Peak opacity (or brightness for glowing particles). */
  alpha: number;
  /** Velocity damping per second. */
  drag?: number;
  /** Downward acceleration, tiles per second squared (negative rises). */
  gravity?: number;
  /** Birth delay, ms. */
  delay?: number;
}

const VERT = /* glsl */ `
attribute float size;
attribute vec4 pcolor;
uniform float scale;
varying vec4 vColor;
void main() {
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec4 vColor;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A sprite texture: a soft disc, or a lumpy smoke puff (seeded). */
function puffTexture(lumpy: boolean): THREE.Texture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  const rng = new Rng(lumpy ? 7 : 3);
  const blobs = lumpy ? Array.from({ length: 7 }, () => [rng.range(0.3, 0.7), rng.range(0.3, 0.7), rng.range(0.16, 0.3)] as const) : [[0.5, 0.5, 0.5] as const];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      let a = 0;
      for (const [bx, by, br] of blobs) a = Math.max(a, 1 - Math.hypot(u - bx, v - by) / br);
      if (!lumpy) a = Math.pow(Math.max(0, a), 1.6);
      else a = Math.max(0, Math.min(1, a * 1.4)) * Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) * 2);
      const k = (y * N + x) * 4;
      data[k] = data[k + 1] = data[k + 2] = 255;
      data[k + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * A scorch mark: an uneven burnt blob that fades to nothing well inside its square (R3D-12). The value sits in every
 * channel because an alpha map reads green. `lobes` sets how uneven its edge is (acid puddles are rounder).
 */
export function scorchTexture(lobes = 0.16): THREE.DataTexture {
  const N = 64;
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N - 0.5;
      const v = (y + 0.5) / N - 0.5;
      // The outline wanders with 2D noise, so the blob is irregular without the spokes of an angular wave.
      const wobble = (valueNoise(u * 4.5 + 3, v * 4.5 + 7) - 0.5) * lobes * 1.6 + (valueNoise(u * 9 + 21, v * 9 + 5) - 0.5) * lobes * 0.5;
      const d = Math.hypot(u, v) + wobble;
      const a = Math.max(0, Math.min(1, (0.31 - d) / 0.17)) * (0.72 + 0.28 * valueNoise(u * 7 + 3, v * 7 + 11));
      const k = (y * N + x) * 4;
      const val = Math.round(Math.max(0, Math.min(1, a)) * 255);
      data[k] = data[k + 1] = data[k + 2] = data[k + 3] = val;
    }
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/** A flat unit square lying on the ground, for scorch marks and puddles. */
let groundSquare: THREE.PlaneGeometry | null = null;
const scorchGeoFor = (): THREE.PlaneGeometry => {
  if (!groundSquare) {
    groundSquare = new THREE.PlaneGeometry(1, 1);
    groundSquare.rotateX(-Math.PI / 2);
  }
  return groundSquare;
};

/** One pooled particle layer drawn as camera-facing points (glowing = additive, else alpha-blended smoke). */
class ParticleLayer {
  readonly points: THREE.Points;
  private n = 0;
  private pos: Float32Array;
  private vel: Float32Array;
  private born: Float32Array;
  private life: Float32Array;
  private size: Float32Array;
  private col: Float32Array;
  private misc: Float32Array; // alpha, drag, gravity
  private aPos: THREE.BufferAttribute;
  private aSize: THREE.BufferAttribute;
  private aCol: THREE.BufferAttribute;
  readonly material: THREE.ShaderMaterial;
  private c0 = new THREE.Color();
  private c1 = new THREE.Color();
  private overwrite = 0;

  constructor(private readonly cap: number, glow: boolean) {
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.born = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.size = new Float32Array(cap * 2);
    this.col = new Float32Array(cap * 6);
    this.misc = new Float32Array(cap * 3);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('size', this.aSize);
    g.setAttribute('pcolor', this.aCol);
    g.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture(!glow) }, scale: { value: 600 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = glow ? 6 : 5;
  }

  get count(): number {
    return this.n;
  }

  emit(p: ParticleSpec, now: number): void {
    // Full: replace the oldest-born slot (slot 0 after compaction is the oldest).
    // Full: overwrite a slot in rotation (the pool is large enough that this only thins the busiest moments).
    const i = this.n < this.cap ? this.n++ : (this.overwrite = (this.overwrite + 1) % this.cap);
    const i3 = i * 3;
    this.pos[i3] = p.x;
    this.pos[i3 + 1] = p.y;
    this.pos[i3 + 2] = p.z;
    this.vel[i3] = p.vx ?? 0;
    this.vel[i3 + 1] = p.vy ?? 0;
    this.vel[i3 + 2] = p.vz ?? 0;
    this.born[i] = now + (p.delay ?? 0);
    this.life[i] = p.life;
    this.size[i * 2] = p.size0;
    this.size[i * 2 + 1] = p.size1;
    this.c0.setHex(p.color0);
    this.c1.setHex(p.color1 ?? p.color0);
    const i6 = i * 6;
    this.col[i6] = this.c0.r;
    this.col[i6 + 1] = this.c0.g;
    this.col[i6 + 2] = this.c0.b;
    this.col[i6 + 3] = this.c1.r;
    this.col[i6 + 4] = this.c1.g;
    this.col[i6 + 5] = this.c1.b;
    this.misc[i3] = p.alpha;
    this.misc[i3 + 1] = p.drag ?? 0;
    this.misc[i3 + 2] = p.gravity ?? 0;
  }

  update(now: number, dt: number): void {
    const P = this.aPos.array as Float32Array;
    const S = this.aSize.array as Float32Array;
    const C = this.aCol.array as Float32Array;
    const pos = this.pos;
    const vel = this.vel;
    let i = 0;
    while (i < this.n) {
      const age = now - (this.born[i] as number);
      const k = age / (this.life[i] as number);
      if (k >= 1) {
        // Dead: the last live particle takes its slot (order does not matter for these blends).
        this.n--;
        if (i !== this.n) this.copy(this.n, i);
        continue;
      }
      const i3 = i * 3;
      if (age >= 0) {
        const drag = Math.exp(-(this.misc[i3 + 1] as number) * dt);
        vel[i3] = (vel[i3] as number) * drag;
        vel[i3 + 1] = (vel[i3 + 1] as number) * drag - (this.misc[i3 + 2] as number) * dt;
        vel[i3 + 2] = (vel[i3 + 2] as number) * drag;
        pos[i3] = (pos[i3] as number) + (vel[i3] as number) * dt;
        pos[i3 + 1] = (pos[i3 + 1] as number) + (vel[i3 + 1] as number) * dt;
        pos[i3 + 2] = (pos[i3 + 2] as number) + (vel[i3 + 2] as number) * dt;
        if ((pos[i3 + 1] as number) < 0.01) {
          pos[i3 + 1] = 0.01;
          vel[i3 + 1] = Math.abs(vel[i3 + 1] as number) * 0.25;
        }
      }
      const kk = Math.max(0, k);
      P[i3] = pos[i3] as number;
      P[i3 + 1] = pos[i3 + 1] as number;
      P[i3 + 2] = pos[i3 + 2] as number;
      S[i] = age < 0 ? 0 : (this.size[i * 2] as number) + ((this.size[i * 2 + 1] as number) - (this.size[i * 2] as number)) * kk;
      const i6 = i * 6;
      C[i * 4] = (this.col[i6] as number) + ((this.col[i6 + 3] as number) - (this.col[i6] as number)) * kk;
      C[i * 4 + 1] = (this.col[i6 + 1] as number) + ((this.col[i6 + 4] as number) - (this.col[i6 + 1] as number)) * kk;
      C[i * 4 + 2] = (this.col[i6 + 2] as number) + ((this.col[i6 + 5] as number) - (this.col[i6 + 2] as number)) * kk;
      // Quick fade in, long fade out.
      C[i * 4 + 3] = age < 0 ? 0 : (this.misc[i3] as number) * Math.min(1, kk * 12) * (1 - kk) ** 1.3;
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  private copy(from: number, to: number): void {
    this.pos.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.vel.copyWithin(to * 3, from * 3, from * 3 + 3);
    this.born[to] = this.born[from] as number;
    this.life[to] = this.life[from] as number;
    this.size.copyWithin(to * 2, from * 2, from * 2 + 2);
    this.col.copyWithin(to * 6, from * 6, from * 6 + 6);
    this.misc.copyWithin(to * 3, from * 3, from * 3 + 3);
  }
}

/** Immediate-mode glowing streaks (tracers, projectile bodies, slashes): one instanced draw. */
class Streaks {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private mid = new THREE.Vector3();
  private dir = new THREE.Vector3();
  private c = new THREE.Color();
  private static X = new THREE.Vector3(1, 0, 0);

  constructor(private readonly cap: number) {
    const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    g.rotateZ(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(g, mat, cap);
    this.mesh.setColorAt(0, this.c.setRGB(1, 1, 1));
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 7;
  }

  begin(): void {
    this.n = 0;
  }

  add(tail: Vec, head: Vec, width: number, color: number, intensity: number): void {
    if (this.n >= this.cap) return;
    this.dir.subVectors(head, tail);
    const len = this.dir.length();
    if (len < 1e-4) return;
    this.dir.divideScalar(len);
    this.q.setFromUnitVectors(Streaks.X, this.dir);
    this.mid.addVectors(head, tail).multiplyScalar(0.5);
    this.m.compose(this.mid, this.q, this.s.set(len, width, width));
    this.mesh.setMatrixAt(this.n, this.m);
    this.mesh.setColorAt(this.n, this.c.setHex(color).multiplyScalar(intensity));
    this.n++;
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

interface Shot {
  look: Look;
  from: Vec;
  to: Vec;
  born: number;
  dur: number;
  /** A straight shot: the impact plays when the tracer arrives. */
  straight: boolean;
  /** Set when the simulation's splash explosion is drawn by this projectile. */
  splash: number;
  lastTrail: number;
}

interface Flash {
  mesh: THREE.Mesh;
  born: number;
  life: number;
  size: number;
  /** Brightens over its life instead of fading (a superweapon's marked ground). */
  grow?: boolean;
}

const LIGHT_POOL = 6;
/** Particle budgets: enough for a large battle; beyond them ambient effects thin out first (R3D-13). */
const GLOW_CAP = 2560;
const SMOKE_CAP = 2048;

export interface FxQuality {
  /** Dust, debris and smoke density (0 = minimal). */
  rich: boolean;
}

export class CombatFx {
  readonly root = new THREE.Group();
  private glow: ParticleLayer;
  private smoke: ParticleLayer;
  private streaks = new Streaks(512);
  private shots: Shot[] = [];
  private lights: { light: THREE.PointLight; until: number; power: number; born: number }[] = [];
  private rings: Flash[] = [];
  private scorches: Flash[] = [];
  /** Glowing acid puddles, drawn additively over the ground. */
  puddles: Flash[] = [];
  /** Long-lived columns of light (superweapon beams). */
  private beams: { tail: Vec; head: Vec; born: number; life: number; width: number; color: number; intensity: number }[] = [];
  /** Superweapon targets, marked from launch until the strike lands (R3D-16). */
  warnings: { at: Vec; r: number; start: number; end: number; glow: number; core: number; lastRing: number; lastMote: number; lastLight: number }[] = [];
  /** Effects scheduled for later. */
  private later: { at: number; fn: (now: number) => void }[] = [];
  /** Harvesters at work, by unit id (R3D-19): mining from a crystal or unloading into a refinery. */
  links = new Map<number, { from: Vec; to: Vec; until: number; organic: boolean; unload: boolean; last: number; seed: number }>();
  private rng = new Rng(12345);
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  /** Current camera shake amplitude (tiles), decays. */
  shake = 0;
  quality: FxQuality = { rich: true };
  /** Ground height under a point, so scorch marks lie on plateaus too; the view sets it. */
  groundAt: (x: number, z: number) => number = () => 0;

  constructor() {
    this.glow = new ParticleLayer(GLOW_CAP, true);
    this.smoke = new ParticleLayer(SMOKE_CAP, false);
    this.root.add(this.smoke.points, this.glow.points, this.streaks.mesh);
    for (let i = 0; i < LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xffa050, 0, 7, 1.6);
      this.root.add(light);
      this.lights.push({ light, until: 0, power: 0, born: 0 });
    }
    const ringGeo = new THREE.RingGeometry(0.8, 1, 40);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.rings.push({ mesh, born: -1e9, life: 1, size: 1 });
    }
    const scorchTex = scorchTexture();
    // Puddles are rounder than scorch marks.
    const puddleTex = scorchTexture(0.1);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(scorchGeoFor(), new THREE.MeshBasicMaterial({ color: BIO, alphaMap: puddleTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      mesh.visible = false;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      this.puddles.push({ mesh, born: -1e9, life: 1, size: 1 });
    }
    const scorchGeo = scorchGeoFor();
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(scorchGeo, new THREE.MeshBasicMaterial({ color: 0x0a0806, alphaMap: scorchTex, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.root.add(mesh);
      this.scorches.push({ mesh, born: -1e9, life: 1, size: 1 });
    }
  }

  /** Show every pooled effect mesh (for shader compilation before the first frame), or restore them. */
  warm(on: boolean): void {
    for (const f of [...this.rings, ...this.scorches, ...this.puddles]) f.mesh.visible = on;
    this.glow.points.geometry.setDrawRange(0, on ? 1 : 0);
    this.smoke.points.geometry.setDrawRange(0, on ? 1 : 0);
    this.streaks.mesh.count = on ? 1 : 0;
  }

  /** Pixels per world unit at distance 1, for particle sizing. */
  setScale(pixelsAtUnitDistance: number): void {
    this.glow.material.uniforms.scale!.value = pixelsAtUnitDistance;
    this.smoke.material.uniforms.scale!.value = pixelsAtUnitDistance;
  }

  get particleCount(): number {
    return this.glow.count + this.smoke.count;
  }

  /** True when the pools are nearly full: dust, steam and lingering smoke are skipped so combat effects keep room. */
  private get busy(): boolean {
    return this.smoke.count > SMOKE_CAP * 0.7 || this.glow.count > GLOW_CAP * 0.7;
  }

  /** Muzzle flash, light and (for heavy guns) a smoke puff at a muzzle pointing along `dir`. */
  muzzle(look: WeaponLook, at: Vec, dir: Vec, now: number): void {
    const L = LOOKS[look];
    if (L.flash <= 0) return;
    const r = this.rng;
    if (L.bio) {
      this.spit(L, at, dir, now);
      return;
    }
    // Small arms get a dimmer, warmer core than guns and launchers.
    const small = L.flash < 0.3;
    this.glow.emit({ x: at.x, y: at.y, z: at.z, life: small ? 55 : 70, size0: L.flash * 1.4, size1: L.flash * 0.6, color0: small ? L.flashColor : 0xffffff, color1: L.flashColor, alpha: small ? 0.9 : 1.25 }, now);
    for (let i = 0; i < (small ? 2 : 3); i++) {
      const s = r.range(0.4, 1.4);
      this.glow.emit({ x: at.x + dir.x * L.flash * 0.4 * s, y: at.y + dir.y * L.flash * 0.4 * s, z: at.z + dir.z * L.flash * 0.4 * s, vx: dir.x * 2 * s, vy: dir.y * 2 * s, vz: dir.z * 2 * s, life: 60 + i * 15, size0: L.flash * 0.7, size1: L.flash * 0.3, color0: L.flashColor, alpha: small ? 0.7 : 1.2 }, now);
    }
    this.light(at.x, at.y + 0.1, at.z, L.flashColor, L.flash * 9, 90 + L.flash * 120, now);
    if (L.flash >= 0.5 || look === 'rocket') {
      const n = this.quality.rich ? 6 : 2;
      for (let i = 0; i < n; i++) {
        const s = r.range(0.3, 1);
        this.smoke.emit({ x: at.x, y: at.y, z: at.z, vx: dir.x * s * 1.6 + r.range(-0.2, 0.2), vy: dir.y * s + r.range(0.1, 0.4), vz: dir.z * s * 1.6 + r.range(-0.2, 0.2), life: r.range(700, 1300), size0: 0.12, size1: L.flash * 1.1, color0: 0x9a958c, color1: 0x5c5a56, alpha: 0.45, drag: 2.2, gravity: -0.15 }, now);
      }
      this.shake = Math.max(this.shake, L.shake);
    }
    if (look === 'heroCannon') this.heroMuzzle(at, dir, now);
  }

  /**
   * Extra blast for the Paladin's cannons (HERO-1): jets of fire to both sides from the muzzle brake, a ring of
   * pressure thrown out from the muzzle, and a thick cloud of gun smoke that rolls forward and lingers.
   */
  private heroMuzzle(at: Vec, dir: Vec, now: number): void {
    const r = this.rng;
    const sx = -dir.z;
    const sz = dir.x;
    for (const side of [1, -1]) {
      for (let i = 0; i < 3; i++) {
        const sp = r.range(1.6, 3);
        this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: (sx * side + dir.x * 0.3) * sp, vy: r.range(0, 0.4), vz: (sz * side + dir.z * 0.3) * sp, life: 90 + i * 25, size0: 0.32, size1: 0.12, color0: 0xffffff, color1: 0xffa040, alpha: 1.1, drag: 6 }, now);
      }
    }
    this.ring(at, 1.1, 260, now, 0xffe0b0);
    const n = this.quality.rich && !this.busy ? 8 : 3;
    for (let i = 0; i < n; i++) {
      const s = r.range(0.4, 1.2);
      this.smoke.emit({ x: at.x + dir.x * 0.2, y: at.y, z: at.z + dir.z * 0.2, vx: dir.x * s * 2.4 + r.range(-0.4, 0.4), vy: r.range(0.1, 0.5), vz: dir.z * s * 2.4 + r.range(-0.4, 0.4), life: r.range(1200, 2200), size0: 0.2, size1: r.range(0.9, 1.4), color0: 0xa8a298, color1: 0x5c5a56, alpha: 0.42, drag: 2.6, gravity: -0.12 }, now);
    }
  }

  /**
   * A Vrax weapon's discharge (R3D-12): a glowing spit burst fanning forward from the mouth or stinger, droplets that
   * arc and fall, a breath of green vapour and a green glow, in place of a fire flash.
   */
  private spit(L: Look, at: Vec, dir: Vec, now: number): void {
    const r = this.rng;
    const f = L.flash;
    this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 90, size0: f * 1.3, size1: f * 0.5, color0: BIO, color1: BIO_DEEP, alpha: 0.85 }, now);
    const n = this.quality.rich ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const sp = r.range(1.2, 3.2);
      const sx = r.range(-0.6, 0.6);
      const sz = r.range(-0.6, 0.6);
      this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: (dir.x + sx * 0.5) * sp, vy: (dir.y + r.range(0, 0.5)) * sp, vz: (dir.z + sz * 0.5) * sp, life: r.range(180, 380), size0: f * 0.4, size1: f * 0.12, color0: BIO, color1: BIO_DEEP, alpha: 0.9, drag: 3, gravity: 5 }, now);
    }
    if (this.quality.rich && !this.busy) this.smoke.emit({ x: at.x + dir.x * f, y: at.y + dir.y * f, z: at.z + dir.z * f, vx: dir.x * 0.6, vy: 0.2, vz: dir.z * 0.6, life: 650, size0: f * 0.5, size1: f * 2, color0: 0x7aa04a, color1: 0x3a4a2a, alpha: 0.3, drag: 2 }, now);
    this.light(at.x, at.y + 0.1, at.z, BIO, f * 6, 140 + f * 140, now);
    if (L.shake > 0) this.shake = Math.max(this.shake, L.shake);
  }

  /** A shot from `from` to `to`: straight tracers fly at their look's speed; others take `flightMs` (from the sim). */
  shot(look: WeaponLook, from: Vec, to: Vec, flightMs: number, now: number): void {
    const L = LOOKS[look];
    if (look === 'claw') {
      this.impact(L, to, now, 0);
      return;
    }
    const straight = L.speed > 0;
    this.shots.push({ look: L, from: from.clone(), to: to.clone(), born: now, dur: shotDuration(look, from.distanceTo(to), flightMs), straight, splash: 0, lastTrail: now });
  }

  /** The simulation's splash explosion at `at`: drawn by a projectile landing there, else on its own. */
  splash(at: Vec, r: number, now: number): void {
    // Frame timing can put the explosion a little before or after the projectile's own arrival.
    for (const s of this.shots) {
      if (!s.straight && s.splash === 0 && s.born + s.dur - now < 250 && s.to.distanceTo(at) < 0.9) {
        s.splash = Math.max(0.5, r);
        return;
      }
    }
    const landed = this.landed.find((l) => now - l.at < 250 && l.to.distanceTo(at) < 0.9);
    if (landed) this.impact(landed.look, at, now, Math.max(0.5, r));
    else this.explosion(at, 0.4 + r * 0.4, now, 0xffa040);
  }

  /** Projectiles that landed without a splash in the last moments, so a late splash explosion can still match them. */
  private landed: { look: Look; to: Vec; at: number }[] = [];

  /** A fireball with smoke, sparks, debris, light, a shockwave and a scorch mark (`size` ~ radius in tiles). */
  /** A fireball with sparks and smoke; `dim` scales its brightness (shot impacts are dimmer than deaths, R3D-12). */
  explosion(at: Vec, size: number, now: number, tint = 0xffa040, dim = 1): void {
    const r = this.rng;
    const rich = this.quality.rich;
    this.glow.emit({ x: at.x, y: at.y + 0.1, z: at.z, life: 160, size0: size * 2.2, size1: size * 3, color0: 0xffffff, color1: 0xffe0a0, alpha: 1.8 * dim }, now);
    const fire = rich ? 9 : 5;
    for (let i = 0; i < fire; i++) {
      const a = r.range(0, Math.PI * 2);
      const out = r.range(0.4, 1.6) * size;
      this.glow.emit({ x: at.x + Math.cos(a) * size * 0.2, y: at.y + r.range(0.05, 0.3) * size, z: at.z + Math.sin(a) * size * 0.2, vx: Math.cos(a) * out, vy: r.range(0.4, 1.4) * size, vz: Math.sin(a) * out, life: r.range(380, 750) * (0.7 + size * 0.3), size0: size * r.range(0.6, 1.1), size1: size * r.range(1.2, 1.9), color0: 0xffe8b0, color1: tint === 0xffa040 ? 0xc02810 : tint, alpha: 1.3 * dim, drag: 3, gravity: -0.6, delay: r.range(0, 60) }, now);
    }
    const sparks = rich ? 12 : 5;
    for (let i = 0; i < sparks; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(1.5, 4) * Math.sqrt(size);
      this.glow.emit({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * sp, vy: r.range(1.5, 4), vz: Math.sin(a) * sp, life: r.range(350, 800), size0: 0.05, size1: 0.02, color0: 0xffe0a0, color1: 0xff6020, alpha: 1.6 * dim, gravity: 7, drag: 0.6 }, now);
    }
    const smoke = rich ? 6 : 3;
    for (let i = 0; i < smoke; i++) {
      const a = r.range(0, Math.PI * 2);
      this.smoke.emit({ x: at.x + Math.cos(a) * size * 0.3, y: at.y + 0.2 * size, z: at.z + Math.sin(a) * size * 0.3, vx: Math.cos(a) * 0.4 * size, vy: r.range(0.3, 0.8) * size, vz: Math.sin(a) * 0.4 * size, life: r.range(1600, 2600) * (0.7 + size * 0.3), size0: size * 0.6, size1: size * 1.9, color0: 0x3a3632, color1: 0x55524e, alpha: 0.6, drag: 1.2, gravity: -0.1, delay: r.range(80, 250) }, now);
    }
    if (rich) {
      for (let i = 0; i < 8; i++) {
        const a = r.range(0, Math.PI * 2);
        const sp = r.range(1, 3) * Math.sqrt(size);
        this.smoke.emit({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * sp, vy: r.range(2, 4.5), vz: Math.sin(a) * sp, life: r.range(600, 1100), size0: 0.06, size1: 0.05, color0: 0x1c1a18, alpha: 0.95, gravity: 9 }, now);
      }
    }
    this.light(at.x, at.y + 0.6, at.z, 0xff8a40, 10 * size * dim * dim, 420 + size * 300, now);
    if (size >= 0.55) {
      this.ring(at, size * 2.4, 450, now);
      this.scorch(at, size * 1.6, now);
      this.shake = Math.max(this.shake, 0.03 * size);
    }
  }

  /** Dust kicked up behind a moving vehicle. */
  dust(at: Vec, amount: number, now: number): void {
    if (!this.quality.rich || this.busy) return;
    const r = this.rng;
    this.smoke.emit({ x: at.x + r.range(-0.1, 0.1), y: 0.05, z: at.z + r.range(-0.1, 0.1), vx: r.range(-0.15, 0.15), vy: r.range(0.1, 0.3), vz: r.range(-0.15, 0.15), life: r.range(700, 1100), size0: 0.1 * amount, size1: 0.45 * amount, color0: 0x8a7a5e, color1: 0x9a8c72, alpha: 0.32, drag: 1.5 }, now);
  }

  /** Smoke (and, when `fire`, flames) rising from a damaged building or wreck. */
  burn(at: Vec, fire: boolean, scale: number, now: number): void {
    if (this.busy && !fire) return;
    const r = this.rng;
    this.smoke.emit({ x: at.x + r.range(-0.08, 0.08) * scale, y: at.y, z: at.z + r.range(-0.08, 0.08) * scale, vx: 0.15 + r.range(-0.05, 0.05), vy: r.range(0.4, 0.7), vz: 0.08 + r.range(-0.05, 0.05), life: r.range(2000, 3200), size0: 0.16 * scale, size1: 0.85 * scale, color0: fire ? 0x1c1a19 : 0x2c2a28, color1: 0x5a5753, alpha: 0.68, drag: 0.6, gravity: -0.05 }, now);
    if (fire) {
      // A tongue of flame and a hot core, so a burning building reads at a glance.
      this.glow.emit({ x: at.x + r.range(-0.12, 0.12) * scale, y: at.y, z: at.z + r.range(-0.12, 0.12) * scale, vy: r.range(0.5, 0.9), life: r.range(380, 650), size0: 0.28 * scale, size1: 0.07 * scale, color0: 0xffc060, color1: 0xff3a10, alpha: 1.3, drag: 1, gravity: -0.5 }, now);
      this.glow.emit({ x: at.x, y: at.y - 0.05, z: at.z, life: 160, size0: 0.16 * scale, size1: 0.12 * scale, color0: 0xffe0a0, color1: 0xff7020, alpha: 0.9 }, now);
    }
  }

  /**
   * A damaged building's plume (R3D-20): thick dark smoke that climbs well above the roof and, when `fire`, big flames
   * with embers and a flickering firelight. Heavier than `burn` (wrecks), so a struggling building reads from afar.
   */
  buildingDamage(at: Vec, fire: boolean, scale: number, now: number): void {
    const r = this.rng;
    for (let i = 0; i < 2; i++) {
      this.smoke.emit({ x: at.x + r.range(-0.12, 0.12) * scale, y: at.y + i * 0.1, z: at.z + r.range(-0.12, 0.12) * scale, vx: 0.18 + r.range(-0.06, 0.06), vy: r.range(0.6, 1.0), vz: 0.1 + r.range(-0.06, 0.06), life: r.range(3000, 4600), size0: 0.22 * scale, size1: 1.25 * scale, color0: fire ? 0x141211 : 0x262422, color1: 0x55514c, alpha: 0.85, drag: 0.5, gravity: -0.06 }, now);
    }
    if (!fire) return;
    for (let i = 0; i < 2; i++) this.glow.emit({ x: at.x + r.range(-0.15, 0.15) * scale, y: at.y - 0.05, z: at.z + r.range(-0.15, 0.15) * scale, vy: r.range(0.6, 1.1), life: r.range(450, 780), size0: 0.36 * scale, size1: 0.08 * scale, color0: 0xffc060, color1: 0xff3a10, alpha: 1.4, drag: 1, gravity: -0.6 }, now);
    this.glow.emit({ x: at.x, y: at.y - 0.08, z: at.z, life: 200, size0: 0.22 * scale, size1: 0.16 * scale, color0: 0xffe0a0, color1: 0xff7020, alpha: 1 }, now);
    if (r.next() < 0.35) this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: r.range(-0.5, 0.5), vy: r.range(1.4, 2.4), vz: r.range(-0.5, 0.5), life: r.range(700, 1100), size0: 0.035, size1: 0.015, color0: 0xffd080, color1: 0xff5010, alpha: 1.4, drag: 0.6, gravity: -0.2 }, now);
    if (r.next() < 0.12) this.light(at.x, at.y + 0.3, at.z, 0xff8a40, 1.6 * scale, 260, now);
  }

  /**
   * A hero's death (HERO-3): internal blasts ripple through it for over a second, then a great final blast throws a
   * shockwave and debris, and the wreck burns and smokes for several seconds while the ground shakes. Vrax heroes burst
   * in acid and ichor instead of fire. `size` is the hero's drawn size in tiles.
   */
  heroDeath(at: Vec, organic: boolean, size: number, now: number): void {
    const r = this.rng;
    const tint = organic ? 0x80e020 : 0xffa040;
    const pop = (p: Vec, s: number, t: number): void => {
      if (organic) this.acidBurst(p, s, t);
      this.explosion(p, s, t, tint);
    };
    pop(at.clone().setY(at.y + size * 0.5), 0.7, now);
    for (let i = 0; i < 7; i++) {
      const a = r.range(0, Math.PI * 2);
      const p = new THREE.Vector3(at.x + Math.cos(a) * size * 0.35, at.y + r.range(0.2, 0.8) * size, at.z + Math.sin(a) * size * 0.35);
      this.after(now + 120 + i * 170, (t) => {
        pop(p, 0.55 + 0.1 * (i % 3), t);
        if (organic) this.splatter(p, true, t);
      });
    }
    this.after(now + 1350, (t) => {
      pop(at.clone().setY(at.y + size * 0.3), 1.6, t);
      this.ring(at, size * 2.6, 700, t, organic ? 0xc8ff70 : 0xffd8a0);
      this.ring(at, size * 1.6, 500, t);
      this.shake = Math.max(this.shake, 0.3);
      // Debris thrown out and falling back.
      for (let i = 0; i < (this.quality.rich ? 24 : 10); i++) {
        const a = r.range(0, Math.PI * 2);
        const sp = r.range(1.5, 4.5);
        this.smoke.emit({ x: at.x, y: at.y + size * 0.4, z: at.z, vx: Math.cos(a) * sp, vy: r.range(3, 6), vz: Math.sin(a) * sp, life: r.range(900, 1500), size0: 0.1, size1: 0.08, color0: organic ? 0x3a2034 : 0x222020, alpha: 0.95, gravity: 9 }, t);
      }
      // The wreck keeps burning and smoking.
      for (let k = 0; k < 14; k++) this.after(t + k * 450, (u) => this.buildingDamage(new THREE.Vector3(at.x + r.range(-0.3, 0.3) * size, at.y + 0.2, at.z + r.range(-0.3, 0.3) * size), !organic || k % 2 === 0, 1.4 + size * 0.3, u));
    });
    this.shake = Math.max(this.shake, 0.18);
  }

  /** Light steam from vents and cooling towers. */
  steam(at: Vec, now: number): void {
    if (this.busy) return;
    const r = this.rng;
    this.smoke.emit({ x: at.x + r.range(-0.05, 0.05), y: at.y, z: at.z + r.range(-0.05, 0.05), vx: 0.12, vy: r.range(0.35, 0.55), vz: 0.06, life: r.range(1800, 2600), size0: 0.15, size1: 0.6, color0: 0xd8dce0, color1: 0xb8bcc2, alpha: 0.28, drag: 0.4 }, now);
  }

  /** Green ichor for dying aliens; dark oil and sparks for machines. */
  splatter(at: Vec, organic: boolean, now: number): void {
    const r = this.rng;
    for (let i = 0; i < 10; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(0.6, 1.8);
      (organic ? this.glow : this.smoke).emit({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * sp, vy: r.range(0.8, 2), vz: Math.sin(a) * sp, life: r.range(400, 800), size0: 0.06, size1: 0.04, color0: organic ? 0x9dff3c : 0x18161a, alpha: organic ? 1 : 0.9, gravity: 6 }, now);
    }
  }

  private impact(L: Look, at: Vec, now: number, splash: number): void {
    const r = this.rng;
    if (L.hit === 'blast' || splash > 0) {
      if (L.hit === 'acid') this.acidBurst(at, 0.4 + splash * 0.35, now);
      // Aegis shells and rockets burst dimmer than a death, so a firefight does not flood the screen with light.
      else if (L === LOOKS.heroCannon) {
        // A Paladin shell lands hard: a bigger burst, a ring of dust and thrown dirt, still dimmer than a death.
        this.explosion(at, 0.72, now, 0xffa040, SHOT_BLAST_DIM);
        this.ring(at, 1.3, 420, now, 0xd8c0a0);
        for (let i = 0; i < (this.quality.rich ? 8 : 3); i++) {
          const a = r.range(0, Math.PI * 2);
          const sp = r.range(1, 2.6);
          this.smoke.emit({ x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(a) * sp, vy: r.range(2.2, 4), vz: Math.sin(a) * sp, life: r.range(600, 1000), size0: 0.07, size1: 0.05, color0: 0x3a3228, alpha: 0.9, gravity: 9 }, now);
        }
      } else this.explosion(at, splash > 0 ? 0.4 + splash * 0.4 : L === LOOKS.cannon ? 0.45 : 0.32, now, 0xffa040, SHOT_BLAST_DIM);
      return;
    }
    if (L.hit === 'acid') {
      this.acidBurst(at, 0.25, now);
      return;
    }
    if (L.hit === 'slash') {
      // Three raking claw arcs that glow and fade, a spatter of ichor and a pulse of light (R3D-12).
      const a = r.range(0, Math.PI);
      for (let c = 0; c < 3; c++) {
        const off = (c - 1) * 0.05;
        const p = (t: number): Vec => {
          // A shallow downward arc across the target, each claw a little apart.
          const u = t * 2 - 1;
          return new THREE.Vector3(Math.cos(a) * u * 0.22 - Math.sin(a) * off, 0.16 - u * 0.12 - Math.abs(u) * 0.04, Math.sin(a) * u * 0.22 + Math.cos(a) * off).add(at);
        };
        for (let k = 0; k < 4; k++) this.streakFlash(p(k / 4), p((k + 1) / 4), now);
      }
      for (let i = 0; i < (this.quality.rich ? 8 : 4); i++) {
        const b = r.range(0, Math.PI * 2);
        this.glow.emit({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(b) * r.range(0.4, 1.4), vy: r.range(0.6, 1.6), vz: Math.sin(b) * r.range(0.4, 1.4), life: r.range(300, 550), size0: 0.035, size1: 0.02, color0: BIO, color1: BIO_DEEP, alpha: 1, gravity: 7 }, now);
      }
      this.light(at.x, at.y + 0.2, at.z, BIO, 1.8, 140, now);
    }
    const n = L.hit === 'slash' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * r.range(0.6, 1.8), vy: r.range(0.5, 1.8), vz: Math.sin(a) * r.range(0.6, 1.8), life: r.range(140, 300), size0: 0.04, size1: 0.015, color0: L.hit === 'bone' ? 0xb6ff5c : L.color, alpha: L.bio ? 1.5 : 0.95, gravity: 6 }, now);
    }
    // Stings and spines burst in a small green puff with a glint of light.
    if (L.bio && L.hit !== 'slash') {
      this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 160, size0: 0.08, size1: 0.18, color0: BIO, color1: BIO_DEEP, alpha: 0.65 }, now);
      this.light(at.x, at.y + 0.15, at.z, BIO, 1.2, 120, now);
    }
    if (this.quality.rich) this.smoke.emit({ x: at.x, y: at.y, z: at.z, vy: 0.3, life: 450, size0: 0.06, size1: 0.22, color0: 0x8a7a5e, alpha: 0.35, drag: 2 }, now);
  }

  private flashes: { tail: Vec; head: Vec; born: number }[] = [];

  private streakFlash(tail: Vec, head: Vec, now: number): void {
    this.flashes.push({ tail: tail.clone(), head: head.clone(), born: now });
  }

  private acidBurst(at: Vec, size: number, now: number): void {
    const r = this.rng;
    // A splash crown of glowing acid, then bubbles that keep rising and popping from the puddle (R3D-12).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + r.range(-0.3, 0.3);
      this.glow.emit({ x: at.x, y: at.y + 0.04, z: at.z, vx: Math.cos(a) * size * 2.4, vy: r.range(1.6, 2.6), vz: Math.sin(a) * size * 2.4, life: r.range(380, 520), size0: 0.045, size1: 0.02, color0: BIO, color1: BIO_DEEP, alpha: 1.05, drag: 1.5, gravity: 9 }, now);
    }
    for (let i = 0; i < (this.quality.rich ? 9 : 4); i++) {
      const a = r.range(0, Math.PI * 2);
      const d = Math.sqrt(r.next()) * size * 0.7;
      this.glow.emit({ x: at.x + Math.cos(a) * d, y: at.y + 0.02, z: at.z + Math.sin(a) * d, vy: r.range(0.15, 0.35), life: r.range(300, 500), size0: 0.02, size1: 0.05, color0: BIO, color1: BIO_DEEP, alpha: 0.9, delay: r.range(150, 1600) }, now);
    }
    this.puddle(at, size, now);
    this.glow.emit({ x: at.x, y: at.y + 0.05, z: at.z, life: 220, size0: size * 1.4, size1: size * 2, color0: 0xc8ff70, color1: 0x60b018, alpha: 1.1 }, now);
    for (let i = 0; i < 10; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(0.5, 2) * size * 2;
      this.glow.emit({ x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(a) * sp, vy: r.range(0.6, 2), vz: Math.sin(a) * sp, life: r.range(300, 650), size0: 0.07, size1: 0.03, color0: 0xc8ff4a, color1: 0x5a9a10, alpha: 1.3, gravity: 6 }, now);
    }
    for (let i = 0; i < (this.quality.rich ? 5 : 2); i++) this.smoke.emit({ x: at.x + r.range(-0.1, 0.1), y: at.y + 0.1, z: at.z + r.range(-0.1, 0.1), vy: r.range(0.2, 0.5), life: r.range(1000, 1700), size0: size * 0.5, size1: size * 1.6, color0: 0x6a8a30, color1: 0x3a4a2a, alpha: 0.45, drag: 1 }, now);
    this.light(at.x, at.y + 0.3, at.z, 0xa0ff40, 4 * size, 260, now);
    if (size >= 0.5) {
      this.scorch(at, size * 1.4, now);
      this.ring(at, size * 2, 380, now, BIO);
    }
  }

  /**
   * A harvester at work this frame (R3D-19): what it throws or drops comes from `from` (its cutter, maw or bed lip) and
   * goes toward `to` (its bed, or the intake below). Called every frame while it works; it stops a moment after.
   */
  harvest(id: number, from: Vec, to: Vec, organic: boolean, unload: boolean, now: number): void {
    let l = this.links.get(id);
    if (!l) {
      l = { from: from.clone(), to: to.clone(), until: 0, organic, unload, last: -1e9, seed: (id * 7919) % 97 };
      this.links.set(id, l);
    }
    l.from.copy(from);
    l.to.copy(to);
    l.organic = organic;
    l.unload = unload;
    l.until = now + 160;
  }

  /**
   * Draw the working harvesters (R3D-19). Mining: crystal chips and grit kicked up at the cutter (or the gorger's maw)
   * and thrown into the hopper (`to`). Unloading: crystals tumbling off the tipped bed's lip (or a glowing mass spilling
   * from the gorger) and dropping into the intake below. No beams: everything falls under gravity.
   */
  private drawLinks(now: number): void {
    const r = this.rng;
    for (const [id, l] of this.links) {
      if (now > l.until) {
        this.links.delete(id);
        continue;
      }
      const crystal = l.organic ? 0x7fc23a : 0x47e8c4;
      if (!l.unload) {
        if (now - l.last < 60) continue;
        l.last = now;
        // A chip thrown from the cutter into the hopper, on a ballistic arc.
        const T = 0.4;
        this.glow.emit({ x: l.from.x + r.range(-0.08, 0.08), y: l.from.y, z: l.from.z + r.range(-0.08, 0.08), vx: (l.to.x - l.from.x) / T, vy: (l.to.y - l.from.y) / T + 3 * T, vz: (l.to.z - l.from.z) / T, life: T * 1000, size0: 0.045, size1: 0.035, color0: crystal, alpha: 0.7, gravity: 6 }, now);
        // Grit and dust where it cuts.
        if (this.quality.rich && r.next() < 0.5) this.smoke.emit({ x: l.from.x, y: l.from.y, z: l.from.z, vx: r.range(-0.3, 0.3), vy: r.range(0.2, 0.5), vz: r.range(-0.3, 0.3), life: r.range(500, 800), size0: 0.06, size1: 0.2, color0: 0x8a8070, alpha: 0.3, drag: 2 }, now);
      } else {
        if (now - l.last < 45) continue;
        l.last = now;
        // Crystals tumble off the lip and drop into the intake.
        for (let i = 0; i < (l.organic ? 1 : 2); i++) {
          this.glow.emit({ x: l.from.x + r.range(-0.12, 0.12), y: l.from.y, z: l.from.z + r.range(-0.12, 0.12), vx: (l.to.x - l.from.x) * 1.6 + r.range(-0.15, 0.15), vy: r.range(0, 0.4), vz: (l.to.z - l.from.z) * 1.6 + r.range(-0.15, 0.15), life: r.range(380, 520), size0: l.organic ? 0.07 : 0.05, size1: 0.04, color0: crystal, alpha: 0.7, gravity: 7 }, now);
        }
        if (this.quality.rich && r.next() < 0.3) this.smoke.emit({ x: l.to.x, y: l.to.y, z: l.to.z, vx: r.range(-0.2, 0.2), vy: 0.3, vz: r.range(-0.2, 0.2), life: 600, size0: 0.1, size1: 0.3, color0: 0x9a9284, alpha: 0.25, drag: 2 }, now);
      }
    }
  }

  /** A burst from a damaged building (R3D-18): electric sparks for Aegis, a spurt of glowing ichor for the Vrax. */
  sparks(at: Vec, organic: boolean, now: number): void {
    const r = this.rng;
    const n = this.quality.rich ? 7 : 3;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(0.8, 2.2);
      this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: r.range(0.6, 2), vz: Math.sin(a) * sp, life: r.range(250, 500), size0: organic ? 0.045 : 0.03, size1: 0.01, color0: organic ? BIO : 0xfff2b0, color1: organic ? BIO_DEEP : 0xff8a30, alpha: 1.4, gravity: 7 }, now);
    }
    this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 90, size0: 0.12, size1: 0.2, color0: organic ? BIO : 0xcfe8ff, alpha: 1 }, now);
    this.light(at.x, at.y + 0.1, at.z, organic ? BIO : 0x9fd0ff, 1, 100, now);
  }

  /** A glowing pool on the ground: acid that fades over a few seconds (R3D-12), or a superweapon's mark that grows. */
  private puddle(at: Vec, size: number, now: number, color = BIO, life = 3800, grow = false): void {
    const f = this.puddles.reduce((a, b) => (b.born < a.born ? b : a));
    f.mesh.position.set(at.x, this.groundAt(at.x, at.z) + 0.025, at.z);
    f.mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    f.mesh.scale.setScalar(size * 1.5);
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    f.born = now;
    f.life = life;
    f.size = size;
    f.grow = grow;
    f.mesh.visible = true;
  }

  /** A column of light drawn every frame for `life` ms, thinning and fading as it goes. */
  private beam(tail: Vec, head: Vec, width: number, color: number, intensity: number, life: number, now: number): void {
    this.beams.push({ tail: tail.clone(), head: head.clone(), born: now, life, width, color, intensity });
  }

  /** Run `fn` at time `at` (staggered shockwaves, lingering fires). */
  private after(at: number, fn: (now: number) => void): void {
    this.later.push({ at, fn });
  }

  /**
   * A superweapon launch (R3D-16): a blinding flash and a beam of light into the sky from the weapon, motes streaming
   * up it and a ring of dust, then, until the strike lands, the target marked for everyone: a glowing disc, a targeting
   * beam from the sky that thickens, pulses of light and shockwave rings that quicken, and motes drawn in to its centre.
   */
  superweaponLaunch(from: Vec, top: number, to: Vec, radius: number, delayMs: number, aegis: boolean, now: number): void {
    const P = aegis ? SW.aegis : SW.vrax;
    const r = this.rng;
    const base = from.clone().setY(from.y + top);
    this.glow.emit({ x: base.x, y: base.y, z: base.z, life: 280, size0: 1.2, size1: 2.6, color0: 0xffffff, color1: P.glow, alpha: 2 }, now);
    const sky = base.clone().setY(base.y + 40);
    this.beam(base, sky, 0.24, P.glow, 3, 1100, now);
    this.beam(base, sky, 0.08, P.core, 7, 800, now);
    for (let i = 0; i < (this.quality.rich ? 20 : 8); i++) {
      this.glow.emit({ x: base.x + r.range(-0.25, 0.25), y: base.y, z: base.z + r.range(-0.25, 0.25), vx: r.range(-0.3, 0.3), vy: r.range(4, 9), vz: r.range(-0.3, 0.3), life: r.range(700, 1100), size0: 0.09, size1: 0.02, color0: P.core, color1: P.glow, alpha: 1.4, drag: 0.4, delay: r.range(0, 300) }, now);
    }
    if (this.quality.rich) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        this.smoke.emit({ x: from.x, y: from.y + 0.1, z: from.z, vx: Math.cos(a) * 1.6, vy: 0.15, vz: Math.sin(a) * 1.6, life: r.range(1000, 1500), size0: 0.3, size1: 1.2, color0: 0x9a958c, color1: 0x5c5a56, alpha: 0.4, drag: 2 }, now);
      }
    }
    this.light(base.x, base.y, base.z, P.glow, 30, 900, now, 14);
    this.shake = Math.max(this.shake, 0.1);
    this.warnings.push({ at: to.clone(), r: radius, start: now, end: now + delayMs, glow: P.glow, core: P.core, lastRing: -1e9, lastMote: -1e9, lastLight: -1e9 });
    this.puddle(to, radius * 0.75, now, P.glow, delayMs + 300, true);
  }

  /**
   * A superweapon strike (R3D-16): a blinding flash and a pillar of light from the sky, three shockwaves, fireballs
   * across the whole blast, a rising mushroom of smoke, a storm of embers, a wide scorch, fires that keep burning and a
   * long camera shake; the Vrax rift adds an acid eruption and pools.
   */
  superweaponStrike(at: Vec, radius: number, aegis: boolean, now: number): void {
    const P = aegis ? SW.aegis : SW.vrax;
    const r = this.rng;
    const rich = this.quality.rich;
    const R = Math.max(1.5, radius);
    this.glow.emit({ x: at.x, y: at.y + 0.6, z: at.z, life: 320, size0: R * 2.5, size1: R * 4.5, color0: 0xffffff, color1: P.core, alpha: 2.4 }, now);
    this.glow.emit({ x: at.x, y: at.y + 0.3, z: at.z, life: 2400, size0: R * 3, size1: R * 5, color0: P.glow, color1: P.deep, alpha: 0.9 }, now);
    const sky = at.clone().setY(at.y + 40);
    this.beam(sky, at, R * 0.17, P.glow, 2.2, 2200, now);
    this.beam(sky, at, R * 0.06, P.core, 6, 1500, now);
    this.light(at.x, at.y + 1.5, at.z, P.core, 90, 3500, now, 10 + R * 3);
    // The crater keeps glowing, cooling over several seconds.
    this.puddle(at, R * 0.8, now, aegis ? 0xff7a30 : P.glow, 7000);
    [0, 140, 320].forEach((d, i) => this.after(now + d, (t) => this.ring(at, R * (1.6 + i * 0.9), 700 + i * 200, t, i === 0 ? 0xffffff : P.glow)));
    this.explosion(at, 2.2, now, P.fire);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + r.range(-0.3, 0.3);
      const d = R * r.range(0.35, 0.8);
      const p = new THREE.Vector3(at.x + Math.cos(a) * d, at.y, at.z + Math.sin(a) * d);
      this.after(now + 60 + i * 55, (t) => this.explosion(p, 0.9, t, P.fire));
    }
    // A mushroom of smoke: a column that rises, then a cap that spreads.
    for (let i = 0; i < (rich ? 26 : 10); i++) {
      this.smoke.emit({ x: at.x + r.range(-0.3, 0.3), y: at.y + 0.3, z: at.z + r.range(-0.3, 0.3), vx: r.range(-0.3, 0.3), vy: r.range(1.6, 3.2), vz: r.range(-0.3, 0.3), life: r.range(5000, 8000), size0: 0.5, size1: R * r.range(0.8, 1.3), color0: aegis ? 0x4a4440 : 0x3a4a30, color1: 0x6a6660, alpha: 0.55, drag: 0.9, gravity: -0.2, delay: r.range(0, 500) }, now);
    }
    for (let i = 0; i < (rich ? 14 : 6); i++) {
      const a = r.range(0, Math.PI * 2);
      this.smoke.emit({ x: at.x, y: at.y + 2.4, z: at.z, vx: Math.cos(a) * r.range(0.8, 1.4), vy: 0.35, vz: Math.sin(a) * r.range(0.8, 1.4), life: r.range(5000, 7500), size0: 0.8, size1: R * 1.3, color0: 0x5a5450, color1: 0x77736c, alpha: 0.5, drag: 1, delay: r.range(600, 1000) }, now);
    }
    for (let i = 0; i < (rich ? 36 : 14); i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(2, 6);
      this.glow.emit({ x: at.x, y: at.y + 0.3, z: at.z, vx: Math.cos(a) * sp, vy: r.range(3, 7), vz: Math.sin(a) * sp, life: r.range(900, 1600), size0: 0.08, size1: 0.02, color0: P.core, color1: aegis ? 0xff7020 : P.deep, alpha: 1.4, gravity: 7 }, now);
    }
    this.scorch(at, R * 2.4, now);
    // Fires keep burning across the blast for about eight seconds.
    for (let i = 0; i < (rich ? 26 : 8); i++) {
      const a = r.range(0, Math.PI * 2);
      const d = R * r.range(0.1, 0.7);
      const p = new THREE.Vector3(at.x + Math.cos(a) * d, at.y + 0.05, at.z + Math.sin(a) * d);
      this.after(now + 300 + i * (rich ? 300 : 900), (t) => this.burn(p, true, 0.6, t));
    }
    if (!aegis) {
      this.acidBurst(at, 1, now);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const p = new THREE.Vector3(at.x + Math.cos(a) * R * 0.6, at.y, at.z + Math.sin(a) * R * 0.6);
        this.after(now + 200 + i * 60, (t) => this.puddle(p, 0.5, t));
      }
    }
    this.shake = Math.max(this.shake, 0.45);
  }

  private light(x: number, y: number, z: number, color: number, power: number, life: number, now: number, reach = 7): void {
    const slot = this.lights.reduce((a, b) => (b.until < a.until ? b : a));
    // Keep a brighter light that is still burning rather than replace it with a dimmer one.
    if (slot.until > now && slot.power > power) return;
    slot.light.position.set(x, y, z);
    slot.light.distance = reach;
    slot.light.color.setHex(color);
    slot.power = power;
    slot.born = now;
    slot.until = now + life;
  }

  private ring(at: Vec, size: number, life: number, now: number, color = 0xffd8a0): void {
    const f = this.rings.reduce((a, b) => (b.born < a.born ? b : a));
    f.mesh.position.set(at.x, this.groundAt(at.x, at.z) + 0.06, at.z);
    (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    f.born = now;
    f.life = life;
    f.size = size;
    f.mesh.visible = true;
  }

  private scorch(at: Vec, size: number, now: number): void {
    const f = this.scorches.reduce((a, b) => (b.born < a.born ? b : a));
    f.mesh.position.set(at.x, this.groundAt(at.x, at.z) + 0.02, at.z);
    f.mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    f.mesh.scale.setScalar(size);
    f.born = now;
    f.life = 14000;
    f.size = size;
    f.mesh.visible = true;
  }

  update(now: number, dt: number): void {
    if (this.later.length) {
      const due = this.later.filter((l) => l.at <= now);
      this.later = this.later.filter((l) => l.at > now);
      for (const l of due) l.fn(now);
    }
    this.streaks.begin();
    this.beams = this.beams.filter((b) => {
      const k = (now - b.born) / b.life;
      if (k >= 1) return false;
      this.streaks.add(b.tail, b.head, b.width * (1 - k) ** 0.7, b.color, b.intensity * (1 - k) ** 1.5);
      return true;
    });
    this.warnings = this.warnings.filter((w) => {
      if (now >= w.end) return false;
      const k = Math.max(0, (now - w.start) / Math.max(1, w.end - w.start));
      // The targeting beam from the sky thickens and brightens as the strike nears.
      this.w.copy(w.at).setY(w.at.y + 40);
      this.streaks.add(this.w, w.at, 0.012 + 0.05 * k * k, w.glow, 1.5 + 4 * k);
      if (now - w.lastRing > 520 - 380 * k) {
        w.lastRing = now;
        this.ring(w.at, w.r * 1.15, 420, now, w.glow);
      }
      if (now - w.lastMote > 35) {
        w.lastMote = now;
        const r = this.rng;
        for (let i = 0; i < 2; i++) {
          const a = r.range(0, Math.PI * 2);
          const d = w.r * r.range(0.85, 1.1);
          const sp = 2.5 + 3 * k;
          this.glow.emit({ x: w.at.x + Math.cos(a) * d, y: w.at.y + 0.1, z: w.at.z + Math.sin(a) * d, vx: -Math.cos(a) * sp, vy: 0.3, vz: -Math.sin(a) * sp, life: (d / sp) * 900, size0: 0.05, size1: 0.1, color0: w.glow, color1: w.core, alpha: 1 }, now);
        }
      }
      if (now - w.lastLight > 150) {
        w.lastLight = now;
        this.light(w.at.x, w.at.y + 0.6, w.at.z, w.glow, 4 + 14 * k, 220, now, 4 + w.r);
      }
      return true;
    });
    const keep: Shot[] = [];
    for (const s of this.shots) {
      const k = (now - s.born) / s.dur;
      if (k >= 1) {
        this.impact(s.look, s.to, now, s.splash);
        if (!s.straight && s.splash === 0) this.landed.push({ look: s.look, to: s.to, at: now });
        continue;
      }
      keep.push(s);
      this.pathAt(s, Math.max(0, k), this.v);
      const L = s.look;
      if (s.straight) {
        // Tracer: a bright bolt whose tail never starts behind the muzzle.
        const back = Math.min(L.len, s.from.distanceTo(this.v));
        this.w.subVectors(s.to, s.from).normalize().multiplyScalar(-back).add(this.v);
        this.streaks.add(this.w, this.v, L.width, L.color, L.intensity);
        // Stings and spines leave a short glowing wake of motes that drift and fade (R3D-12).
        if (L.bio && now - s.lastTrail > 22) {
          s.lastTrail = now;
          this.glow.emit({ x: this.w.x, y: this.w.y, z: this.w.z, vy: 0.15, life: 260, size0: L.width * 4, size1: L.width, color0: BIO, color1: BIO_DEEP, alpha: 0.8 }, now);
        }
      } else {
        this.pathAt(s, Math.max(0, k - 0.04), this.w);
        const d = this.v.distanceTo(this.w);
        if (d > 1e-4) this.w.sub(this.v).multiplyScalar(L.len / d).add(this.v);
        this.streaks.add(this.w, this.v, L.width, L.color, L.intensity);
        if (now - s.lastTrail > 16) {
          s.lastTrail = now;
          if (L.smokeTrail) this.smoke.emit({ x: this.v.x, y: this.v.y, z: this.v.z, vy: 0.1, life: this.quality.rich ? 900 : 400, size0: 0.05, size1: 0.28, color0: 0xb8b2a8, color1: 0x77736c, alpha: 0.42, drag: 1 }, now);
          this.glow.emit({ x: this.v.x, y: this.v.y, z: this.v.z, life: L.bio ? 220 : 90, size0: L.width * (L.bio ? 6 : 5), size1: L.width * 2, color0: L.color, color1: L.bio ? BIO_DEEP : L.color, alpha: 1.1 }, now);
          if (L.bio) {
            // An acid glob drips glowing droplets and trails a wisp of green vapour (R3D-12).
            const r = this.rng;
            if (r.next() < 0.45) this.glow.emit({ x: this.v.x, y: this.v.y, z: this.v.z, vx: r.range(-0.2, 0.2), vz: r.range(-0.2, 0.2), life: r.range(350, 600), size0: L.width * 1.6, size1: L.width * 0.8, color0: BIO, color1: BIO_DEEP, alpha: 1, gravity: 7 }, now);
            if (this.quality.rich && !this.busy && r.next() < 0.5) this.smoke.emit({ x: this.v.x, y: this.v.y, z: this.v.z, vy: 0.1, life: 700, size0: L.width * 1.5, size1: L.width * 5, color0: 0x8ab050, color1: 0x3a4a2a, alpha: 0.28, drag: 1 }, now);
          }
        }
      }
    }
    this.shots = keep;
    this.landed = this.landed.filter((l) => now - l.at < 250);
    this.drawLinks(now);
    this.flashes = this.flashes.filter((f) => {
      const k = (now - f.born) / 140;
      if (k >= 1) return false;
      this.streaks.add(f.tail, f.head, 0.012 * (1 - k), 0xc8f0a0, 1.6);
      return true;
    });
    this.streaks.end();
    this.glow.update(now, dt);
    this.smoke.update(now, dt);
    for (const l of this.lights) l.light.intensity = now < l.until ? l.power * (1 - (now - l.born) / Math.max(1, l.until - l.born)) ** 1.5 : 0;
    for (const f of this.rings) {
      const k = (now - f.born) / f.life;
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      f.mesh.scale.setScalar(f.size * (0.15 + k));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) ** 2;
    }
    for (const f of this.puddles) {
      const k = (now - f.born) / f.life;
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      // Glows brightest just after the splash, with a slow shimmer, then fades away; a superweapon's mark grows instead.
      const shimmer = 0.85 + 0.15 * Math.sin(now / 90 + f.size * 7);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = (f.grow ? 0.15 + 0.5 * k * k : 0.8 * (1 - k) ** 1.5) * shimmer;
    }
    for (const f of this.scorches) {
      const k = (now - f.born) / f.life;
      if (k >= 1) {
        f.mesh.visible = false;
        continue;
      }
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * Math.min(1, (1 - k) * 3);
    }
    this.shake *= Math.exp(-dt * 9);
    if (this.shake < 0.001) this.shake = 0;
  }

  /** Position along a shot's path at progress `k`: a straight line plus a parabolic arc. */
  private pathAt(s: Shot, k: number, out: Vec): Vec {
    out.lerpVectors(s.from, s.to, k);
    out.y += 4 * s.look.arc * s.from.distanceTo(s.to) * k * (1 - k);
    return out;
  }
}
