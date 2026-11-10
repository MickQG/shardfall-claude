import * as THREE from 'three';
import type { ParticleSpec } from './fx3d';

/**
 * GPU particles (R3D-26). Every particle is one vertex in a preallocated interleaved buffer: its origin, birth time,
 * initial velocity, drag, gravity, life, sizes and colours. The vertex shader works out where it is, how big and what
 * colour from the time uniform alone, so the CPU never touches a live particle: it only writes the attributes of the
 * particles emitted this frame into a ring buffer (and uploads just that range). When the ring is full the oldest are
 * overwritten. Smoke is alpha-blended, fire and glow additive; each layer is one draw call.
 */

/** Floats per particle: origin 3, time 4 (birth, life, gravity, alpha), velocity 4 (xyz, drag), shape 4 (size0, size1, seed, wind), colours 3 + 3. */
export const STRIDE = 21;

/** Budgets: High and Low (R3D-26). */
export const BUDGET = {
  high: { smoke: 8192, glow: 4096 },
  low: { smoke: 1536, glow: 768 },
} as const;

/** Slow wind that carries smoke (tiles per second squared of drift growth), shared by the shader and its CPU mirror. */
export const WIND = { x: 0.1, z: 0.05 };

/**
 * Where a particle is `t` seconds after it was born: the closed form of velocity damping plus gravity (g positive pulls
 * down, negative is buoyancy) and a wind drift for smoke. This is the shader's formula in plain TypeScript, for tests.
 *   v(t) = (v0 + g/k) e^(-kt) - g/k    p(t) = o + (v0 + g/k)(1 - e^(-kt))/k - g t/k
 */
export function particlePosition(o: readonly [number, number, number], v: readonly [number, number, number], drag: number, gravity: number, t: number, wind = 0, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const small = drag < 0.002;
  const e = small ? t - 0.5 * drag * t * t : (1 - Math.exp(-drag * t)) / drag;
  out[0] = o[0] + v[0] * e + WIND.x * wind * 0.5 * t * t;
  out[2] = o[2] + v[2] * e + WIND.z * wind * 0.5 * t * t;
  out[1] = Math.max(0.01, o[1] + v[1] * e + (small ? -0.5 * gravity * t * t : (gravity / drag) * (e - t)));
  return out;
}

/** Opacity over a particle's life `k` in 0..1: a quick fade in, a long fade out. */
export function particleFade(k: number): number {
  return Math.min(1, k * 12) * (1 - k) ** 1.3;
}

/**
 * The ring of slots (R3D-26): the next slot to write, how many have ever been filled (the draw range), which slots are
 * new since the last upload, and a cheap estimate of how many are still alive (for the busy signal).
 */
export class ParticleRing {
  private head = 0;
  private filledN = 0;
  private dirtyStart = 0;
  private dirtyN = 0;
  /** Emission buckets of half a second: how many were born, and when the last of them dies. */
  private bucketId = new Int32Array(40).fill(-1);
  private bucketCount = new Int32Array(40);
  private bucketUntil = new Float64Array(40);
  /** The upload ranges `takeDirty` found. */
  private rs = [0, 0];
  private rn = [0, 0];

  constructor(private cap: number) {}

  get capacity(): number {
    return this.cap;
  }

  /** Slots in use so far, which is the number to draw. */
  get filled(): number {
    return this.filledN;
  }

  /** Change the budget (the quality preset changed): slots beyond it are dropped. */
  setCapacity(n: number): void {
    this.cap = n;
    this.head %= n;
    this.filledN = Math.min(this.filledN, n);
    this.dirtyN = 0;
  }

