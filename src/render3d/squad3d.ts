/**
 * Living squads (R3D-15): render-only movement of each member of a squad around the squad's simulated position. The
 * simulation knows one unit; here every member walks on its own: a loose formation that shifts while marching, short
 * strolls and glances while idle, a firing line with sidesteps and kneeling in combat. Pure apart from mutating the
 * members passed in; randomness is a hash of the unit's seed, so the same squad behaves the same way every run.
 */
import { angleDiff, approach, restingMotion, stepMotion, turnToward, type MotionState } from './motion';

/** The furthest a member strays from the squad's position, tiles. */
export const SQUAD_SPREAD = 0.45;

export interface Member {
  /** World position, tiles. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Where the member is heading, relative to the squad's position (world axes), tiles. */
  gx: number;
  gz: number;
  /** When (ms) the member picks a new spot, and how many it has picked. */
  next: number;
  picks: number;
  /** What the squad was doing when the spot was picked: a change picks a new one at once. */
  mode: Mode | '';
  motion: MotionState;
  /** Facing (world yaw) and where an idle member looks. */
  yaw: number;
  look: number;
  /** 0 standing, 1 kneeling. */
  crouch: number;
  /** The squad's velocity last frame, to feel it speed up or slow down. */
  svx: number;
  svz: number;
}

export interface SquadFrame {
  /** The squad's (smoothed) position and velocity, tiles and tiles per second. */
  x: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  /** Firing at something, and the direction it is in. */
  aiming: boolean;
  aim: number;
  /** Standing members (the first `alive` of the list). */
  alive: number;
  /** Clock, ms, and frame time, s. */
  t: number;
  dt: number;
  seed: number;
  /** Whether a member may stand at a world point (same ground as the squad, not water). */
  free: (x: number, z: number) => boolean;
}

