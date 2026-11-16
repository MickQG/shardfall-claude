import { DIFFICULTIES as GAME, type Difficulty } from '../../src/ai/ai';

export type Level = keyof typeof GAME;

/**
 * The difficulty levels a match series plays with (AI-28, HAR-6): the game's own, or, for measuring only, the
 * environment's LEVELS as changes to them, each `name:ticks:orders:bonus`, such as `medium:26:6:0,hard:8:12:20`
 * (a negative bonus as `easy:60:2:-10`). An unknown level or a bad number throws. Unset: the game's levels.
 */
export function levels(spec = typeof process !== 'undefined' ? (process.env.LEVELS ?? '') : ''): Record<Level, Difficulty> {
  const out: Record<Level, Difficulty> = { easy: { ...GAME.easy }, medium: { ...GAME.medium }, hard: { ...GAME.hard } };
  for (const part of spec.split(',').filter(Boolean)) {
    const [name, ...rest] = part.split(':') as [string, ...string[]];
    const n = rest.map(Number);
    if (!(name in out) || n.length !== 3 || n.some((v) => !Number.isFinite(v))) throw new Error(`LEVELS: bad part ${part}`);
    out[name as Level] = { name, thinkEvery: n[0]!, maxCommands: n[1]!, bonus: n[2]! };
  }
  return out;
}

/** The levels in effect: every match test plays with these. */
export const DIFFICULTIES: Readonly<Record<Level, Difficulty>> = levels();

/** The levels in effect, for a tally header. */
export function levelsLine(): string {
  const changed = typeof process !== 'undefined' && !!process.env.LEVELS;
  return `levels ${changed ? 'CHANGED' : 'default'} (${Object.values(DIFFICULTIES).map((d) => `${d.name}:${d.thinkEvery}:${d.maxCommands}:${d.bonus}`).join(',')})`;
}

/** Writes a tally to stdout (the runner holds back console.log output of a passing test) and to the CI run summary. */
export async function printTally(lines: readonly string[]): Promise<void> {
  const text = [levelsLine(), ...lines].join('\n');
  process.stdout.write(`${text}\n`);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) (await import('node:fs')).appendFileSync(summary, `\`\`\`\n${text}\n\`\`\`\n`);
}
