/** The music's own gain levels, kept out of the engine so they can be checked without audio (AUD-13, AUD-16). */

/** The music bus gain at full Music volume, relative to the level of the original score (AUD-16). */
export const MUSIC_MAX = 1.75;

export interface MixState {
  muted: boolean;
  /** Master volume, 0..1. */
  volume: number;
  musicOn: boolean;
  /** Music volume, 0..1. */
  musicVolume: number;
}

/**
 * The master and music-bus gains (AUD-16): Mute all zeroes the master, so everything goes quiet; Music off or music volume 0
 * zeroes only the music bus, so sound effects are not touched; music volume scales only the music bus. The default music
 * volume (0.75) gives 1.33 times the original score's level (about 2.5 dB up) and 100% gives 1.75 times (the master limiter
 * still keeps a loud battle from clipping); the curve is `MUSIC_MAX * v^0.95`, which is 0 at 0.
 */
export function busGains(s: MixState): { master: number; music: number } {
  return { master: s.muted ? 0 : s.volume * 0.5, music: s.musicOn ? MUSIC_MAX * Math.max(0, s.musicVolume) ** 0.95 : 0 };
}

/** The calm layer thins as the battle layer grows but never quite goes: calm 1 down to 0.4, battle 0 up to 1 (AUD-13). */
export function layerGains(intensity: number): { calm: number; battle: number } {
  const l = Math.max(0, Math.min(1, intensity));
  return { calm: 1 - 0.6 * l, battle: l };
}
