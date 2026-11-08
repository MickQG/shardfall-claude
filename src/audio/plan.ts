import type { Faction } from '../data/defs';
import { FP, Rng, type SimEvent } from '../sim';
import { explosionSize, factionOfKind, type WorldName } from './recipes';

export interface Sound {
  name: WorldName;
  gain: number;
}

const BY_WEAPON: Record<string, Sound['name']> = { pierce: 'zap', rocket: 'rocket', missile: 'rocket', blast: 'cannon', claw: 'slash', bite: 'slash', beam: 'laser' };

/** The sound an event should make for this viewer. Own fire is a little louder than distant enemy fire. */
export function soundFor(e: SimEvent, viewer: number): Sound {
  switch (e.t) {
    case 'shot':
      return { name: BY_WEAPON[e.weapon] ?? 'zap', gain: e.owner === viewer ? 0.5 : 0.32 };
    case 'boom':
      return { name: 'boom', gain: Math.min(1, 0.5 + e.r * 0.2) };
    case 'die':
      // A squad run over by a heavy vehicle crunches (BAL-2).
      if (e.crushed) return { name: 'crunch', gain: e.big ? 0.9 : 0.6 };
      return { name: e.big ? 'bigboom' : 'pop', gain: e.big ? 0.9 : 0.5 };
    case 'launch':
      return { name: 'sw_launch', gain: 0.8 };
    case 'strike':
      return { name: 'sw_strike', gain: 1 };
  }
}

/** A world sound with where it is and whose it is: what the engine needs to pick a palette, size, pan and falloff (AUD-5, AUD-6, AUD-9). */
export interface WorldSound extends Sound {
  faction: Faction;
  /** Relative size for explosions (1 = a normal shell). */
  size: number;
  /** Where it happens, in tiles. */
  at: { x: number; y: number };
}

/** What `worldSoundFor` needs to know about the snapshot. */
export interface SoundWho {
  /** The kind of the unit or building with this id, if it is known. */
  kindOf(id: number): string | undefined;
  /** The faction of a player. */
  factionOf(owner: number): Faction;
  /** The faction whose shell most likely made an explosion here. */
  boomFaction(x: number, y: number): Faction;
}

/** `soundFor` plus the faction palette, size and place of the event. */
export function worldSoundFor(e: SimEvent, viewer: number, who: SoundWho): WorldSound {
  const base = soundFor(e, viewer);
  const at = { x: e.x / FP, y: e.y / FP };
  switch (e.t) {
    case 'shot': {
      const k = who.kindOf(e.src);
      return { ...base, at, size: 1, faction: k ? factionOfKind(k) : who.factionOf(e.owner) };
    }
    case 'boom':
      return { ...base, at, size: explosionSize(e.r), faction: who.boomFaction(at.x, at.y) };
    case 'die':
      return { ...base, at, size: 1, faction: factionOfKind(e.kind) };
    case 'launch':
    case 'strike':
      return { ...base, at, size: 1, faction: e.kind ? factionOfKind(e.kind) : who.factionOf(e.owner) };
  }
}

/**
 * The voices of the score. Calm: pad, arp, bass. Battle (AUD-13): ost (low ostinato), kick, perc (a noise hit whose freq is its
 * band centre), strings (a soft sustained pad swell). Themes (AUD-14): march (Aegis, a muted square pulse), hollow (Vrax).
 * Stingers (AUD-15): swell (a filtered pad), riser, hit, and tone (a low-passed falling tone). No voice is brass-like (AUD-14).
 */
export type MusicVoice = 'pad' | 'arp' | 'bass' | 'ost' | 'kick' | 'perc' | 'strings' | 'march' | 'hollow' | 'swell' | 'riser' | 'hit' | 'tone';

export interface Note {
  /** Start time in beats. */
  beat: number;
  /** Frequency in Hz. */
  freq: number;
  /** Duration in beats. */
  dur: number;
  voice: MusicVoice;
}

/**
 * The partials of every music voice as ratios of its fundamental (AUD-14): all whole numbers, so no voice rings like a bell or
 * a chime. The engine builds each voice from oscillators at these ratios (detune only for width), through low-pass filters.
 */
export const MUSIC_PARTIALS: Readonly<Record<MusicVoice, readonly number[]>> = {
  pad: [1], arp: [1], bass: [1], ost: [1], kick: [1], perc: [], strings: [1], march: [1], hollow: [1], swell: [1], riser: [1], hit: [1], tone: [1],
};

/**
 * The synth patch of every music voice that the engine builds (AUD-14): its oscillator wave and, for a filtered voice, the
 * low-pass cutoff at the start and the end of the note. The engine reads the cutoffs from here. No voice is brass-like: a
 * sawtooth or square never has a cutoff that opens during its attack, and no cutoff goes above 1.5 kHz.
 */
