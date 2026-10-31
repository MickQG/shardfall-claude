/**
 * Render-only motion (R3D-10): pure helpers that turn interpolated positions into hull turning, gait, suspension and
 * banking. Nothing here feeds back into the simulation.
 */

const TAU = Math.PI * 2;

/** Signed shortest angle from `a` to `b`, in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Turn `cur` toward `target` by at most `maxStep` radians. */
export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = angleDiff(cur, target);
  return Math.abs(d) <= maxStep ? cur + d : cur + Math.sign(d) * maxStep;
}

/** Frame-rate independent approach of `cur` to `target` (rate per second). */
export function approach(cur: number, target: number, rate: number, dt: number): number {
  return target + (cur - target) * Math.exp(-rate * dt);
}

/** Gait phase in radians for a distance travelled and a stride (tiles per full cycle). */
export const gaitPhase = (distance: number, stride: number): number => (distance / Math.max(1e-6, stride)) * TAU;

export interface MotionState {
  heading: number;
  /** Travel since spawn, tiles. */
  dist: number;
  /** Smoothed ground speed, tiles per second. */
  speed: number;
  /** Smoothed acceleration, tiles per second squared. */
  accel: number;
  /** Smoothed turn rate, radians per second. */
  turnRate: number;
  /** 0 when standing, 1 at full stride: fades the gait in and out. */
  stride: number;
  /** Total turning since spawn, radians (left positive): tracks on the inside of a turn roll back against the outside. */
  turned: number;
}

export const restingMotion = (heading = 0): MotionState => ({ heading, dist: 0, speed: 0, accel: 0, turnRate: 0, stride: 0, turned: 0 });

/** Slower than this (tiles per second) is jitter, not travel: the hull keeps its heading. */
const MOVING = 0.12;

/** A drawn position chasing the simulation's: position and velocity, tiles and tiles per second. */
export interface Follow {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

/** How far behind (s) a drawn unit trails its simulated position (R3D-10): enough to hide uneven snapshot timing. */
export const SMOOTH_TIME = 0.09;

/**
 * Move a drawn position toward the target (`tx`, `tz`) with a critically damped spring, in place (R3D-10). Snapshots
 * arrive unevenly, so the interpolated position stalls and jumps; the spring rides through both. A target more than
 * `snap` tiles away is taken at once.
 */
export function follow(f: Follow, tx: number, tz: number, dt: number, smoothTime = SMOOTH_TIME, snap = 3): void {
  if (Math.hypot(tx - f.x, tz - f.z) > snap) {
    f.x = tx;
    f.z = tz;
    f.vx = f.vz = 0;
    return;
  }
  if (dt <= 0) return;
  const w = 2 / smoothTime;
  const k = w * dt;
  const e = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k);
  const ox = f.x - tx;
  const oz = f.z - tz;
  const sx = (f.vx + w * ox) * dt;
  const sz = (f.vz + w * oz) * dt;
  f.vx = (f.vx - w * sx) * e;
  f.vz = (f.vz - w * sz) * e;
  f.x = tx + (ox + sx) * e;
  f.z = tz + (oz + sz) * e;
}

/**
 * Advance one frame: `dx`, `dz` is this frame's displacement in tiles, `dt` seconds, `turn` the hull's maximum turn
 * rate. The hull turns toward the direction of travel; standing units keep their heading.
 */
export function stepMotion(m: MotionState, dx: number, dz: number, dt: number, turn: number): MotionState {
  if (dt <= 0) return m;
  const d = Math.hypot(dx, dz);
  const v = d / dt;
  const speed = approach(m.speed, v, 10, dt);
  const accel = approach(m.accel, (speed - m.speed) / dt, 6, dt);
  const heading = v > MOVING ? turnToward(m.heading, Math.atan2(dz, dx), turn * dt) : m.heading;
  const turnRate = approach(m.turnRate, angleDiff(m.heading, heading) / dt, 8, dt);
  const stride = approach(m.stride, v > MOVING ? 1 : 0, 8, dt);
  return { heading, dist: m.dist + d, speed, accel, turnRate, stride, turned: m.turned + angleDiff(m.heading, heading) };
}

export interface BodyPose {
  /** Nose up (+) or down (-), radians. */
  pitch: number;
  /** Lean to the right (+) or left (-), radians. */
  roll: number;
  /** Lift, tiles. */
  bob: number;
}

/**
 * Body pose by locomotion: vehicles squat on acceleration and dip on braking and roll out of turns; walkers bob with
 * each step; aircraft hover and bank into turns.
 */
export function bodyPose(kind: 'tracked' | 'wheeled' | 'walker' | 'air' | 'static', m: MotionState, phase: number, t: number, seed: number): BodyPose {
  const clamp = (x: number, a: number): number => Math.max(-a, Math.min(a, x));
  if (kind === 'tracked' || kind === 'wheeled') {
    const rumble = m.stride * (kind === 'tracked' ? 0.004 : 0.007) * Math.sin(t * 0.031 + seed);
    return { pitch: clamp(m.accel * 0.05, 0.08), roll: clamp(-m.turnRate * m.speed * (kind === 'wheeled' ? 0.07 : 0.04), 0.1), bob: rumble };
  }
  if (kind === 'walker') return { pitch: m.stride * 0.05, roll: m.stride * 0.03 * Math.sin(phase), bob: m.stride * 0.012 * Math.abs(Math.sin(phase)) };
  if (kind === 'air') return { pitch: clamp(-m.accel * 0.08, 0.2) - m.speed * 0.05, roll: clamp(m.turnRate * 0.35, 0.45), bob: Math.sin(t * 0.0017 + seed) * 0.04 };
  return { pitch: 0, roll: 0, bob: 0 };
}

/** Turret traverse, radians per second (R3D-9). */
export const TURRET_RATE = 7;
/** A turret fires once it points within this of its target, radians, or once it has waited this long, ms (R3D-9). */
export const ON_TARGET = 0.1;
export const MAX_AIM_WAIT = 300;

/** Whether a shot due `waited` ms ago may leave the barrel: weapons without a turret fire at once (R3D-9). */
export const readyToFire = (turreted: boolean, turretYaw: number, aim: number, waited: number): boolean =>
  !turreted || Math.abs(angleDiff(turretYaw, aim)) <= ON_TARGET || waited >= MAX_AIM_WAIT;

/** A shell's drawn flight after waiting for its turret, ms: shorter by the wait, so it still lands with the damage. */
export const flightAfterWait = (flightMs: number, waited: number): number => Math.max(60, flightMs - waited);

