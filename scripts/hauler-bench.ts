import { idealFromIncomes, sweepIncomes, type HaulerFaction } from '../tests/unit/haulerBench';

/** Full ECO-10 sweep: prints incomes and the ideal hauler counts. Usage: tsx scripts/hauler-bench.ts [faction] [fieldTiles] */
const only = process.argv[2];
const onlySize = process.argv[3] ? Number(process.argv[3]) : undefined;
const SIZES = [13, 21, 44, 80];
const DISTANCES = [2, 4, 6, 8, 10, 12];
const out: Record<string, Record<string, { ideal: number; incomes: number[] }>> = {};
const t0 = Date.now();
for (const faction of ['human', 'alien'] as HaulerFaction[]) {
  if (only && only !== faction) continue;
  out[faction] = {};
  for (const n of SIZES) {
    if (onlySize && onlySize !== n) continue;
    for (const d of DISTANCES) {
      const inc = sweepIncomes(faction, n, d);
      const ideal = idealFromIncomes(inc);
      (out[faction] as Record<string, { ideal: number; incomes: number[] }>)[`${n}/${d}`] = { ideal, incomes: inc };
      console.log(`${faction} field ${n} pad ${d}: ideal ${ideal}  per-minute [${inc.map((v) => Math.round(v / 3)).join(' ')}]`);
    }
  }
}
console.log(JSON.stringify(out));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
