import { demoMap } from '../src/data/maps';
import { createGame, FP, submit, tick, type UnitSpawn } from '../src/sim';

const map = demoMap();
const units: UnitSpawn[] = [];
for (let i = 0; i < 200; i++) units.push({ owner: i % 2, kind: i % 5 === 0 ? 'scout' : 'trooper', tx: 4 + (i % 20), ty: 4 + Math.floor(i / 20) });
const game = createGame({ seed: 1, map, units });
submit(game, { type: 'move', player: 0, units: units.map((_, i) => i + 1).filter((id) => id % 2 === 1), x: 80 * FP, y: 80 * FP });
submit(game, { type: 'move', player: 1, units: units.map((_, i) => i + 1).filter((id) => id % 2 === 0), x: 20 * FP, y: 80 * FP });

const N = 1200;
let worst = 0;
let total = 0;
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  tick(game);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  total += ms;
  worst = Math.max(worst, ms);
}
const avg = total / N;
console.log(`sim tick with 200 moving units: avg ${avg.toFixed(3)} ms, worst ${worst.toFixed(3)} ms over ${N} ticks`);

const AVG_BUDGET_MS = 8;
const WORST_BUDGET_MS = 50;
if (avg > AVG_BUDGET_MS || worst > WORST_BUDGET_MS) {
  console.error(`Tick budget exceeded (avg ${AVG_BUDGET_MS} ms, worst ${WORST_BUDGET_MS} ms)`);
  process.exit(1);
}