export interface VoicePatch {
  wave: OscillatorType | 'noise';
  lp?: readonly [from: number, to: number];
}
export const MUSIC_PATCHES: Readonly<Record<MusicVoice, VoicePatch>> = {
  pad: { wave: 'sine' },
  arp: { wave: 'sawtooth', lp: [900, 300] },
  bass: { wave: 'triangle' },
  ost: { wave: 'sawtooth', lp: [650, 220] },
  kick: { wave: 'sine' },
  perc: { wave: 'noise' },
  strings: { wave: 'triangle', lp: [450, 800] },
  march: { wave: 'square', lp: [600, 300] },
  hollow: { wave: 'square', lp: [700, 450] },
  swell: { wave: 'triangle', lp: [300, 1100] },
  riser: { wave: 'sine' },
  hit: { wave: 'sine' },
  tone: { wave: 'triangle', lp: [900, 400] },
};

/** A minor pentatonic over A: semitone offsets. */
export const SCALE_TONES = [0, 3, 5, 7, 10];
/** Chord roots (semitones from A) of the four-bar loop. */
export const CHORD_ROOTS = [0, -4, -2, -5];
const A2 = 110;
const hz = (semi: number): number => A2 * 2 ** (semi / 12);

/** Deterministic ambient score: slow pads and bass on a four-chord loop, with a sparse, soft, low arpeggio (one octave above the pad's root, never higher). Same seed, same music. */
export function musicPlan(seed: number, bars: number): Note[] {
  const r = new Rng(seed * 2654435 + 17);
  const notes: Note[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const root = CHORD_ROOTS[bar % CHORD_ROOTS.length] as number;
    const b0 = bar * 4;
    notes.push({ beat: b0, freq: hz(root + 12), dur: 4, voice: 'pad' }, { beat: b0, freq: hz(root + 19), dur: 4, voice: 'pad' }, { beat: b0, freq: hz(root), dur: 2, voice: 'bass' });
    if (bar % 2 === 1) notes.push({ beat: b0 + 2, freq: hz(root), dur: 2, voice: 'bass' });
    for (let i = 0; i < 8; i++) {
      if (r.int(100) < 45) continue; // rests keep it sparse
      const deg = SCALE_TONES[r.int(SCALE_TONES.length)] as number;
      notes.push({ beat: b0 + i * 0.5, freq: hz(root + 12 + deg), dur: 0.5, voice: 'arp' });
    }
  }
  return notes;
}

/**
 * The main-menu score (AUD-4): the same key and chord loop as the in-match ambient (AUD-2), from its own stream of the
 * seed so the two never sound alike. Same seed, same score.
 */
export const menuPlan = (seed: number, bars: number): Note[] => musicPlan(seed + 7919, bars);

/** Semitones above A2 of a frequency (for checking notes stay in key). */
export const semitonesFromA = (freq: number): number => 12 * Math.log2(freq / A2);

/** Frequency of a semitone offset from A2 (the plans' common reference). */
export const noteHz = hz;

/**
 * The battle layer (AUD-13): a driving low ostinato on the chord root and fifth, a percussion pulse (kick, and noise hits kept
 * below the highs) and a soft, slow string-like pad swell on chord tones (no brass). Same key and chord loop as the calm layer, its own stream of the seed.
 * Intensity never reaches this function: it only sets the layer's level, so the notes are a pure function of the seed (AUD-2).
 */
export function battlePlan(seed: number, bars: number): Note[] {
  const r = new Rng(seed * 40503 + 911);
  const notes: Note[] = [];
  // Eighth-note shapes over a bar: 0 = root, 1 = fifth, 2 = octave.
  const shapes = [
    [0, 0, 1, 0, 0, 0, 1, 0],
    [0, 0, 0, 1, 0, 0, 2, 1],
    [0, 1, 0, 0, 0, 1, 0, 2],
  ];
  for (let bar = 0; bar < bars; bar++) {
    const root = CHORD_ROOTS[bar % CHORD_ROOTS.length] as number;
    const b0 = bar * 4;
    const shape = shapes[r.int(shapes.length)] as number[];
    shape.forEach((d, i) => notes.push({ beat: b0 + i * 0.5, freq: hz(root + (d === 1 ? 7 : d === 2 ? 12 : 0)), dur: 0.45, voice: 'ost' }));
    notes.push({ beat: b0, freq: 55, dur: 0.4, voice: 'kick' }, { beat: b0 + 2, freq: 55, dur: 0.4, voice: 'kick' });
    if (r.int(100) < 30) notes.push({ beat: b0 + 3.5, freq: 55, dur: 0.4, voice: 'kick' });
    if (r.int(100) < 20) notes.push({ beat: b0 + 1.5, freq: 55, dur: 0.4, voice: 'kick' });
    notes.push({ beat: b0 + 1, freq: 1500, dur: 0.22, voice: 'perc' }, { beat: b0 + 3, freq: 1500, dur: 0.22, voice: 'perc' });
    for (let i = 0; i < 4; i++) notes.push({ beat: b0 + i + 0.5, freq: 3200, dur: 0.1, voice: 'perc' });
    // A sustained pad swell on the chord root and fifth every other bar: slow attack, no bright transient.
    if (bar % 2 === 0) notes.push({ beat: b0, freq: hz(root + 12), dur: 7.5, voice: 'strings' }, { beat: b0, freq: hz(root + 19), dur: 7.5, voice: 'strings' });
  }
  return notes;
}

