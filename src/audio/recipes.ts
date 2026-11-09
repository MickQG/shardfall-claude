import type { Faction } from '../data/defs';
import { Rng } from '../sim';

/**
 * Sound recipes (AUD-5, AUD-6): every effect is data describing layers (an oscillator or filtered noise, its pitch
 * sweep, filters, envelope and level), and the engine turns them into Web Audio nodes. Everything here is pure, so the
 * recipes, the variation, the voice budget, the pan and the mixes can be tested without any audio device.
 */

export type WorldName = 'zap' | 'rocket' | 'cannon' | 'slash' | 'laser' | 'boom' | 'pop' | 'bigboom' | 'crunch' | 'sw_launch' | 'sw_strike';
export type UiName = 'hover' | 'click' | 'built' | 'ready' | 'alert' | 'deny' | 'ack' | 'ackAttack';
export type SoundName = WorldName | UiName;

export const WORLD_SOUNDS: readonly WorldName[] = ['zap', 'rocket', 'cannon', 'slash', 'laser', 'boom', 'pop', 'bigboom', 'crunch', 'sw_launch', 'sw_strike'];
export const UI_SOUNDS: readonly UiName[] = ['hover', 'click', 'built', 'ready', 'alert', 'deny', 'ack', 'ackAttack'];

export interface FilterSpec {
  type: 'bandpass' | 'lowpass' | 'highpass';
  f: number;
  /** End frequency of an exponential sweep over the layer's life. */
  to?: number;
  q: number;
}

export interface Layer {
  /** The sharp attack, the body, or the tail. */
  role: 'attack' | 'body' | 'tail';
  src: 'osc' | 'noise';
  wave?: 'sine' | 'square' | 'sawtooth' | 'triangle';
  /** Oscillator pitch, Hz, and where it slides to over the layer's life. */
  freq?: number;
  to?: number;
  /** Extra partials as ratios of `freq`: whole numbers are harmonic, others ring like metal. */
  ratios?: readonly number[];
  /** One filter, or several in parallel (formants for noise). */
  filters?: readonly FilterSpec[];
  /** Start (s after the sound's start), length (s), peak level. */
  at: number;
  dur: number;
  gain: number;
  attack?: number;
  /** Pitch wobble (a gurgle): rate Hz, depth Hz. */
  wobble?: { rate: number; depth: number };
  /** Amplitude trill (a chitter): rate Hz. */
  trill?: number;
}

export interface Recipe {
  layers: readonly Layer[];
}

/** Inharmonic partial ratios of a struck metal bar: the Aegis ring. */
export const INHARMONIC = [1, 2.76, 5.4, 8.93] as const;

const bp = (f: number, to: number | undefined, q: number): FilterSpec => (to === undefined ? { type: 'bandpass', f, q } : { type: 'bandpass', f, to, q });
const lp = (f: number, to?: number): FilterSpec => (to === undefined ? { type: 'lowpass', f, q: 0.7 } : { type: 'lowpass', f, to, q: 0.7 });
const hp = (f: number): FilterSpec => ({ type: 'highpass', f, q: 0.7 });

function osc(role: Layer['role'], wave: NonNullable<Layer['wave']>, freq: number, to: number | undefined, at: number, dur: number, gain: number, extra: Partial<Layer> = {}): Layer {
  const l: Layer = { role, src: 'osc', wave, freq, at, dur, gain, ...extra };
  if (to !== undefined) l.to = to;
  return l;
}
function noise(role: Layer['role'], filters: readonly FilterSpec[], at: number, dur: number, gain: number, extra: Partial<Layer> = {}): Layer {
  return { role, src: 'noise', filters, at, dur, gain, ...extra };
}
/** Two parallel formant bands that sweep down together: the wet, vocal quality of Vrax noise. */
const formants = (f1: number, f2: number, t1: number, t2: number, q = 5): FilterSpec[] => [bp(f1, t1, q), bp(f2, t2, q)];

