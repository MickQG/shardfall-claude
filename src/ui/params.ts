/**
 * A game seed from the address bar (SEC-3): a whole number of up to nine digits, or else `fallback`. Anything else
 * (letters, signs, decimals, huge numbers) would reach the simulation as NaN, Infinity or a fraction.
 */
export function seedOf(raw: string | null, fallback: number): number {
  return raw !== null && /^\d{1,9}$/.test(raw) ? Number(raw) : fallback;
}
