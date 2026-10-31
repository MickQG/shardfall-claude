import { DIFFICULTIES } from '../src/ai/ai';
import { playMatch, totalViolations } from '../src/ai/harness';
import { MAPS } from '../src/data/maps';

/**
 * CI gate for the AI: plays full headless matches on every map (MAP-4) and fails on bad behaviour or a broken
 * difficulty ordering. Usage: tsx scripts/harness.ts [seeds=2]
 */
const seeds = Number(process.argv[2] ?? 2);
let failed = false;
const fail = (msg: string): void => {
  failed = true;
  console.error(`FAIL: ${msg}`);
};

let hardWins = 0;
let easyWins = 0;
let violations = 0;
let matches = 0;
for (const { id: map } of MAPS) {
  let mapHard = 0;
  let mapEasy = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    for (const swap of [false, true]) {
      const d = swap ? [DIFFICULTIES.easy, DIFFICULTIES.hard] : [DIFFICULTIES.hard, DIFFICULTIES.easy];
      const r = playMatch({ seed, map, factions: swap ? ['alien', 'human'] : ['human', 'alien'], difficulties: [d[0]!, d[1]!], maxTicks: 12000 });
      const hardSide = swap ? 1 : 0;
      if (r.winner === hardSide) {
        hardWins++;
        mapHard++;
      } else if (r.winner !== null) {
        easyWins++;
        mapEasy++;
      }
      violations += totalViolations(r.violations[hardSide] as never);
      matches++;
      console.log(`${map} seed ${seed} ${swap ? 'easy/hard' : 'hard/easy'}: winner=${r.winner} (${r.reason}) @${r.ticks} peakArmy=${r.peak.army} violations=${JSON.stringify(r.violations[hardSide])}`);
    }
  }
  // Every map must play out: Hard beats Easy on each one, not just on average.
  if (mapHard <= mapEasy) fail(`Hard must beat Easy on ${map}`);
}
console.log(`hard ${hardWins} - easy ${easyWins}; hard violations/match ${(violations / matches).toFixed(2)}`);
if (hardWins <= easyWins) fail('Hard must beat Easy');
if (violations / matches > 2) fail('Hard AI shows too much bad behaviour (idle haulers, stuck units, outages, hoarding, undefended base, suicidal waves)');
if (failed) process.exit(1);
console.log('AI harness OK');
