/**
 * Render-only motion (R3D-10): pure helpers that turn interpolated positions into hull turning, gait, suspension and
 * banking. Nothing here feeds back into the simulation.
 */

import { unitDef } from '../data/defs';

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
export const SMOOTH_TIME = 0.12;

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
 * rate. The hull turns toward the direction of travel; standing units keep their heading. The gait fades in and out at
 * `blend` per second (a heavy walker's more slowly, HERO-6).
 */
export function stepMotion(m: MotionState, dx: number, dz: number, dt: number, turn: number, blend = 8): MotionState {
  if (dt <= 0) return m;
  const d = Math.hypot(dx, dz);
  const v = d / dt;
  const speed = approach(m.speed, v, 10, dt);
  const accel = approach(m.accel, (speed - m.speed) / dt, 6, dt);
  const heading = v > MOVING ? turnToward(m.heading, Math.atan2(dz, dx), turn * dt) : m.heading;
  const turnRate = approach(m.turnRate, angleDiff(m.heading, heading) / dt, 8, dt);
  const stride = approach(m.stride, v > MOVING ? 1 : 0, blend, dt);
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
 * A walker's own walk (HERO-6): how high its hull bobs (tiles, model scale) and how far it sways (radians of roll) in
 * time with its steps, and how fast (per second) its walk fades in and out as it starts and stops.
 */
export interface WalkStyle {
  bob: number;
  sway: number;
  blend: number;
}

/** 0 to 1 with zero slope at both ends. */
const ease = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

/**
 * Body pose by locomotion: vehicles squat on acceleration and dip on braking and roll out of turns; walkers bob with
 * each step; aircraft hover and bank into turns.
 */
export function bodyPose(kind: 'tracked' | 'wheeled' | 'walker' | 'air' | 'static', m: MotionState, phase: number, t: number, seed: number, walk?: WalkStyle): BodyPose {
  const clamp = (x: number, a: number): number => Math.max(-a, Math.min(a, x));
  if (kind === 'tracked' || kind === 'wheeled') {
    const rumble = m.stride * (kind === 'tracked' ? 0.004 : 0.007) * Math.sin(t * 0.031 + seed);
    return { pitch: clamp(m.accel * 0.05, 0.08), roll: clamp(-m.turnRate * m.speed * (kind === 'wheeled' ? 0.07 : 0.04), 0.1), bob: rumble };
  }
  if (kind === 'walker' && walk) {
    // Highest as each diagonal pair stands straight under it (phase 0 and pi), lowest as the pairs change over; the
    // sway follows the step, and both fade in and out with the walk, smoothly at either end (HERO-6).
    const e = ease(m.stride);
    return { pitch: e * 0.04, roll: e * walk.sway * Math.sin(phase), bob: e * walk.bob * Math.cos(phase) ** 2 };
  }
  if (kind === 'walker') return { pitch: m.stride * 0.04, roll: m.stride * 0.012 * Math.sin(phase), bob: m.stride * 0.006 * Math.abs(Math.sin(phase)) };
  if (kind === 'air') return { pitch: clamp(-m.accel * 0.08, 0.2) - m.speed * 0.05, roll: clamp(m.turnRate * 0.35, 0.45), bob: Math.sin(t * 0.0017 + seed) * 0.04 };
  return { pitch: 0, roll: 0, bob: 0 };
}

/** How long a hero's whole-body heave after a shot builds, then dies away, ms (HERO-4). */
export const HEAVE_RISE_MS = 90;
export const HEAVE_FALL_MS = 420;

/**
 * A hero's whole body answering its own shot (HERO-4), `sinceMs` after it fired: the Paladin rocks back on its legs
 * (nose up, hull squatting), the Dreadstrider lunges into its spit (head down, body dropping). Other weapons: none.
 */
export function heroHeave(look: string | undefined, sinceMs: number): BodyPose {
  if ((look !== 'heroCannon' && look !== 'heroAcid') || sinceMs < 0) return { pitch: 0, roll: 0, bob: 0 };
  const e = sinceMs < HEAVE_RISE_MS ? sinceMs / HEAVE_RISE_MS : Math.exp(-(sinceMs - HEAVE_RISE_MS) / HEAVE_FALL_MS);
  return look === 'heroCannon' ? { pitch: 0.16 * e, roll: 0, bob: -0.06 * e } : { pitch: -0.16 * e, roll: 0, bob: -0.07 * e };
}

/** Turret traverse, radians per second (R3D-9). */
export const TURRET_RATE = 7;
/** A turret fires once it points within this of its target, radians, or once it has waited this long, ms (R3D-9). */
export const ON_TARGET = 0.1;
export const MAX_AIM_WAIT = 300;

/** Whether a shot due `waited` ms ago may leave the barrel: once the gun points at the aim (`gunYaw`, see `gunYaw`), or
 * after waiting too long; `turreted: false` fires at once (squad members, which face their own targets) (R3D-9, AIM-1). */
export const readyToFire = (turreted: boolean, gunYaw: number, aim: number, waited: number): boolean =>
  !turreted || Math.abs(angleDiff(gunYaw, aim)) <= ON_TARGET || waited >= MAX_AIM_WAIT;

/**
 * Which way a lone walker's body faces (AIM-1): its target whenever it is shooting, walking or not, so guns fixed to the
 * body or on a short swivel point where the shots go; otherwise the way it walks.
 */
export const walkerFacing = (aiming: boolean, aim: number, heading: number): number => (aiming ? aim : heading);

/** Turret yaw relative to the body it is mounted on, wrapped to [-pi, pi] (AIM-1). */
export const turretOnBody = (turretYaw: number, bodyYaw: number): number => angleDiff(bodyYaw, turretYaw);

/**
 * The world yaw the gun actually points along (AIM-1): the body's yaw plus the turret's turn on it, limited to the
 * turret's reach (`Infinity` for a full turret, 0 for a gun fixed to the body).
 */
export const gunYaw = (bodyYaw: number, turretYaw: number, reach: number): number => {
  const rel = turretOnBody(turretYaw, bodyYaw);
  return bodyYaw + Math.max(-reach, Math.min(reach, rel));
};

/** The howitzer's barrel counts as raised from this elevation (0..1), and a shot is held for it at most this long, ms: the rise itself plus a beat (R3D-32). */
export const ELEV_READY = 0.97;
export const MAX_ELEV_WAIT = 700;
/** Whether a howitzer's shot due `waited` ms ago may show its shell, flash and recoil: only once the barrel has finished elevating, or after a bounded wait (R3D-32). Other guns are never held. */
export const elevationReady = (howitzer: boolean, elev: number, waited: number): boolean => !howitzer || elev >= ELEV_READY || waited >= MAX_ELEV_WAIT;

/** A shell's drawn flight after waiting for its turret, ms: shorter by the wait, so it still lands with the damage. */
export const flightAfterWait = (flightMs: number, waited: number): number => Math.max(60, flightMs - waited);


/** The arc of a pod missile's flight, as a share of the distance flown (HERO-7). */
export const MISSILE_ARC = 0.6;
/** How long the Paladin's pods take to open before the first missile leaves, and to close after the last, ms (HERO-7). */
export const POD_OPEN_MS = 100;
export const POD_CLOSE_MS = 350;

/** A point `k` (0..1) of the way from `from` to `to` on an arc rising `4 * arc * distance * k * (1 - k)` above the line. */
export function arcPoint(from: readonly [number, number, number], to: readonly [number, number, number], k: number, arc: number): [number, number, number] {
  const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k + 4 * arc * dist * k * (1 - k), from[2] + (to[2] - from[2]) * k];
}

/** A salvo's timing: `count` missiles `gapMs` apart, each in the air `flightMs`, the first leaving `POD_OPEN_MS` after the pods start to open. */
export interface Salvo {
  count: number;
  gapMs: number;
  flightMs: number;
}

/** When missile `i` of a salvo leaves, ms after the pods start to open. */
export const missileLaunchAt = (v: Salvo, i: number): number => POD_OPEN_MS + i * v.gapMs;

/** When missile `i` lands, ms after the pods start to open: where its impact flash begins. */
export const missileLandsAt = (v: Salvo, i: number): number => missileLaunchAt(v, i) + v.flightMs;

/**
 * How far the Paladin's pods are open, 0..1, `sinceMs` after the salvo was ordered (HERO-7): they swing open in
 * `POD_OPEN_MS`, stay open while the missiles leave, then fold shut over `POD_CLOSE_MS`. A pure function of time.
 */
export function podOpen(sinceMs: number, v: Salvo): number {
  if (sinceMs <= 0) return 0;
  if (sinceMs < POD_OPEN_MS) return sinceMs / POD_OPEN_MS;
  const open = missileLaunchAt(v, v.count - 1);
  if (sinceMs <= open) return 1;
  return Math.max(0, 1 - (sinceMs - open) / POD_CLOSE_MS);
}

/**
 * Where each missile of a salvo is `sinceMs` after it was ordered (HERO-7): null before it leaves or once it has
 * landed, else the point on its arc. A pure function of time.
 */
export function missilePositions(from: readonly [number, number, number], to: readonly [number, number, number], sinceMs: number, v: Salvo, arc = MISSILE_ARC): ([number, number, number] | null)[] {
  const out: ([number, number, number] | null)[] = [];
  for (let i = 0; i < v.count; i++) {
    const k = (sinceMs - missileLaunchAt(v, i)) / v.flightMs;
    out.push(k < 0 || k >= 1 ? null : arcPoint(from, to, k, arc));
  }
  return out;
}

/** The salvo timing of a unit kind's missile pods (from its second weapon), at `msPerTick`; one missile with no gap if it has none. */
export function salvoOf(kind: string, msPerTick: number): Salvo {
  const w = unitDef(kind).weapon2;
  return { count: w?.salvo?.count ?? 1, gapMs: (w?.salvo?.gap ?? 0) * msPerTick, flightMs: Math.max(80, (w?.flight ?? 1) * msPerTick - POD_OPEN_MS) };
}

/** Move `v` toward `target` at a steady rate: `riseMs` to cover 0..1 going up, `fallMs` going down; `dt` in seconds. */
export function slew(v: number, target: number, dt: number, riseMs: number, fallMs: number): number {
  const step = (dt * 1000) / (target > v ? riseMs : fallMs);
  return target > v ? Math.min(target, v + step) : Math.max(target, v - step);
}

/** How long a harvesting head takes to lower to the ground or lift clear, ms (R3D-30). */
export const HEAD_MS = 400;
/** The howitzer's barrel: up over 0.6 s, back into its lock over 1 s, kept raised for 3 s after a shot (R3D-32). */
export const ELEV_UP_MS = 600;
export const ELEV_DOWN_MS = 1000;
export const ELEV_HOLD_MS = 3000;
export const elevTarget = (hasTarget: boolean, sinceFireMs: number): number => (hasTarget || sinceFireMs < ELEV_HOLD_MS ? 1 : 0);

/** A fast scout car's calm ride over the ground (R3D-33): a little bob, pitch and roll that grow with speed (`stride` 0..1). */
export function rideMotion(ride: number, stride: number, t: number, seed: number): BodyPose {
  const k = ride * stride;
  return { pitch: k * 0.5 * Math.sin(t * 0.0053 + seed), roll: k * Math.sin(t * 0.0037 + seed * 2), bob: k * 0.3 * Math.abs(Math.sin(t * 0.0079 + seed)) };
}

/** The hauler puffs exhaust when its throttle opens past this acceleration, tiles/s², and no more often than this, ms (R3D-30). */
export const HAULER_PUFF_ACCEL = 0.6;
export const HAULER_PUFF_MS = 450;

/** The hauler's stop (R3D-30): the nose dips once and the suspension settles, a damped spring, never a bounce. */
export interface Settle {
  /** Body pitch added by the settle, radians (negative is nose down, as braking in `bodyPose`). */
  pitch: number;
  vel: number;
  /** Set once the drawn speed has been high enough to count as driving; a stop then fires the dip once. */
  armed: boolean;
}
export const restingSettle = (): Settle => ({ pitch: 0, vel: 0, armed: false });
/** Drawn speed (tiles per second) above which the hauler counts as driving, and below which it has stopped. */
export const SETTLE_DRIVE = 0.5;
export const SETTLE_STOP = 0.15;
/** The suspension: natural frequency rad/s, damping ratio (about 0.75 overshoots by under 3%), and the impulse that makes a dip of about 2.6 degrees. */
const SETTLE_W = 14;
const SETTLE_ZETA = 0.75;
const SETTLE_KICK = 1.4;
/**
 * Advance the stop settle by `dt` seconds with the drawn `speed`. `quiet` (mining, docked) arms nothing and fires
 * nothing, and the spring just settles. Pure.
 */
export function settleStep(s: Settle, speed: number, dt: number, quiet = false): Settle {
  let { pitch, vel, armed } = s;
  if (!quiet && speed > SETTLE_DRIVE) armed = true;
  if (armed && (quiet || speed < SETTLE_STOP)) {
    if (!quiet) vel -= SETTLE_KICK;
    armed = false;
  }
  // Semi-implicit Euler in small steps keeps it stable at any frame rate.
  const n = Math.max(1, Math.ceil(dt / 0.004));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    vel += (-SETTLE_W * SETTLE_W * pitch - 2 * SETTLE_ZETA * SETTLE_W * vel) * h;
    pitch += vel * h;
  }
  return { pitch, vel, armed };
}
