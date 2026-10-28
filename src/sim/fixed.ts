/** Fixed-point scale: 1 tile = 256 units. */
export const FP = 256;
export const HALF = FP / 2;

export const tileOf = (v: number): number => Math.floor(v / FP);
export const centerOf = (tile: number): number => tile * FP + HALF;

/** Integer square root (floor), deterministic for non-negative safe integers. */
export function isqrt(n: number): number {
  if (n < 2) return n;
  let x = Math.floor(Math.sqrt(n));
  while (x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}
