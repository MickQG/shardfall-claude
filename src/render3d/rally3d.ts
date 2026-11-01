import * as THREE from 'three';

/**
 * The rally point marker (R3D-21): while a production building is selected, a team-coloured flag stands at its rally
 * point over a slowly pulsing ring, joined to the building by a broad line of dashes that march toward the flag. When
 * the rally point moves, the flag drops in and the ring pulses wide, so the order visibly took.
 */

/** Spacing between dashes, tiles, and how fast they march toward the flag, tiles per second. */
export const DASH_GAP = 0.36;
export const DASH_SPEED = 0.9;
/** The most dashes drawn (a line across the whole map is cut short at the building end). */
export const MAX_DASHES = 96;
/** Height of the flag above the ground, tiles (pole and cap): small, so it marks the spot without hiding it. */
export const FLAG_HEIGHT = 0.75;
/** How long the flag takes to drop in, and the ring's wide pulse lasts, ms. */
export const DROP_MS = 260;
export const PULSE_MS = 520;

/**
 * Dash centres along the line from `from` to `to` (tiles, x and z) at time `t` ms, marching toward `to`. Dashes stop
 * short of the flag so they do not cover it.
 */
export function rallyDashes(from: { x: number; z: number }, to: { x: number; z: number }, t: number): { x: number; z: number }[] {
  const len = Math.hypot(to.x - from.x, to.z - from.z);
  const end = len - 0.3;
  if (end <= 0) return [];
  const ux = (to.x - from.x) / len;
  const uz = (to.z - from.z) / len;
  const phase = ((t / 1000) * DASH_SPEED) % DASH_GAP;
  const out: { x: number; z: number }[] = [];
  // Count back from the flag so the dashes nearest it are always drawn.
  for (let i = Math.floor((end - phase) / DASH_GAP); i >= 0 && out.length < MAX_DASHES; i--) {
    const s = phase + i * DASH_GAP;
    out.push({ x: from.x + ux * s, z: from.z + uz * s });
  }
  return out;
}

/** The flag's height above the ground `age` ms after the rally point moved (it falls in with a little bounce). */
export function flagDrop(age: number): number {
  if (age >= DROP_MS || age < 0) return 0;
  const k = age / DROP_MS;
  return 1.3 * (1 - k) * (1 - k);
}

/** The ring's scale: a slow breath, plus a wide pulse just after the rally point moved. */
export function ringScale(age: number, t: number): number {
  const burst = age >= 0 && age < PULSE_MS ? 1.4 * (1 - age / PULSE_MS) : 0;
  return 1 + 0.12 * Math.sin(t * 0.005) + burst;
}

export class RallyMarker {
  readonly root = new THREE.Group();
  private dashes: THREE.InstancedMesh;
  private flag = new THREE.Group();
  private cloth: THREE.Mesh;
  private ring: THREE.Mesh;
  private teamMats: THREE.MeshBasicMaterial[];
  private key = '';
  private movedAt = -1e9;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor() {
    const team = (opacity = 1): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false, side: THREE.DoubleSide });
    const dashMat = team(0.85);
    const clothMat = team();
    const ringMat = team(0.7);
    this.teamMats = [dashMat, clothMat, ringMat];
    this.dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.17, 0.025, 0.07), dashMat, MAX_DASHES);
    this.dashes.frustumCulled = false;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xd8dde3 }));
    pole.position.y = 0.45;
    // A swallow-tailed pennant on the pole.
    const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.42, 0.02), new THREE.Vector2(0.3, -0.12), new THREE.Vector2(0.42, -0.26), new THREE.Vector2(0, -0.24)]);
    this.cloth = new THREE.Mesh(new THREE.ShapeGeometry(shape), clothMat);
    this.cloth.position.set(0.018, 0.88, 0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe9a0, toneMapped: false }));
    cap.position.y = 0.92;
    this.flag.add(pole, this.cloth, cap);
    this.flag.scale.setScalar(FLAG_HEIGHT / 0.95); // small: it marks the spot without covering what stands there
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 40), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.root.add(this.dashes, this.flag, this.ring);
    this.root.visible = false;
  }

  /** Show everything (one dash included) for compiling shader programs while loading, then hide it again. */
  warm(on: boolean): void {
    this.root.visible = on;
    this.dashes.count = on ? 1 : 0;
    if (!on) this.key = '';
  }

  /** Show the marker from `from` to `to` (tile coordinates; `to` is the rally tile's centre), or hide it with null. */
  update(line: { from: { tx: number; ty: number }; to: { tx: number; ty: number } } | null, color: number, t: number, groundAt: (x: number, z: number) => number): void {
    if (!line) {
      this.root.visible = false;
      this.key = '';
      return;
    }
    const to = { x: line.to.tx, z: line.to.ty };
    const from = { x: line.from.tx, z: line.from.ty };
    const key = `${to.x},${to.z}`;
    // A new rally point (not just selecting the building again) makes the flag drop in.
    if (this.key && key !== this.key) this.movedAt = t;
    this.key = key;
    this.root.visible = true;
    for (const mat of this.teamMats) mat.color.setHex(color);
    const age = t - this.movedAt;
    const gy = groundAt(to.x, to.z);
    this.flag.position.set(to.x, gy + flagDrop(age), to.z);
    this.cloth.rotation.y = 0.35 * Math.sin(t * 0.004) + 0.8; // the pennant flutters, turned to face the camera
    this.ring.position.set(to.x, gy + 0.03, to.z);
    this.ring.scale.setScalar(ringScale(age, t));
    const dashes = rallyDashes(from, to, t);
    this.q.setFromAxisAngle(this.up, -Math.atan2(to.z - from.z, to.x - from.x));
    dashes.forEach((d, i) => {
      this.m.compose(this.p.set(d.x, groundAt(d.x, d.z) + 0.04, d.z), this.q, this.one);
      this.dashes.setMatrixAt(i, this.m);
    });
    this.dashes.count = dashes.length;
    this.dashes.instanceMatrix.needsUpdate = true;
  }
}