// ---------------------------------------------------------------------------------------------------------------
// Aegis (human): metallic and mechanical. Inharmonic partials, ringing bandpass, servo whine, hard clicks.
// ---------------------------------------------------------------------------------------------------------------
const aClick = (gain: number, at = 0, f = 3500): Layer => noise('attack', [hp(f)], at, 0.012, gain, { attack: 0.001 });
const aRing = (f: number, to: number | undefined, dur: number, gain: number, at = 0, role: Layer['role'] = 'body'): Layer => osc(role, 'sine', f, to, at, dur, gain, { ratios: INHARMONIC });
const aMetal = (f: number, dur: number, gain: number, at = 0): Layer => noise('tail', [bp(f, f * 0.8, 12)], at, dur, gain);
const aWhine = (f: number, to: number, dur: number, gain: number, at = 0): Layer => osc('body', 'sawtooth', f, to, at, dur, gain, { filters: [lp(3200, 900)] });

const AEGIS: Record<WorldName, Recipe> = {
  zap: { layers: [aClick(0.05), aRing(1500, 900, 0.06, 0.035, 0.002), aMetal(2800, 0.06, 0.03, 0.01)] },
  laser: { layers: [aClick(0.04, 0, 5000), aWhine(1800, 500, 0.12, 0.03, 0.003), aRing(2400, 1200, 0.1, 0.02, 0.005)] },
  slash: { layers: [aClick(0.06, 0, 4500), aMetal(4000, 0.1, 0.07, 0.004), aRing(1900, 1500, 0.08, 0.02, 0.006)] },
  rocket: { layers: [aClick(0.06, 0, 2200), noise('body', [bp(2500, 300, 1.2)], 0.004, 0.25, 0.1), aWhine(300, 120, 0.2, 0.03, 0.01), aRing(600, 420, 0.18, 0.018, 0.01, 'tail')] },
  cannon: { layers: [noise('attack', [hp(1500)], 0, 0.02, 0.1, { attack: 0.001 }), osc('body', 'sine', 110, 45, 0, 0.25, 0.22), aMetal(900, 0.3, 0.05, 0.01), aRing(220, 200, 0.35, 0.03, 0.01, 'tail')] },
  boom: { layers: [noise('attack', [lp(5000)], 0, 0.03, 0.2, { attack: 0.001 }), osc('body', 'sine', 90, 35, 0, 0.45, 0.28), noise('tail', [bp(1800, 80, 0.9)], 0.01, 0.6, 0.22), aRing(140, 120, 0.5, 0.045, 0.02, 'tail')] },
  pop: { layers: [aClick(0.06, 0, 2500), noise('body', [bp(2500, 200, 1)], 0.002, 0.15, 0.12), aRing(700, 400, 0.12, 0.028, 0.004, 'tail')] },
  bigboom: {
    layers: [noise('attack', [lp(6000)], 0, 0.04, 0.3, { attack: 0.001 }), osc('body', 'sine', 70, 24, 0, 1.1, 0.5), noise('tail', [bp(1500, 90, 0.8)], 0.02, 1.2, 0.3), osc('tail', 'sawtooth', 55, 35, 0.05, 0.9, 0.05, { ratios: INHARMONIC, filters: [lp(700)] })],
  },
  crunch: { layers: [aClick(0.08, 0, 1800), noise('body', [bp(900, 120, 1)], 0, 0.16, 0.2), osc('body', 'triangle', 75, 40, 0, 0.12, 0.16), aRing(330, 260, 0.14, 0.03, 0.005, 'tail')] },
  sw_launch: { layers: [aClick(0.08, 0, 1500), aWhine(200, 1600, 1.2, 0.1, 0.01), noise('tail', [bp(300, 3000, 1.1)], 0.02, 1.2, 0.08), aRing(400, 1200, 1.1, 0.03, 0.02, 'tail')] },
  sw_strike: { layers: [noise('attack', [lp(5000)], 0, 0.05, 0.4, { attack: 0.001 }), osc('body', 'sine', 55, 20, 0, 1.6, 0.6), noise('tail', [bp(1200, 40, 0.8)], 0.02, 1.7, 0.5), aRing(90, 70, 1.4, 0.08, 0.03, 'tail')] },
};

// ---------------------------------------------------------------------------------------------------------------
// Vrax (alien): organic and wet. Noise through formant sweeps, low clicks, gurgles and chitter.
// ---------------------------------------------------------------------------------------------------------------
const vClick = (gain: number, f = 240, at = 0): Layer => osc('attack', 'sine', f, f * 0.4, at, 0.025, gain, { attack: 0.002 });
const vWet = (role: Layer['role'], f1: number, f2: number, t1: number, t2: number, at: number, dur: number, gain: number, q = 5): Layer => noise(role, formants(f1, f2, t1, t2, q), at, dur, gain);
const vGurgle = (f: number, to: number, dur: number, gain: number, at = 0, rate = 22): Layer => osc('tail', 'triangle', f, to, at, dur, gain, { wobble: { rate, depth: f * 0.18 } });

