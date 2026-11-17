import { STEAMROLL_PRESETS, STEAMROLL_TUNING, type SteamrollTuning } from '../../src/ai/steamroll';

/**
 * The opponent variant the environment asks for (STEAMROLL_VARIANT), as changes to STEAMROLL_TUNING (HAR-5): parts such as
 * `launch:18000,crushers:8` (`=` works too), any key of SteamrollTuning, all numbers; or a named variant such as `tankspam`
 * (HAR-7, STEAMROLL_PRESETS), which later parts may change further. A bad part throws.
 */
export function variant(spec = typeof process !== 'undefined' ? (process.env.STEAMROLL_VARIANT ?? '') : ''): Partial<SteamrollTuning> {
  const out: Partial<SteamrollTuning> = {};
  for (const part of spec.split(',').filter(Boolean)) {
    const preset = STEAMROLL_PRESETS[part];
    if (preset) {
      Object.assign(out, preset);
      continue;
    }
    const [k, v] = part.split(/[=:]/) as [string, string]; // `:` too: the Balance workflow's variables cannot carry `=` in a value (HAR-6)
    if (!(k in STEAMROLL_TUNING) || !Number.isFinite(Number(v))) throw new Error(`STEAMROLL_VARIANT: bad part ${part}`);
    out[k as keyof SteamrollTuning] = Number(v);
  }
  return out;
}
