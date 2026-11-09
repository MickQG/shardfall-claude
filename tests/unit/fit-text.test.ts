import { describe, expect, it } from 'vitest';
import { fitSize } from '../../src/ui/fitText';

describe('hero line fitting (MENU-7)', () => {
  it('MENU-7: fitSize keeps 12 px when the line fits, shrinks in half-pixel steps to the largest size that fits, and stops at 9 px', () => {
    const width = (perPx: number) => (px: number) => perPx * px;
    expect(fitSize(width(30), 400)).toBe(12);
    expect(fitSize(width(40), 400)).toBe(10);
    expect(fitSize(width(34), 400)).toBe(11.5);
    expect(fitSize(width(100), 400)).toBe(9);
  });
});
