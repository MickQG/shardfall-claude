import { TICKS_PER_SECOND, type PlayerStats } from '../sim';

/** Score table for the result screen: one column per player (SCR-3). Units destroyed are the other side's losses (1v1). */
export function scoreRows(stats: readonly PlayerStats[], names: readonly string[], ticks: number): { header: string[]; rows: string[][]; length: string } {
  const col = (f: (s: PlayerStats, i: number) => number): string[] => stats.map((s, i) => String(f(s, i)));
  const destroyed = (i: number): number => stats.reduce((sum, s, j) => sum + (j === i ? 0 : s.unitsLost), 0);
  const secs = Math.floor(ticks / TICKS_PER_SECOND);
  return {
    header: ['', ...names],
    rows: [
      ['Units built', ...col((s) => s.unitsBuilt)],
      ['Units lost', ...col((s) => s.unitsLost)],
      ['Units destroyed', ...col((_, i) => destroyed(i))],
      ['Buildings built', ...col((s) => s.buildingsBuilt)],
      ['Buildings lost', ...col((s) => s.buildingsLost)],
      ['Shards gathered', ...col((s) => s.shardsGathered)],
    ],
    length: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
  };
}

/** SVG polyline points for an army-value series on a `w` by `h` chart whose top is `max` (shared by all series). */
export function armyPath(samples: readonly number[], max: number, w: number, h: number): string {
  if (samples.length < 2 || max <= 0) return `0,${h} ${w},${h}`;
  return samples.map((v, i) => `${Math.round((i * w) / (samples.length - 1))},${Math.round(h - (v * h) / max)}`).join(' ');
}

/**
 * The result-screen line naming the AI opponent (SCR-4): its personality and difficulty. Only the result screen shows
 * it, so a random personality stays a surprise until the game ends.
 */
export function opponentLine(personality: string, difficulty: string): string {
  const cap = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
  return `Your opponent played ${cap(personality)} on ${cap(difficulty)}.`;
}
