export interface Settings {
  quality: 'high' | 'low';
  muted: boolean;
  /** 0..1 */
  volume: number;
  reducedMotion: boolean;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'shardfall.settings.v1';

export const defaultSettings = (reducedMotion = false): Settings => ({ quality: reducedMotion ? 'low' : 'high', muted: false, volume: 0.6, reducedMotion });

/** Loads saved settings. Storage can be missing, blocked or corrupt (private windows, tests): every failure falls back to defaults. */
export function loadSettings(store: Store | null | undefined, prefersReducedMotion = false): Settings {
  const d = defaultSettings(prefersReducedMotion);
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return d;
    const p = JSON.parse(raw) as Partial<Settings>;
    return {
      quality: p.quality === 'low' || p.quality === 'high' ? p.quality : d.quality,
      muted: typeof p.muted === 'boolean' ? p.muted : d.muted,
      volume: typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : d.volume,
      // The system preference always wins over a saved value.
      reducedMotion: prefersReducedMotion || d.reducedMotion,
    };
  } catch {
    return d;
  }
}

export function saveSettings(store: Store | null | undefined, s: Settings): void {
  try {
    store?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings simply do not persist */
  }
}

/** Whether decorative effects (bloom, particles, screen shake) should run. */
export const effectsEnabled = (s: Settings): { bloom: boolean; particles: boolean; shake: boolean } => ({
  bloom: s.quality === 'high' && !s.reducedMotion,
  particles: s.quality === 'high' && !s.reducedMotion,
  shake: !s.reducedMotion,
});