const VRAX: Record<WorldName, Recipe> = {
  zap: { layers: [vClick(0.06, 260), vWet('body', 900, 2200, 500, 1200, 0, 0.07, 0.08), vGurgle(300, 160, 0.09, 0.03, 0.01)] },
  laser: { layers: [vClick(0.05, 300), vWet('body', 1400, 3000, 700, 1600, 0.002, 0.14, 0.09), osc('tail', 'sine', 500, 250, 0.01, 0.12, 0.03, { wobble: { rate: 40, depth: 60 } })] },
  slash: { layers: [vClick(0.07, 200), vWet('body', 1500, 4000, 800, 2500, 0, 0.08, 0.16, 4), osc('tail', 'triangle', 900, 700, 0.01, 0.08, 0.03, { trill: 30 })] },
  rocket: { layers: [vClick(0.07, 180), vWet('body', 400, 1200, 200, 700, 0.003, 0.25, 0.14, 4), vGurgle(180, 90, 0.2, 0.04, 0.01)] },
  cannon: { layers: [vClick(0.1, 150), osc('body', 'sine', 90, 40, 0, 0.25, 0.25), vWet('tail', 250, 700, 120, 350, 0.005, 0.22, 0.16, 4)] },
  boom: { layers: [vClick(0.14, 130), osc('body', 'sine', 80, 30, 0, 0.45, 0.28), vWet('tail', 200, 600, 80, 250, 0.005, 0.5, 0.36, 3), vGurgle(140, 60, 0.4, 0.05, 0.03, 14)] },
  pop: { layers: [vClick(0.08, 200), vWet('body', 600, 1800, 250, 700, 0.002, 0.2, 0.2, 4), vGurgle(220, 110, 0.18, 0.04, 0.005)] },
  bigboom: { layers: [vClick(0.18, 110), osc('body', 'sine', 65, 24, 0, 1, 0.45), vWet('tail', 250, 800, 60, 200, 0.01, 1.1, 0.32, 3), vGurgle(120, 50, 0.9, 0.08, 0.04, 9)] },
  crunch: { layers: [vClick(0.1, 170), vWet('body', 500, 1500, 200, 600, 0, 0.17, 0.26, 3), osc('body', 'sine', 70, 35, 0, 0.12, 0.2)] },
  sw_launch: { layers: [vClick(0.08, 150), osc('body', 'triangle', 150, 900, 0.01, 1.2, 0.08, { wobble: { rate: 18, depth: 40 } }), vWet('tail', 300, 900, 1200, 3000, 0.02, 1.2, 0.1, 4)] },
  sw_strike: { layers: [vClick(0.22, 90), osc('body', 'sine', 55, 20, 0, 1.6, 0.6), vWet('tail', 200, 700, 40, 150, 0.01, 1.7, 0.5, 3), vGurgle(100, 40, 1.4, 0.08, 0.05, 7)] },
};

// ---------------------------------------------------------------------------------------------------------------
// UI sounds (AUD-11): quiet and short, so they do not tire the ear. The same for both factions.
// ---------------------------------------------------------------------------------------------------------------
const UI: Record<UiName, Recipe> = {
  hover: { layers: [noise('attack', [hp(5000)], 0, 0.008, 0.012, { attack: 0.001 }), osc('body', 'sine', 1900, 1700, 0, 0.03, 0.018)] },
  click: { layers: [noise('attack', [hp(3000)], 0, 0.01, 0.03, { attack: 0.001 }), osc('body', 'triangle', 700, 480, 0, 0.05, 0.05)] },
  built: { layers: [noise('attack', [hp(2500)], 0, 0.012, 0.03), osc('body', 'triangle', 520, undefined, 0, 0.14, 0.09), osc('tail', 'triangle', 780, undefined, 0.09, 0.22, 0.09)] },
  ready: { layers: [osc('attack', 'triangle', 660, undefined, 0, 0.1, 0.1), osc('body', 'triangle', 990, undefined, 0.1, 0.16, 0.1)] },
  alert: { layers: [osc('attack', 'square', 880, undefined, 0, 0.14, 0.09), osc('body', 'square', 660, undefined, 0.16, 0.18, 0.09)] },
  deny: { layers: [osc('attack', 'square', 220, 180, 0, 0.09, 0.07), osc('body', 'square', 165, 130, 0.1, 0.14, 0.07)] },
  ack: { layers: [osc('attack', 'triangle', 740, undefined, 0, 0.05, 0.08), osc('body', 'triangle', 1110, undefined, 0.045, 0.07, 0.07)] },
  ackAttack: { layers: [osc('attack', 'square', 440, 330, 0, 0.05, 0.05), osc('body', 'square', 660, undefined, 0.05, 0.08, 0.05)] },
};

