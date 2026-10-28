import { demoMap } from '../src/data/maps';
import { createGame, tick } from '../src/sim';

const game = createGame({ seed: 1, map: demoMap() });
const N = 2000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) tick(game);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
const per = ms / N;
console.log(`sim tick: ${per.toFixed(4)} ms avg over ${N} ticks`);

const BUDGET_MS = 10;
if (per > BUDGET_MS) {
  console.error(`Tick budget exceeded (${BUDGET_MS} ms)`);
  process.exit(1);
}
