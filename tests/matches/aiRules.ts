import { DEFAULT_RULES, type AiRules } from '../../src/ai/ai';

/**
 * The AI rules a match series plays with (HAR-5): the environment's AI_RULES, such as `hold:0,labAt:99,holdRatio:1.2`
 * (`=` works too), as changes to DEFAULT_RULES. Numbers for numeric rules, 0 or 1 for switches; an unknown key or a bad
 * value throws. Unset: no changes, the game's own rules.
 */
export function aiRules(spec = typeof process !== 'undefined' ? (process.env.AI_RULES ?? '') : ''): Partial<AiRules> {
  const out: Record<string, number | boolean> = {};
  for (const part of spec.split(',').filter(Boolean)) {
    const [k, v] = part.split(/[=:]/) as [string, string | undefined]; // `:` too: the Balance workflow's variables cannot carry `=` in a value (HAR-6)
    const n = Number(v);
    if (!(k in DEFAULT_RULES) || v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`AI_RULES: bad part ${part}`);
    const def = DEFAULT_RULES[k as keyof AiRules];
    if (typeof def === 'boolean') {
      if (n !== 0 && n !== 1) throw new Error(`AI_RULES: ${k} is a switch, 0 or 1: ${part}`);
      out[k] = n === 1;
    } else out[k] = n;
  }
  return out as Partial<AiRules>;
}

/** The rules in effect, for a tally header: every rule, the changed ones marked. */
export function rulesLine(rules: Partial<AiRules> = aiRules()): string {
  const all = { ...DEFAULT_RULES, ...rules };
  const changed = Object.keys(rules);
  return `rules ${changed.length === 0 ? 'default' : `CHANGED ${changed.map((k) => `${k}=${String(all[k as keyof AiRules])}`).join(',')}`} (${Object.entries(all).map(([k, v]) => `${k}:${typeof v === 'boolean' ? Number(v) : v}`).join(',')})`;
}
