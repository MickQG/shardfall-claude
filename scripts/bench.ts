import { demoMap } from '../src/data/maps';
import { createGame, FP, submit, tick, type UnitSpawn } from '../src/sim';

const map = demoMap();
const units: UnitSpawn[] = [];
for (let i = 0; i < 200; i++) units.push({ owner: i % 2, kind: i % 5 === 0 ? 'hum_buggy' : 'hum_rifleman', tx: 4 + (i % 20), ty: 4 + Math.floor(i / 20) });
const game = createGame({ seed: 1, map, units });
submit(game, { type: 'move', player: 0, units: units.map((_, i) => i + 1).filter((id) => id % 2 === 1), x: 80 * FP, y: 80 * FP });
submit(game, { type: 'move', player: 1, units: units.map((_, i) => i + 1).filter((id) => id % 2 === 0), x: 20 * FP, y: 80 * FP });

const N = 1200;
/** JIT warm-up ticks are excluded from the worst-case check. */
const WARMUP = 20;
const samples: number[] = [];
let total = 0;
for (let i = 0; i < N; i++) {
  const t0 = process.hrtime.bigint();
  tick(game);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  total += ms;
  if (i >= WARMUP) samples.push(ms);
}
const avg = total / N;
samples.sort((a, c) => a - c);
const p99 = samples[Math.floor(samples.length * 0.99)] as number;
const worst = samples.at(-1) as number;
console.log(`sim tick with 200 moving units: avg ${avg.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, worst ${worst.toFixed(3)} ms over ${N} ticks`);

// p99 (not the single worst tick) keeps the budget robust against GC pauses and noisy machines
// while still catching any sustained slowdown. A 20 Hz tick has a 50 ms frame; leave most of it to rendering.
const AVG_BUDGET_MS = 8;
const P99_BUDGET_MS = 12;
if (avg > AVG_BUDGET_MS || p99 > P99_BUDGET_MS) {
  console.error(`Tick budget exceeded (avg ${AVG_BUDGET_MS} ms, p99 ${P99_BUDGET_MS} ms)`);
  process.exit(1);
}