/** The recipe for a sound name; world sounds are faction palettes (AUD-6). */
export function recipeFor(name: SoundName, faction: Faction = 'human'): Recipe | undefined {
  if ((UI_SOUNDS as readonly string[]).includes(name)) return UI[name as UiName];
  return (faction === 'alien' ? VRAX : AEGIS)[name as WorldName];
}

/** What marks a faction's timbre, counted over its world recipes (AUD-6). */
export function paletteOf(faction: Faction): { inharmonic: number; ringing: number; formantNoise: number; lowClicks: number; layers: number } {
  const recipes = Object.values(faction === 'alien' ? VRAX : AEGIS);
  const layers = recipes.flatMap((r) => r.layers);
  return {
    inharmonic: layers.filter((l) => l.ratios?.some((r) => !Number.isInteger(r))).length,
    ringing: layers.filter((l) => l.filters?.some((f) => f.type === 'bandpass' && f.q >= 10)).length,
    formantNoise: layers.filter((l) => l.src === 'noise' && (l.filters?.filter((f) => f.type === 'bandpass').length ?? 0) >= 2).length,
    lowClicks: layers.filter((l) => l.role === 'attack' && l.src === 'osc' && l.dur <= 0.03 && (l.freq ?? 1e9) < 400).length,
    layers: layers.length,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgement sounds (AUD-7): one short "select" and one different "command" per unit kind, never a voice.
// ---------------------------------------------------------------------------------------------------------------
/** Base pitch of each unit kind's acknowledgement: light units chirp high, heavy ones speak low. */
const ACK_PITCH: Readonly<Record<string, number>> = {
  hum_hauler: 300, hum_rifleman: 880, hum_rocketeer: 760, hum_buggy: 1040, hum_tank: 420, hum_artillery: 340, hum_paladin: 200,
  ali_gorger: 180, ali_skitter: 1200, ali_spitter: 900, ali_stalker: 1400, ali_brute: 150, ali_lobber: 260, ali_strider: 120,
};
export const ACK_KINDS: readonly string[] = Object.keys(ACK_PITCH);

/** Aegis: radio blips, servo whirs and relay clicks. */
function aegisAck(f: number, mode: 'select' | 'command'): Recipe {
  const heavy = f < 500;
  const click = noise('attack', [hp(3000)], 0, 0.012, 0.045, { attack: 0.001 });
  if (mode === 'select') {
    const l = [click, osc('body', 'sine', f, undefined, 0.005, 0.07, 0.06, { ratios: [1, 2.76] })];
    if (heavy) l.push(osc('tail', 'sawtooth', f * 0.6, f, 0.02, 0.12, 0.03, { filters: [lp(1400)] }));
    return { layers: l };
  }
  const l = [click, osc('body', 'sine', f, undefined, 0.005, 0.06, 0.06, { ratios: [1, 2.76] }), osc('body', 'sine', f * 1.5, undefined, 0.07, 0.07, 0.06, { ratios: [1, 2.76] }), noise('tail', [hp(2500)], 0.15, 0.012, 0.035)];
  l.push(osc('tail', 'sawtooth', f * 0.5, f * (heavy ? 1.1 : 1.6), 0.03, 0.14, 0.03, { filters: [lp(1800)] }));
  return { layers: l };
}

/** Vrax: clicks, chitters and wet trills. */
function vraxAck(f: number, mode: 'select' | 'command'): Recipe {
  if (mode === 'select') {
    return { layers: [vClick(0.07, f * 0.5), noise('body', formants(f * 1.2, f * 2.8, f * 0.9, f * 2, 6), 0.01, 0.07, 0.07), osc('tail', 'triangle', f, f * 0.8, 0.015, 0.06, 0.025, { trill: 30 })] };
  }
  return { layers: [vClick(0.06, f * 0.6), osc('body', 'triangle', f, f * 1.4, 0.02, 0.16, 0.05, { wobble: { rate: 30, depth: f * 0.12 } }), noise('tail', formants(f * 1.5, f * 3, f * 2, f * 3.5, 5), 0.03, 0.12, 0.05)] };
}

/** The acknowledgement sound for a unit kind: undefined for kinds with none. */
export function ackRecipe(kind: string, mode: 'select' | 'command'): Recipe | undefined {
  const f = ACK_PITCH[kind];
  if (f === undefined) return undefined;
  return kind.startsWith('ali_') ? vraxAck(f, mode) : aegisAck(f, mode);
}

/** The kind with the most units in a selection (ties go to the kind met first); null for an empty selection. */
export function mostNumerousKind(kinds: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const k of kinds) n.set(k, (n.get(k) ?? 0) + 1);
  let best: string | null = null;
  let bn = 0;
  for (const [k, c] of n)
    if (c > bn) {
      best = k;
      bn = c;
    }
  return best;
}

/** At most one acknowledgement sound every `gapMs` (AUD-7). */
export class AckGate {
  private last = -Infinity;
  constructor(private gapMs = 150) {}
  allow(nowMs: number): boolean {
    if (nowMs - this.last < this.gapMs) return false;
    this.last = nowMs;
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Variation (AUD-5)
// ---------------------------------------------------------------------------------------------------------------
export interface Vary {
  /** Pitch multiplier, within 8% of 1. */
  pitch: number;
  /** Start delay, s. */
  delay: number;
  /** Level multiplier. */
  gain: number;
}

/** Seeded render-side variation: each play of a sound differs from the last in pitch, timing and level. */
export class Variation {
  private rng: Rng;
  private last = new Map<string, number>();
  constructor(seed: number) {
    this.rng = new Rng(seed);
  }
  /** A number in [0, 1). */
  float(): number {
    return this.rng.int(1_000_000) / 1_000_000;
  }
  next(key: string): Vary {
    let pitch = 1 + (this.float() * 2 - 1) * 0.07;
    const prev = this.last.get(key);
    // Never the same pitch twice in a row: a near repeat is pushed back toward 1.
    if (prev !== undefined && Math.abs(pitch - prev) < 0.012) pitch += pitch > 1 ? -0.03 : 0.03;
    this.last.set(key, pitch);
    return { pitch, delay: this.float() * 0.012, gain: 0.9 + this.float() * 0.2 };
  }
}

/** How an explosion of relative size `size` (1 = a normal shell) changes its sound: longer, lower and louder when big. */
export function sizeMods(size: number): { time: number; pitch: number; gain: number } {
  const s = Math.max(0.5, Math.min(3, size));
  return { time: s ** 0.6, pitch: s ** -0.4, gain: Math.min(1.4, 0.75 + 0.25 * s) };
}

/** Relative size of an explosion of blast radius `r` tiles. */
export const explosionSize = (r: number): number => Math.max(0.6, Math.min(2.5, r / 1.5));

// ---------------------------------------------------------------------------------------------------------------
// The voice budget (AUD-12)
// ---------------------------------------------------------------------------------------------------------------
export const MAX_VOICES = 24;

export interface VoiceInfo {
  /** When it ends, in context time. */
  end: number;
  /** How loud it is at the listener: its level times its distance falloff. */
  loud: number;
}
export type Allocation = { kind: 'play' } | { kind: 'drop' } | { kind: 'steal'; index: number };

/**
 * Whether a new sound of loudness `loud` may start: yes while fewer than `cap` are playing; when full it is dropped if
 * it is no louder than every playing one, otherwise it takes the place of the quietest.
 */
export function allocateVoice(active: readonly VoiceInfo[], loud: number, now: number, cap = MAX_VOICES): Allocation {
  let live = 0;
  let quiet = -1;
  active.forEach((v, i) => {
    if (v.end <= now) return;
    live++;
    if (quiet < 0 || v.loud < (active[quiet] as VoiceInfo).loud) quiet = i;
  });
  if (live < cap) return { kind: 'play' };
  if (quiet < 0 || loud <= (active[quiet] as VoiceInfo).loud) return { kind: 'drop' };
  return { kind: 'steal', index: quiet };
}

// ---------------------------------------------------------------------------------------------------------------
// Position on screen (AUD-9)
// ---------------------------------------------------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Stereo pan (-1 at the left edge, +1 at the right) and distance falloff (1 in the middle) of a screen point. */
export function panGain(sx: number, sy: number, vw: number, vh: number): { pan: number; gain: number } {
  const nx = vw > 0 ? (sx - vw / 2) / (vw / 2) : 0;
  const ny = vh > 0 ? (sy - vh / 2) / (vh / 2) : 0;
  const d = Math.hypot(nx, ny) / Math.SQRT2;
  return { pan: clamp(nx, -1, 1), gain: clamp(1 - 0.6 * d, 0.2, 1) };
}

// ---------------------------------------------------------------------------------------------------------------
// Movement loops (AUD-8)
// ---------------------------------------------------------------------------------------------------------------
export type MoveClass = 'vehicle' | 'walker' | 'infantry' | 'swarm';
export const MOVE_CLASSES: readonly MoveClass[] = ['vehicle', 'walker', 'infantry', 'swarm'];

const MOVE_CLASS: Readonly<Record<string, MoveClass>> = {
  hum_hauler: 'vehicle', hum_buggy: 'vehicle', hum_tank: 'vehicle', hum_artillery: 'vehicle', hum_paladin: 'walker', hum_rifleman: 'infantry', hum_rocketeer: 'infantry',
  ali_gorger: 'walker', ali_brute: 'walker', ali_lobber: 'walker', ali_strider: 'walker', ali_skitter: 'swarm', ali_spitter: 'swarm', ali_stalker: 'swarm',
};
/** The movement sound class of a unit kind, or null for kinds that make none. */
export const moveClass = (kind: string): MoveClass | null => MOVE_CLASS[kind] ?? null;

/**
 * How one class's loop sounds (AUD-8): a short generated sample that repeats, never noise. Movement is low and soft: a rumble for
 * vehicles, discrete footfall thumps for walkers and heroes, soft low-mid steps for infantry, sparse low patters for swarms.
 * `filter` is a final low-pass that keeps every class well below the hiss band; `period` is the sample's length in seconds.
 */
export const MOVE_LOOPS: Readonly<Record<MoveClass, { filter: FilterSpec; period: number; level: number }>> = {
  vehicle: { filter: { type: 'lowpass', f: 300, q: 0.7 }, period: 1, level: 0.05 },
  walker: { filter: { type: 'lowpass', f: 220, q: 0.7 }, period: 1.2, level: 0.1 },
  infantry: { filter: { type: 'lowpass', f: 700, q: 0.7 }, period: 1.6, level: 0.025 },
  swarm: { filter: { type: 'lowpass', f: 800, q: 0.7 }, period: 1.4, level: 0.04 },
};

/** A decaying sine thump added into `d` at time `at` s: its pitch falls from `f0` to `f1`, it dies over `dur` s. */
function thump(d: Float32Array, rate: number, at: number, f0: number, f1: number, dur: number, gain: number): void {
  const n = Math.min(d.length, Math.floor(dur * rate * 1.5));
  const start = Math.floor(at * rate);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const f = f1 + (f0 - f1) * Math.exp(-t / (dur * 0.25));
    ph += (2 * Math.PI * f) / rate;
    const atk = Math.min(1, t / 0.004);
    const idx = (start + i) % d.length;
    d[idx] = (d[idx] as number) + Math.sin(ph) * Math.exp(-t / (dur * 0.35)) * atk * gain;
  }
}

/**
 * The samples of one class's movement loop (AUD-8), mono, `MOVE_LOOPS[cls].period` seconds long, seamless. No noise, all
 * thumps, rumble and patters well below 1 kHz. Pure and deterministic, so a test can look at it without any audio device.
 */
export function moveLoopSamples(cls: MoveClass, rate: number): Float32Array {
  const period = MOVE_LOOPS[cls].period;
  const d = new Float32Array(Math.round(period * rate));
  switch (cls) {
    case 'vehicle': {
      // An engine and track rumble: low harmonics of 40 Hz (whole cycles per loop), chugging at 6 Hz.
      for (let i = 0; i < d.length; i++) {
        const t = i / rate;
        const chug = 0.65 + 0.35 * Math.sin(2 * Math.PI * 6 * t);
        const v = Math.sin(2 * Math.PI * 40 * t) + 0.6 * Math.sin(2 * Math.PI * 80 * t + 0.7) + 0.35 * Math.sin(2 * Math.PI * 120 * t + 1.9) + 0.2 * Math.sin(2 * Math.PI * 160 * t + 0.3);
        d[i] = v * chug * 0.5;
      }
      break;
    }
    case 'walker':
      // Heavy footfalls: two low thumps a loop, the second a little lighter and lower.
      thump(d, rate, 0, 78, 42, 0.22, 1);
      thump(d, rate, 0.6, 70, 38, 0.22, 0.8);
      break;
    case 'infantry':
      // Soft low-mid steps, short and sparse: alternating feet.
      for (let k = 0; k < 4; k++) thump(d, rate, k * 0.4, k % 2 ? 230 : 280, 130, 0.07, k % 2 ? 0.55 : 0.7);
      break;
    case 'swarm':
      // Soft low patters: little clusters of clicks with gaps between.
      for (const at of [0, 0.07, 0.15, 0.7, 0.78, 0.84, 0.92]) thump(d, rate, at, 330, 190, 0.035, 0.5);
      break;
  }
  return d;
}

export interface MovingUnit {
  kind: string;
  /** Screen position, px. */
  sx: number;
  sy: number;
}

/**
 * The gain (0..1) of each class's loop from the units moving on screen: each counts by how near the middle it is, and
 * the level rises with the total toward 1. Zero when none move.
 */
export function movementMix(moving: readonly MovingUnit[], vw: number, vh: number): Record<MoveClass, number> {
  const w: Record<MoveClass, number> = { vehicle: 0, walker: 0, infantry: 0, swarm: 0 };
  for (const u of moving) {
    const c = moveClass(u.kind);
    if (!c || u.sx < 0 || u.sy < 0 || u.sx > vw || u.sy > vh) continue;
    w[c] += panGain(u.sx, u.sy, vw, vh).gain;
  }
  const out = { ...w };
  for (const c of MOVE_CLASSES) out[c] = w[c] <= 0 ? 0 : 1 - Math.exp(-w[c] / 4);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Ambience (AUD-10)
// ---------------------------------------------------------------------------------------------------------------
export interface AmbienceMix {
  water: number;
  rumble: number;
}

/** Water sample points on screen at which lapping reaches full level. */
export const WATER_FULL = 24;

/** Ambience levels (0..1): lapping water by how much is on screen, a distant rumble by the off-screen fight level. No wind (AUD-10). */
export function ambienceMix(waterOnScreen: number, fight: number): AmbienceMix {
  return { water: clamp(waterOnScreen / WATER_FULL, 0, 1), rumble: clamp(fight, 0, 1) };
}

/** The off-screen fight level after `dtSec` with `n` of the player's units shooting or dying off-screen: it dies away in a few seconds. */
export const stepFight = (level: number, dtSec: number, n: number): number => Math.min(1, level * Math.exp(-Math.max(0, dtSec) / 2.5) + 0.25 * Math.min(n, 4));

// ---------------------------------------------------------------------------------------------------------------
// Which faction a sound belongs to (AUD-6)
// ---------------------------------------------------------------------------------------------------------------
export const factionOfKind = (kind: string): Faction => (kind.startsWith('ali_') ? 'alien' : 'human');

/** Remembers where recent shells were aimed, so an explosion (which carries no faction) sounds like the side that fired it. */
export class ShotTagger {
  private shots: { x: number; y: number; faction: Faction }[] = [];
  note(tx: number, ty: number, faction: Faction): void {
    this.shots.push({ x: tx, y: ty, faction });
    if (this.shots.length > 24) this.shots.shift();
  }
  /** The faction of the shell aimed nearest this point, or `fallback` when none was near. */
  near(x: number, y: number, fallback: Faction = 'human'): Faction {
    let best = fallback;
    let bd = 9;
    for (const s of this.shots) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d <= bd) {
        bd = d;
        best = s.faction;
      }
    }
    return best;
  }
}