/** A hash of (seed, a, b) in [0, 1). */
export function rand(seed: number, a: number, b: number): number {
  let h = Math.imul(seed | 0, 374761393) ^ Math.imul(a | 0, 668265263) ^ Math.imul((b | 0) + 1, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export type Mode = 'march' | 'idle' | 'fire';

/** Formation slot of member `i` of `n`, in the squad's own frame (x forward, z right), tiles. */
export function slot(mode: Mode, i: number, n: number): [number, number] {
  if (n <= 1) return [0, 0];
  if (mode === 'fire') {
    // A ragged firing line across the line of fire.
    const lateral = (i - (n - 1) / 2) * 0.3;
    return [i % 2 ? -0.08 : 0.04, lateral];
  }
  // A loose wedge: the first member leads, the others trail to either side.
  if (i === 0) return [0.14, 0];
  const side = i % 2 ? 1 : -1;
  const row = Math.ceil(i / 2);
  return [0.14 - row * 0.24, side * 0.2 * row];
}

const rotate = (x: number, z: number, yaw: number): [number, number] => [x * Math.cos(yaw) - z * Math.sin(yaw), x * Math.sin(yaw) + z * Math.cos(yaw)];

/** A new member standing at its marching slot. */
export function newMember(f: Pick<SquadFrame, 'x' | 'z' | 'heading' | 'seed'>, i: number, n: number): Member {
  const [sx, sz] = rotate(...slot('march', i, n), f.heading);
  return { x: f.x + sx, z: f.z + sz, vx: 0, vz: 0, gx: sx, gz: sz, next: 0, picks: 0, mode: '', motion: restingMotion(f.heading), yaw: f.heading, look: f.heading, crouch: 0, svx: 0, svz: 0 };
}

/** Whether member `i` of a squad kneels to fire (about half of them do). */
export const kneels = (seed: number, i: number): boolean => rand(seed, i, 977) < 0.5;

/** Advance the standing members one frame. */
export function stepSquad(members: Member[], f: SquadFrame): void {
  const speed = Math.hypot(f.vx, f.vz);
  const mode: Mode = speed > 0.15 ? 'march' : f.aiming ? 'fire' : 'idle';
  const n = Math.min(f.alive, members.length);
  // Firing lines face the target; formations face the way the squad goes.
  const frame = mode === 'fire' ? f.aim : f.heading;
  for (let i = 0; i < n; i++) {
    const m = members[i]!;
    const r = (k: number): number => rand(f.seed, i * 31 + k, m.picks);
    if (f.t >= m.next || m.mode !== mode) {
      // A new spot: the member's slot, nudged by an amount that suits what the squad is doing.
      m.mode = mode;
      const [sx, sz] = slot(mode, i, n);
      // Kneeling riflemen hold their spot; the others sidestep between bursts.
      const holds = mode === 'fire' && kneels(f.seed, i);
      const wander = mode === 'idle' ? 0.1 : mode === 'fire' ? (holds ? 0.02 : 0.06) : 0.04;
      const a = r(1) * Math.PI * 2;
      const d = Math.sqrt(r(2)) * wander;
      let [gx, gz] = rotate(sx + Math.cos(a) * d, sz + Math.sin(a) * d, frame);
      const len = Math.hypot(gx, gz);
      if (len > SQUAD_SPREAD) [gx, gz] = [(gx / len) * SQUAD_SPREAD, (gz / len) * SQUAD_SPREAD];
      // Never onto a cliff edge or into water: fall back toward the squad's own spot.
      if (!f.free(f.x + gx, f.z + gz)) [gx, gz] = f.free(f.x + gx * 0.4, f.z + gz * 0.4) ? [gx * 0.4, gz * 0.4] : [0, 0];
      m.gx = gx;
      m.gz = gz;
      m.look = f.heading + (r(3) - 0.5) * 2.4;
      const [lo, hi] = mode === 'idle' ? [4500, 9000] : mode === 'fire' ? (holds ? [5000, 9000] : [1800, 3600]) : [1200, 2400];
      m.next = f.t + lo + r(4) * (hi - lo);
      m.picks++;
    }
    // Steer to the spot, keeping up with the squad and running to catch up when left behind.
    const ex = f.x + m.gx - m.x;
    const ez = f.z + m.gz - m.z;
    const err = Math.hypot(ex, ez);
    if (err > 2) {
      // Far off (the squad jumped, or came out of the fog): appear at the spot.
      m.x += ex;
      m.z += ez;
      m.vx = m.vz = 0;
    } else {
      const gain = mode === 'idle' ? 1.4 : 3;
      const rate = 4 * gain;
      // Keep pace with the squad (its velocity, and its speeding up or slowing down, which would otherwise carry the
      // member past its spot when the squad stops) and close the gap to the spot.
      // Velocity follows the steering four times faster than the steering closes the gap: critically damped, so a
      // member slows into its spot and never sails past it and comes back.
      const k = 1 - Math.exp(-rate * f.dt);
      // The steering that brings this frame's velocity exactly to the squad's, whatever its last change.
      const px = k > 0 ? m.svx + (f.vx - m.svx) / k : f.vx;
      const pz = k > 0 ? m.svz + (f.vz - m.svz) / k : f.vz;
      let wx = px + ex * gain;
      let wz = pz + ez * gain;
      // The cap scales with what keeping pace asks for, so a squad that stops sharply (R3D-10) is still followed exactly.
      const top = Math.max(0.4, speed * 1.35, Math.hypot(px, pz) * 1.35);
      const w = Math.hypot(wx, wz);
      if (w > top) [wx, wz] = [(wx / w) * top, (wz / w) * top];
      if (err < 0.02 && speed < 0.05) [wx, wz] = [0, 0];
      m.vx += (wx - m.vx) * k;
      m.vz += (wz - m.vz) * k;
    }
    m.svx = f.vx;
    m.svz = f.vz;
    const dx = m.vx * f.dt;
    const dz = m.vz * f.dt;
    m.x += dx;
    m.z += dz;
    m.motion = stepMotion(m.motion, dx, dz, f.dt, 9);
    // Face the target when firing and nearly still, the way of travel when walking, else glance around.
    const still = m.motion.speed < 0.2;
    const want = f.aiming && still ? f.aim : !still ? m.motion.heading : m.look;
    m.yaw = turnToward(m.yaw, want, (f.aiming ? 9 : still ? 2.5 : 8) * f.dt);
    m.crouch = approach(m.crouch, f.aiming && still && kneels(f.seed, i) && Math.abs(angleDiff(m.yaw, f.aim)) < 0.5 ? 1 : 0, 7, f.dt);
  }
}