  /** The slot for a new particle; once full this is the oldest one. */
  next(now: number, lifeMs: number): number {
    const slot = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.filledN < this.cap) this.filledN++;
    if (this.dirtyN === 0) this.dirtyStart = slot;
    if (this.dirtyN < this.cap) this.dirtyN++;
    const b = Math.floor(now / 500);
    const i = ((b % 40) + 40) % 40;
    if (this.bucketId[i] !== b) {
      this.bucketId[i] = b;
      this.bucketCount[i] = 0;
      this.bucketUntil[i] = 0;
    }
    this.bucketCount[i]!++;
    if (now + lifeMs > (this.bucketUntil[i] as number)) this.bucketUntil[i] = now + lifeMs;
    return slot;
  }

  /** Particles still alive, estimated from the emission buckets; never above the budget. */
  live(now: number): number {
    let n = 0;
    for (let i = 0; i < 40; i++) if ((this.bucketUntil[i] as number) > now) n += this.bucketCount[i] as number;
    return Math.min(n, this.filledN);
  }

  /** Collect the slot ranges written since the last call (one, or two when the ring wrapped); returns how many. */
  takeDirty(): number {
    const n = this.dirtyN;
    this.dirtyN = 0;
    if (n === 0) return 0;
    if (this.dirtyStart + n <= this.cap) {
      this.rs[0] = this.dirtyStart;
      this.rn[0] = n;
      return 1;
    }
    this.rs[0] = this.dirtyStart;
    this.rn[0] = this.cap - this.dirtyStart;
    this.rs[1] = 0;
    this.rn[1] = n - this.rn[0];
    return 2;
  }

  rangeStart(i: number): number {
    return this.rs[i] as number;
  }

  rangeLength(i: number): number {
    return this.rn[i] as number;
  }
}

