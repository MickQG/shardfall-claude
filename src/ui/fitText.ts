/** The largest size, from `max` down in `step` px to `min`, whose line is no wider than `slot` px (MENU-7). `measure(px)` is the line's width at that size. */
export function fitSize(measure: (px: number) => number, slot: number, max = 12, min = 9, step = 0.5): number {
  let px = max;
  while (px > min && measure(px) > slot) px -= step;
  return Math.max(min, px);
}