/**
 * The faction themes (AUD-14), beats from the motif's start, absolute pitches in A minor pentatonic. Aegis is martial
 * (a low, muted square pulse, never brass): dotted rhythms and rising fourths and fifths. Vrax is eerie and pulsing: a dark, hollow, amplitude-pulsed voice with a
 * falling contour, wide leaps and sparse timing.
 */
export function motifFor(faction: Faction): Note[] {
  if (faction === 'human') {
    // A D (fourth) A' (fifth), then G E G A'; semitones above A2.
    const semis = [12, 17, 24, 22, 19, 22, 24];
    const beats = [0, 1.5, 2, 3.5, 4, 5.5, 6];
    const durs = [1.5, 0.5, 1.5, 0.5, 1.5, 0.5, 2];
    return semis.map((s, i) => ({ beat: beats[i] as number, freq: hz(s), dur: durs[i] as number, voice: 'march' as const }));
  }
  // G C A E A, falling in leaps with gaps between them, in a mid register.
  const semis = [22, 15, 12, 7, 0];
  const beats = [0, 2, 3.5, 5, 7];
  const durs = [1.5, 1.2, 1, 1.5, 2.5];
  return semis.map((s, i) => ({ beat: beats[i] as number, freq: hz(s), dur: durs[i] as number, voice: 'hollow' as const }));
}

/** Bars between the theme's appearances: it recurs every eight bars, never constantly. */
export const THEME_EVERY = 8;

/**
 * The theme woven into a score (AUD-14): the faction's motif every eight bars, starting on an A chord so it always sits on
 * its home harmony. The seed picks whether it first appears at bar 4 or bar 8; the melody itself is the faction's.
 */
export function themePlan(seed: number, bars: number, faction: Faction): Note[] {
  const motif = motifFor(faction);
  const notes: Note[] = [];
  for (let bar = 4 + (Math.abs(Math.floor(seed)) % 2) * 4; bar < bars; bar += THEME_EVERY) {
    for (const n of motif) notes.push({ ...n, beat: bar * 4 + n.beat });
    // Aegis marches over a soft snare-like tick on every beat of the statement.
    if (faction === 'human') for (let i = 0; i < 8; i++) notes.push({ beat: bar * 4 + i, freq: 1800, dur: 0.1, voice: 'perc' });
  }
  return notes;
}

/**
 * A musical stinger over the score (AUD-15), beats from its start, in key. Launch: a rising, filtered pad swell over a low riser.
 * Strike: a low hit with a falling, low-passed tone figure. No brass. The seed picks one of two voicings so repeats are not identical.
 */
export function stingerPlan(kind: 'launch' | 'strike', seed: number): Note[] {
  const alt = Math.abs(Math.floor(seed)) % 2;
  if (kind === 'launch') {
    const semis = alt ? [0, 5, 12, 17] : [0, 7, 12, 19];
    return [{ beat: 0, freq: hz(0), dur: 3, voice: 'riser' as const }, ...semis.map((s, i) => ({ beat: i * 0.5, freq: hz(s + 12), dur: 3.2 - i * 0.4, voice: 'swell' as const }))];
  }
  const fall = alt ? [31, 24, 19, 15] : [34, 27, 24, 19];
  return [{ beat: 0, freq: 55, dur: 2, voice: 'hit' as const }, ...fall.map((s, i) => ({ beat: 0.25 + i * 0.5, freq: hz(s - 12), dur: 1.2, voice: 'tone' as const }))];
}

/** The main-menu score's theme (AUD-14): the faction's motif on the menu's own stream of the seed, like `menuPlan`. */
export const menuThemePlan = (seed: number, bars: number, faction: Faction): Note[] => themePlan(seed + 7919, bars, faction);