const VERT = /* glsl */ `
attribute vec4 aTime;
attribute vec4 aVel;
attribute vec4 aShape;
attribute vec3 aC0;
attribute vec3 aC1;
uniform float uTime;
uniform float scale;
uniform vec2 uWind;
varying vec4 vColor;
varying float vSeed;
varying vec2 vXZ;
void main() {
  float t = uTime - aTime.x;
  float k = t / aTime.y;
  vSeed = aShape.z;
  vColor = vec4(0.0);
  vXZ = vec2(0.0);
  if (t < 0.0 || k >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float d = aVel.w;
  float g = aTime.z;
  float e = d < 0.002 ? t - 0.5 * d * t * t : (1.0 - exp(-d * t)) / d;
  vec3 p = position + aVel.xyz * e;
  p.y += d < 0.002 ? -0.5 * g * t * t : (g / d) * (e - t);
  p.xz += uWind * (aShape.w * 0.5 * t * t);
  p.y = max(p.y, 0.01);
  float size = mix(aShape.x, aShape.y, k);
  float fade = min(1.0, k * 12.0) * pow(1.0 - k, 1.3);
  float a = aTime.w * fade;
  #ifdef SMOKE
    a *= 0.45 + 0.55 * smoothstep(0.0, 0.3, p.y / max(size, 0.05));
  #endif
  // The fade's tail is invisible long before the particle ends: do not rasterise it (R3D-29).
  if (a < 0.008) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  vColor = vec4(mix(aC0, aC1, k), a);
  vXZ = p.xz;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = min(size * scale / max(0.1, -mv.z), 900.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uHideMap;
uniform vec2 uHideSize;
varying vec4 vColor;
varying float vSeed;
varying vec2 vXZ;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r >= 1.0) discard;
  float a;
  vec3 rgb = vColor.rgb;
  #ifdef SMOKE
    // A lumpy, soft puff: an uneven outline, soft edges, mottled density and a sphere's shading from the upper left.
    float ang = atan(p.y, p.x);
    float lump = 1.0 + 0.15 * sin(ang * 3.0 + vSeed * 31.0) + 0.09 * sin(ang * 5.0 - vSeed * 17.0);
    float rr = r * lump;
    a = 1.0 - smoothstep(0.25, 1.0, rr);
    a *= 0.9 + 0.25 * sin(p.x * 6.0 + vSeed * 50.0) * sin(p.y * 5.0 - vSeed * 40.0);
    vec3 n = vec3(p, sqrt(max(0.0, 1.0 - r * r)));
    rgb *= 0.62 + 0.55 * max(dot(n, normalize(vec3(-0.45, 0.7, 0.55))), 0.0);
  #else
    a = pow(1.0 - r, 1.6);
  #endif
  a *= vColor.a;
  if (a < 0.003) discard;
  // Over unexplored tiles the particle fades out with the rest of the world (R3D-17).
  float hidden = smoothstep(0.62, 0.9, texture2D(uHideMap, vec2(vXZ.x / uHideSize.x, 1.0 - vXZ.y / uHideSize.y)).g);
  a *= 1.0 - hidden;
  if (a < 0.003) discard;
  gl_FragColor = vec4(rgb, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** The unexplored mask's shared uniform objects, so a particle layer follows the map's fog without copies. */
export interface HideUniforms {
  uHideMap: { value: THREE.Texture };
  uHideSize: { value: THREE.Vector2 };
}

/** One GPU particle layer: a fixed-size ring of points, drawn in one call. */
export class GpuParticleLayer {
  readonly points: THREE.Points;
  readonly material: THREE.ShaderMaterial;
  private readonly ring: ParticleRing;
  private readonly data: Float32Array;
  private readonly buffer: THREE.InterleavedBuffer;
  private readonly c = new THREE.Color();
  private readonly time = { value: 0 };

  /** Smoke drifts with the wind; fire and glow do not. */
  private readonly wind: number;

  constructor(readonly maxCap: number, glow: boolean) {
    this.wind = glow ? 0 : 1;
    this.ring = new ParticleRing(maxCap);
    this.data = new Float32Array(maxCap * STRIDE);
    this.buffer = new THREE.InterleavedBuffer(this.data, STRIDE).setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    g.setAttribute('aTime', new THREE.InterleavedBufferAttribute(this.buffer, 4, 3));
    g.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buffer, 4, 7));
    g.setAttribute('aShape', new THREE.InterleavedBufferAttribute(this.buffer, 4, 11));
    g.setAttribute('aC0', new THREE.InterleavedBufferAttribute(this.buffer, 3, 15));
    g.setAttribute('aC1', new THREE.InterleavedBufferAttribute(this.buffer, 3, 18));
    g.setDrawRange(0, 0);
    const none = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    none.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 600 }, uTime: this.time, uWind: { value: new THREE.Vector2(WIND.x, WIND.z) }, uHideMap: { value: none }, uHideSize: { value: new THREE.Vector2(1, 1) } },
      defines: glow ? {} : { SMOKE: '' },
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

  /** Follow the map's fog texture (the unexplored mask's uniforms). */
  useHide(u: HideUniforms): void {
    this.material.uniforms.uHideMap = u.uHideMap;
    this.material.uniforms.uHideSize = u.uHideSize;
  }

  get capacity(): number {
    return this.ring.capacity;
  }

  setCapacity(n: number): void {
    this.ring.setCapacity(Math.min(n, this.maxCap));
    this.points.geometry.setDrawRange(0, this.ring.filled);
  }

  /** Show one particle's worth of draw range (for shader compilation), or restore the real range. */
  warm(on: boolean): void {
    this.points.geometry.setDrawRange(0, on ? 1 : this.ring.filled);
  }

  /** Particles alive now (an estimate). */
  live(now: number): number {
    return this.ring.live(now);
  }

  /** Write one particle's attributes into the ring; nothing else is kept on the CPU. */
  emit(p: ParticleSpec, now: number): void {
    const delay = p.delay ?? 0;
    const i = this.ring.next(now, p.life + delay);
    const d = this.data;
    const o = i * STRIDE;
    d[o] = p.x;
    d[o + 1] = p.y;
    d[o + 2] = p.z;
    d[o + 3] = (now + delay) / 1000;
    d[o + 4] = p.life / 1000;
    d[o + 5] = p.gravity ?? 0;
    d[o + 6] = p.alpha;
    d[o + 7] = p.vx ?? 0;
    d[o + 8] = p.vy ?? 0;
    d[o + 9] = p.vz ?? 0;
    d[o + 10] = p.drag ?? 0;
    d[o + 11] = p.size0;
    d[o + 12] = p.size1;
    d[o + 13] = (Math.imul(i, 2654435761) >>> 8) / 16777216;
    d[o + 14] = this.wind;
    this.c.setHex(p.color0);
    d[o + 15] = this.c.r;
    d[o + 16] = this.c.g;
    d[o + 17] = this.c.b;
    this.c.setHex(p.color1 ?? p.color0);
    d[o + 18] = this.c.r;
    d[o + 19] = this.c.g;
    d[o + 20] = this.c.b;
  }

  /** Set the time uniform and upload what was written since last frame. */
  update(now: number): void {
    this.time.value = now / 1000;
    const n = this.ring.takeDirty();
    if (n === 0) return;
    this.buffer.clearUpdateRanges();
    for (let i = 0; i < n; i++) this.buffer.addUpdateRange(this.ring.rangeStart(i) * STRIDE, this.ring.rangeLength(i) * STRIDE);
    this.buffer.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.ring.filled);
  }
}
