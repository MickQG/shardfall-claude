import { Rng, type SimEvent } from '../sim';

export interface Sound {
  name: 'zap' | 'rocket' | 'cannon' | 'slash' | 'laser' | 'boom' | 'pop' | 'bigboom' | 'crunch' | 'sw_launch' | 'sw_strike';
  gain: number;
}

const BY_WEAPON: Record<string, Sound['name']> = { pierce: 'zap', rocket: 'rocket', blast: 'cannon', claw: 'slash', bite: 'slash', beam: 'laser' };

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

export interface Note {
  /** Start time in beats. */
  beat: number;
  /** Frequency in Hz. */
  freq: number;
  /** Duration in beats. */
  dur: number;
  voice: 'pad' | 'arp' | 'bass';
}

/** A minor pentatonic over A: semitone offsets. */
export const SCALE_TONES = [0, 3, 5, 7, 10];
/** Chord roots (semitones from A) of the four-bar loop. */
export const CHORD_ROOTS = [0, -4, -2, -5];
const A2 = 110;
const hz = (semi: number): number => A2 * 2 ** (semi / 12);

/** Deterministic ambient score: slow pads and bass on a four-chord loop, with a sparse arpeggio on top. Same seed, same music. */
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
      notes.push({ beat: b0 + i * 0.5, freq: hz(root + 24 + deg), dur: 0.5, voice: 'arp' });
    }
  }
  return notes;
}

/** Semitones above A2 of a frequency (for checking notes stay in key). */
export const semitonesFromA = (freq: number): number => 12 * Math.log2(freq / A2);
