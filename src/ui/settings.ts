import { PERSONALITIES, type Personality } from '../ai/ai';
import { DEFAULT_MAP, mapIdOf, mapSeedOf, type MapId } from '../data/maps';

export interface Settings {
  quality: 'high' | 'low';
  muted: boolean;
  /** 0..1 */
  volume: number;
  reducedMotion: boolean;
  /** The skirmish map last picked in the menu (MAP-4). */
  map: MapId;
  /** The map seed last used for a generated map (MENU-6). */
  mapSeed: number;
  /** The AI personality last picked in the menu, or random (MENU-5). */
  personality: PersonalityChoice;
}

export type PersonalityChoice = Personality | 'random';
export const personalityChoiceOf = (v: unknown): PersonalityChoice => ((PERSONALITIES as readonly unknown[]).includes(v) ? (v as Personality) : 'random');

type Store = Pick<Storage, 'getItem' | 'setItem'>;
/** v2 starts everyone on the high preset again (VIS-2); sound settings carry over from v1. */
const KEY = 'shardfall.settings.v2';
const OLD_KEY = 'shardfall.settings.v1';

/** High quality by default for everyone; the reduced-motion preference only stops camera shake (VIS-2). */
export const defaultSettings = (reducedMotion = false): Settings => ({ quality: 'high', muted: false, volume: 0.6, reducedMotion, map: DEFAULT_MAP, mapSeed: 1, personality: 'random' });

/** Loads saved settings. Storage can be missing, blocked or corrupt (private windows, tests): every failure falls back to defaults. */
export function loadSettings(store: Store | null | undefined, prefersReducedMotion = false): Settings {
  const d = defaultSettings(prefersReducedMotion);
  try {
    const raw = store?.getItem(KEY);
    // Settings saved before v2 keep their sound choices; their quality is dropped so the default (high) applies.
    const old = raw ? null : store?.getItem(OLD_KEY);
    if (!raw && !old) return d;
    const p = JSON.parse((raw ?? old) as string) as Partial<Settings>;
    return {
      quality: raw && (p.quality === 'low' || p.quality === 'high') ? p.quality : d.quality,
      muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : d.volume,
      // The system preference always wins over a saved value.
      reducedMotion: prefersReducedMotion || d.reducedMotion,
      map: mapIdOf(p.map),
      mapSeed: mapSeedOf(p.mapSeed, d.mapSeed),
      personality: personalityChoiceOf(p.personality),
    };
  } catch {
    return d;
  }
}

/** The browser's local storage, or null where it is blocked (some private windows throw on access). */
export function safeStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function saveSettings(store: Store | null | undefined, s: Settings): void {
  try {
    store?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings simply do not persist */
  }
}

/** Whether decorative effects run: the quality preset sets bloom, particles and decor; reduced motion stops shake. */
export const effectsEnabled = (s: Settings): { bloom: boolean; particles: boolean; shake: boolean; decor: boolean } => ({
  bloom: s.quality === 'high',
  particles: s.quality === 'high',
  shake: !s.reducedMotion,
  decor: s.quality === 'high',
});
