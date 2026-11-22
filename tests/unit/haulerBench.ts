import { createGame, tick, type Game, type MapDef } from '../../src/sim';

/** Deterministic hauler bench (ECO-10): income of k haulers on one refinery over a fixed window, on flat open ground. */

export type HaulerFaction = 'human' | 'alien';

const W = 64;
/** Refinery footprint's top-left tile; its pad is on the east side, facing the field. */
const REF = { tx: 12, ty: 30 };
/** Ticks (20 a second) before measuring: 30 s, enough for every hauler to settle into its round trip. */
export const WARMUP_TICKS = 20 * 30;
/** Ticks measured: 3 minutes. */
export const WINDOW_TICKS = 20 * 180;
/** Shards on each field tile for the bench, large enough that depletion never limits income (Uint16 holds 65535). */
const TILE_AMOUNT = 60000;

const kinds = (f: HaulerFaction): { refinery: string; hauler: string } => (f === 'human' ? { refinery: 'hum_refinery', hauler: 'hum_hauler' } : { refinery: 'ali_extractor', hauler: 'ali_gorger' });

/** The `n` tiles nearest a centre, as a compact disc (13 is a diamond of radius 2, 21 a rounded square), as offsets from the centre. */
export function discTiles(n: number): [number, number][] {
  const R = 8;
  const all: [number, number][] = [];
  for (let y = -R; y <= R; y++) for (let x = -R; x <= R; x++) all.push([x, y]);
  all.sort((a, b) => a[0] ** 2 + a[1] ** 2 - (b[0] ** 2 + b[1] ** 2) || a[1] - b[1] || a[0] - b[0]);
  return all.slice(0, n);
}

function build(faction: HaulerFaction, fieldTiles: number, padDistance: number, haulers: number, amount: number, padGuess: [number, number]): Game {
  const disc = discTiles(fieldTiles);
  const minX = Math.min(...disc.map(([x]) => x));
  // Translate the disc so its nearest column lies `padDistance` tiles east of the pad, centred on the pad's row.
  const ox = padGuess[0] + padDistance - minX;
  const oy = padGuess[1];
  const shards = new Array<number>(W * W).fill(0);
  for (const [x, y] of disc) shards[(oy + y) * W + ox + x] = amount;
  const map: MapDef = { width: W, height: W, heights: new Array<number>(W * W).fill(0), blocked: new Array<number>(W * W).fill(0), shards };
  const k = kinds(faction);
  return createGame({
    seed: 1,
    map,
    players: [
      { faction, credits: 0 },
      { faction: 'alien', credits: 0 },
    ],
    buildings: [{ owner: 0, kind: k.refinery, tx: REF.tx, ty: REF.ty }, { owner: 1, kind: 'ali_hq', tx: 56, ty: 56 }],
    // Start in a block south of the refinery; the warm-up settles them into their round trip.
    units: Array.from({ length: haulers }, (_, i) => ({ owner: 0, kind: k.hauler, tx: 6 + (i % 6), ty: 40 + Math.floor(i / 6) * 2 })),
  });
}

/** A fresh bench scene. The dock pad depends on where the shards lie, so it is found first and the field laid out on its row. */
export function benchScene(faction: HaulerFaction, fieldTiles: number, padDistance: number, haulers: number, amount = TILE_AMOUNT): Game {
  let guess: [number, number] = [REF.tx + 3, REF.ty];
  for (let i = 0; i < 4; i++) {
    const g = build(faction, fieldTiles, padDistance, haulers, amount, guess);
    const pad = g.state.buildings[0]?.pad as [number, number];
    if (pad[0] === guess[0] && pad[1] === guess[1]) return g;
    guess = pad;
  }
  throw new Error('hauler bench: the dock pad did not settle');
}

/** Shards delivered over the measured window (3 minutes after a 30 second warm-up) by `haulers` haulers. */
export function measureIncome(faction: HaulerFaction, fieldTiles: number, padDistance: number, haulers: number): number {
  const g = benchScene(faction, fieldTiles, padDistance, haulers);
  for (let i = 0; i < WARMUP_TICKS; i++) tick(g);
  const c0 = g.state.players[0]?.credits ?? 0;
  for (let i = 0; i < WINDOW_TICKS; i++) tick(g);
  return (g.state.players[0]?.credits ?? 0) - c0;
}

/** Most haulers the sweep tries on one refinery. */
export const MAX_HAULERS = 30;

/**
 * Incomes (index k-1 for k haulers) measured until two haulers in a row have added less than half of a lone hauler's
 * income, or `MAX_HAULERS`. The ideal count is then idealFromIncomes of that.
 */
export function sweepIncomes(faction: HaulerFaction, fieldTiles: number, padDistance: number): number[] {
  const inc: number[] = [];
  let weak = 0;
  for (let k = 1; k <= MAX_HAULERS; k++) {
    inc.push(measureIncome(faction, fieldTiles, padDistance, k));
    if (k > 1 && (inc[k - 1] as number) - (inc[k - 2] as number) < 0.5 * (inc[0] as number)) weak++;
    else weak = 0;
    if (weak >= 2) break;
  }
  return inc;
}

/** Largest k whose extra hauler still adds at least half of a lone hauler's income (ECO-10), from incomes[0] = one hauler. */
export function idealFromIncomes(incomes: readonly number[]): number {
  const one = incomes[0] as number;
  let ideal = 1;
  for (let k = 2; k <= incomes.length; k++) if ((incomes[k - 1] as number) - (incomes[k - 2] as number) >= 0.5 * one) ideal = k;
  return ideal;
}
