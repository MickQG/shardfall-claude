import * as THREE from 'three';
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
}

export const LOOKS: Record<WeaponLook, Look> = {
  rifle: { color: 0xffe2a0, intensity: 3, speed: 38, len: 0.32, width: 0.008, arc: 0, flash: 0.14, flashColor: 0xffd27a, smokeTrail: false, hit: 'spark', shake: 0 },
  mg: { color: 0xffcf80, intensity: 3, speed: 42, len: 0.36, width: 0.01, arc: 0, flash: 0.16, flashColor: 0xffc070, smokeTrail: false, hit: 'spark', shake: 0 },
  chaingun: { color: 0xffc070, intensity: 3.5, speed: 46, len: 0.42, width: 0.011, arc: 0, flash: 0.18, flashColor: 0xffb060, smokeTrail: false, hit: 'spark', shake: 0 },
  pulse: { color: 0x80e8ff, intensity: 4, speed: 30, len: 0.5, width: 0.022, arc: 0, flash: 0.26, flashColor: 0x9ff0ff, smokeTrail: false, hit: 'spark', shake: 0 },
  cannon: { color: 0xffd090, intensity: 4, speed: 0, len: 0.3, width: 0.03, arc: 0.02, flash: 0.55, flashColor: 0xffc068, smokeTrail: false, hit: 'blast', shake: 0.04 },
  howitzer: { color: 0xffb060, intensity: 3, speed: 0, len: 0.22, width: 0.035, arc: 0.38, flash: 0.8, flashColor: 0xffb050, smokeTrail: true, hit: 'blast', shake: 0.08 },
  rocket: { color: 0xffa040, intensity: 4, speed: 0, len: 0.14, width: 0.03, arc: 0.12, flash: 0.22, flashColor: 0xffb060, smokeTrail: true, hit: 'blast', shake: 0.02 },
  claw: { color: 0xd8ffb0, intensity: 2.5, speed: 0, len: 0, width: 0.02, arc: 0, flash: 0, flashColor: 0, smokeTrail: false, hit: 'slash', shake: 0 },
  acid: { color: 0xb8ff40, intensity: 3, speed: 0, len: 0.1, width: 0.05, arc: 0.28, flash: 0.16, flashColor: 0xc8ff4a, smokeTrail: false, hit: 'acid', shake: 0 },
  acidBig: { color: 0xb8ff40, intensity: 3.5, speed: 0, len: 0.16, width: 0.09, arc: 0.45, flash: 0.35, flashColor: 0xc8ff4a, smokeTrail: false, hit: 'acid', shake: 0.05 },
  sting: { color: 0xe8ff70, intensity: 3, speed: 26, len: 0.24, width: 0.016, arc: 0, flash: 0.1, flashColor: 0xe0ff80, smokeTrail: false, hit: 'spark', shake: 0 },
  spine: { color: 0xf0e6cc, intensity: 1.6, speed: 22, len: 0.3, width: 0.02, arc: 0.04, flash: 0.14, flashColor: 0xb6ff5c, smokeTrail: false, hit: 'bone', shake: 0 },
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
  private rng = new Rng(12345);
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  /** Current camera shake amplitude (tiles), decays. */
  shake = 0;
  quality: FxQuality = { rich: true };

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
    for (let i = 0; i < 6; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0 }));
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
      this.rings.push({ mesh, born: -1e9, life: 1, size: 1 });
    }
    const scorchTex = puffTexture(false);
    const scorchGeo = new THREE.PlaneGeometry(1, 1);
    scorchGeo.rotateX(-Math.PI / 2);
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
    for (const f of [...this.rings, ...this.scorches]) f.mesh.visible = on;
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
    this.glow.emit({ x: at.x, y: at.y, z: at.z, life: 70, size0: L.flash * 1.4, size1: L.flash * 0.6, color0: 0xffffff, color1: L.flashColor, alpha: 1.6 }, now);
    for (let i = 0; i < 3; i++) {
      const s = r.range(0.4, 1.4);
      this.glow.emit({ x: at.x + dir.x * L.flash * 0.4 * s, y: at.y + dir.y * L.flash * 0.4 * s, z: at.z + dir.z * L.flash * 0.4 * s, vx: dir.x * 2 * s, vy: dir.y * 2 * s, vz: dir.z * 2 * s, life: 60 + i * 15, size0: L.flash * 0.7, size1: L.flash * 0.3, color0: L.flashColor, alpha: 1.2 }, now);
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
  explosion(at: Vec, size: number, now: number, tint = 0xffa040): void {
    const r = this.rng;
    const rich = this.quality.rich;
    this.glow.emit({ x: at.x, y: at.y + 0.1, z: at.z, life: 160, size0: size * 2.2, size1: size * 3, color0: 0xffffff, color1: 0xffe0a0, alpha: 1.8 }, now);
    const fire = rich ? 9 : 5;
    for (let i = 0; i < fire; i++) {
      const a = r.range(0, Math.PI * 2);
      const out = r.range(0.4, 1.6) * size;
      this.glow.emit({ x: at.x + Math.cos(a) * size * 0.2, y: at.y + r.range(0.05, 0.3) * size, z: at.z + Math.sin(a) * size * 0.2, vx: Math.cos(a) * out, vy: r.range(0.4, 1.4) * size, vz: Math.sin(a) * out, life: r.range(380, 750) * (0.7 + size * 0.3), size0: size * r.range(0.6, 1.1), size1: size * r.range(1.2, 1.9), color0: 0xffe8b0, color1: tint === 0xffa040 ? 0xc02810 : tint, alpha: 1.3, drag: 3, gravity: -0.6, delay: r.range(0, 60) }, now);
    }
    const sparks = rich ? 12 : 5;
    for (let i = 0; i < sparks; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(1.5, 4) * Math.sqrt(size);
      this.glow.emit({ x: at.x, y: at.y + 0.1, z: at.z, vx: Math.cos(a) * sp, vy: r.range(1.5, 4), vz: Math.sin(a) * sp, life: r.range(350, 800), size0: 0.05, size1: 0.02, color0: 0xffe0a0, color1: 0xff6020, alpha: 1.6, gravity: 7, drag: 0.6 }, now);
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
    this.light(at.x, at.y + 0.6, at.z, 0xff8a40, 10 * size, 420 + size * 300, now);
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
    this.smoke.emit({ x: at.x + r.range(-0.08, 0.08) * scale, y: at.y, z: at.z + r.range(-0.08, 0.08) * scale, vx: 0.15 + r.range(-0.05, 0.05), vy: r.range(0.4, 0.7), vz: 0.08 + r.range(-0.05, 0.05), life: r.range(1800, 2800), size0: 0.15 * scale, size1: 0.8 * scale, color0: 0x2c2a28, color1: 0x5a5753, alpha: 0.55, drag: 0.6, gravity: -0.05 }, now);
    if (fire) this.glow.emit({ x: at.x + r.range(-0.1, 0.1) * scale, y: at.y, z: at.z + r.range(-0.1, 0.1) * scale, vy: r.range(0.4, 0.8), life: r.range(300, 550), size0: 0.22 * scale, size1: 0.06 * scale, color0: 0xffc060, color1: 0xff3a10, alpha: 1.3, drag: 1, gravity: -0.5 }, now);
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
      else this.explosion(at, splash > 0 ? 0.4 + splash * 0.4 : L === LOOKS.cannon ? 0.45 : 0.32, now);
      return;
    }
    if (L.hit === 'acid') {
      this.acidBurst(at, 0.25, now);
      return;
    }
    if (L.hit === 'slash') {
      // Two crossing claw swipes and a spray of sparks.
      const a = r.range(0, Math.PI);
      for (const da of [0, 1.2]) {
        this.v.set(Math.cos(a + da) * 0.18, 0.12, Math.sin(a + da) * 0.18);
        const tail = this.w.copy(at).sub(this.v);
        this.streakFlash(tail, at.clone().add(this.v), now);
      }
    }
    const n = L.hit === 'slash' ? 6 : 4;
    for (let i = 0; i < n; i++) {
      const a = r.range(0, Math.PI * 2);
      this.glow.emit({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * r.range(0.6, 1.8), vy: r.range(0.5, 1.8), vz: Math.sin(a) * r.range(0.6, 1.8), life: r.range(140, 300), size0: 0.04, size1: 0.015, color0: L.hit === 'bone' ? 0xb6ff5c : L.color, alpha: 1.5, gravity: 6 }, now);
    }
    if (this.quality.rich) this.smoke.emit({ x: at.x, y: at.y, z: at.z, vy: 0.3, life: 450, size0: 0.06, size1: 0.22, color0: 0x8a7a5e, alpha: 0.35, drag: 2 }, now);
  }

  private flashes: { tail: Vec; head: Vec; born: number }[] = [];

  private streakFlash(tail: Vec, head: Vec, now: number): void {
    this.flashes.push({ tail: tail.clone(), head: head.clone(), born: now });
  }

  private acidBurst(at: Vec, size: number, now: number): void {
    const r = this.rng;
    this.glow.emit({ x: at.x, y: at.y + 0.05, z: at.z, life: 220, size0: size * 1.6, size1: size * 2.2, color0: 0xe0ff90, color1: 0x80e020, alpha: 1.4 }, now);
    for (let i = 0; i < 10; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(0.5, 2) * size * 2;
      this.glow.emit({ x: at.x, y: at.y + 0.05, z: at.z, vx: Math.cos(a) * sp, vy: r.range(0.6, 2), vz: Math.sin(a) * sp, life: r.range(300, 650), size0: 0.07, size1: 0.03, color0: 0xc8ff4a, color1: 0x5a9a10, alpha: 1.3, gravity: 6 }, now);
    }
    for (let i = 0; i < (this.quality.rich ? 5 : 2); i++) this.smoke.emit({ x: at.x + r.range(-0.1, 0.1), y: at.y + 0.1, z: at.z + r.range(-0.1, 0.1), vy: r.range(0.2, 0.5), life: r.range(1000, 1700), size0: size * 0.5, size1: size * 1.6, color0: 0x6a8a30, color1: 0x3a4a2a, alpha: 0.45, drag: 1 }, now);
    this.light(at.x, at.y + 0.3, at.z, 0xa0ff40, 6 * size, 300, now);
    if (size >= 0.5) this.scorch(at, size * 1.4, now);
  }

  private light(x: number, y: number, z: number, color: number, power: number, life: number, now: number): void {
    const slot = this.lights.reduce((a, b) => (b.until < a.until ? b : a));
    // Keep a brighter light that is still burning rather than replace it with a dimmer one.
    if (slot.until > now && slot.power > power) return;
    slot.light.position.set(x, y, z);
    slot.light.color.setHex(color);
    slot.power = power;
    slot.born = now;
    slot.until = now + life;
  }

  private ring(at: Vec, size: number, life: number, now: number): void {
    const f = this.rings.reduce((a, b) => (b.born < a.born ? b : a));
    f.mesh.position.set(at.x, 0.06, at.z);
    f.born = now;
    f.life = life;
    f.size = size;
    f.mesh.visible = true;
  }

  private scorch(at: Vec, size: number, now: number): void {
    const f = this.scorches.reduce((a, b) => (b.born < a.born ? b : a));
    f.mesh.position.set(at.x, 0.02, at.z);
    f.mesh.rotation.y = this.rng.range(0, Math.PI * 2);
    f.mesh.scale.setScalar(size);
    f.born = now;
    f.life = 14000;
    f.size = size;
    f.mesh.visible = true;
  }

  update(now: number, dt: number): void {
    this.streaks.begin();
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
      } else {
        this.pathAt(s, Math.max(0, k - 0.04), this.w);
        const d = this.v.distanceTo(this.w);
        if (d > 1e-4) this.w.sub(this.v).multiplyScalar(L.len / d).add(this.v);
        this.streaks.add(this.w, this.v, L.width, L.color, L.intensity);
        if (now - s.lastTrail > 16) {
          s.lastTrail = now;
          if (L.smokeTrail) this.smoke.emit({ x: this.v.x, y: this.v.y, z: this.v.z, vy: 0.1, life: this.quality.rich ? 900 : 400, size0: 0.05, size1: 0.28, color0: 0xb8b2a8, color1: 0x77736c, alpha: 0.42, drag: 1 }, now);
          this.glow.emit({ x: this.v.x, y: this.v.y, z: this.v.z, life: 90, size0: L.width * 5, size1: L.width * 2, color0: L.color, alpha: 1.1 }, now);
        }
      }
    }
    this.shots = keep;
    this.landed = this.landed.filter((l) => now - l.at < 250);
    this.flashes = this.flashes.filter((f) => {
      const k = (now - f.born) / 140;
      if (k >= 1) return false;
      this.streaks.add(f.tail, f.head, 0.012 * (1 - k), 0xe8ffd0, 3);
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
