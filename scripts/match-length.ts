import { DIFFICULTIES, PERSONALITIES } from '../src/ai/ai';
import { inLengthTarget, lengthReport, playMatch } from '../src/ai/harness';
import { MAPS } from '../src/data/maps';

/**
 * On-demand match-length report (HAR-4); not part of `npm test` or CI. For each personality, plays it against a
 * Balanced AI, Medium against Medium, on every map from both sides and with both factions, and prints the median,
 * shortest and longest match. Matches that reach the cap count at the cap. Usage: npm run ai:length [seeds=2] [capMinutes=30]
 */
const seeds = Number(process.argv[2] ?? 2);
const cap = 20 * 60 * Number(process.argv[3] ?? 30);
for (const p of PERSONALITIES) {
  const ticks: number[] = [];
  let capped = 0;
  for (const { id: map } of MAPS) {
    for (let seed = 1; seed <= seeds; seed++) {
      for (const factions of [['human', 'alien'], ['alien', 'human']] as const) {
        const r = playMatch({ seed, map, factions: [factions[0], factions[1]], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium], maxTicks: cap, personalities: [p, 'balanced'] });
        ticks.push(r.ticks);
        if (r.winner === null || r.reason !== 'elimination') capped++;
      }
    }
  }
  const r = lengthReport(ticks);
  const f = (m: number): string => `${m.toFixed(1)} min`;
  console.log(`${p.padEnd(9)} median ${f(r.median)}  shortest ${f(r.min)}  longest ${f(r.max)}  (${r.n} matches, ${capped} not decided by elimination)  ${inLengthTarget(r.median) ? 'in target' : 'OUTSIDE 12-20 min target'}`);
}
