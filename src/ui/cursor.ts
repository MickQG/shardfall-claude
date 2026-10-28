export type CursorId = 'default' | 'select' | 'move' | 'attack' | 'attackmove' | 'invalid' | 'place-ok' | 'place-bad' | 'superweapon';

export interface CursorState {
  mode: 'normal' | 'placing' | 'targeting' | 'amove';
  ctrl: boolean;
  combatSelected: boolean;
  anySelected: boolean;
  /** What is under the pointer. */
  hover: 'ground' | 'ownUnit' | 'ownBuilding' | 'enemy' | 'blocked';
  placementOk?: boolean;
}

/** Which cursor to show: a pure function of the UI state. */
export function cursorFor(s: CursorState): CursorId {
  if (s.mode === 'targeting') return 'superweapon';
  if (s.mode === 'placing') return s.placementOk ? 'place-ok' : 'place-bad';
  if (s.mode === 'amove' || (s.ctrl && s.combatSelected)) return 'attackmove';
  if (s.anySelected && s.combatSelected && s.hover === 'enemy') return 'attack';
  if (s.anySelected && s.hover === 'blocked') return 'invalid';
  if (s.hover === 'ownUnit' || s.hover === 'ownBuilding') return 'select';
  if (s.anySelected) return 'move';
  return 'default';
}

const svg = (body: string): string => `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'>${body}</svg>`;
const ring = (c: string): string => `<circle cx='16' cy='16' r='9' fill='none' stroke='${c}' stroke-width='2'/>`;
const cross = (c: string): string => `<path d='M16 2v8M16 22v8M2 16h8M22 16h8' stroke='${c}' stroke-width='2.5' stroke-linecap='round'/>`;
const OUT = '#04130d';

const ART: Record<CursorId, { body: string; hot: [number, number]; fallback: string }> = {
  default: { body: `<path d='M5 3l0 20 5-5 4 9 4-2-4-9 7 0z' fill='#dfe8e2' stroke='${OUT}' stroke-width='1.5' stroke-linejoin='round'/>`, hot: [5, 3], fallback: 'default' },
  select: { body: `<path d='M5 3l0 20 5-5 4 9 4-2-4-9 7 0z' fill='#7ff5cd' stroke='${OUT}' stroke-width='1.5' stroke-linejoin='round'/><rect x='19' y='19' width='10' height='10' fill='none' stroke='#7ff5cd' stroke-width='2'/>`, hot: [5, 3], fallback: 'pointer' },
  move: { body: `${ring('#7ff5cd')}<path d='M16 5l4 5h-8zM16 27l4-5h-8zM5 16l5 4v-8zM27 16l-5 4v-8z' fill='#7ff5cd'/>`, hot: [16, 16], fallback: 'move' },
  attack: { body: `${ring('#ff5a4a')}${cross('#ff5a4a')}<circle cx='16' cy='16' r='2' fill='#ff5a4a'/>`, hot: [16, 16], fallback: 'crosshair' },
  attackmove: { body: `${ring('#ff9a3c')}${cross('#ff3b30')}<path d='M12 12l8 8M20 12l-8 8' stroke='#ff9a3c' stroke-width='2'/>`, hot: [16, 16], fallback: 'crosshair' },
  invalid: { body: `${ring('#ff5a4a')}<path d='M10 10l12 12' stroke='#ff5a4a' stroke-width='3'/>`, hot: [16, 16], fallback: 'not-allowed' },
  'place-ok': { body: `<path d='M6 17l7 7 13-14' fill='none' stroke='#3cff8a' stroke-width='4' stroke-linecap='round' stroke-linejoin='round'/>`, hot: [16, 16], fallback: 'default' },
  'place-bad': { body: `<path d='M8 8l16 16M24 8L8 24' stroke='#ff4a4a' stroke-width='4' stroke-linecap='round'/>`, hot: [16, 16], fallback: 'not-allowed' },
  superweapon: { body: `${ring('#ffd34a')}${cross('#ffd34a')}<circle cx='16' cy='16' r='13' fill='none' stroke='#ffd34a' stroke-width='1' stroke-dasharray='3 3'/>`, hot: [16, 16], fallback: 'crosshair' },
};

/** CSS `cursor` value for a cursor id: an inline SVG with a built-in fallback. */
export function cursorCss(id: CursorId): string {
  const a = ART[id];
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg(a.body))}") ${a.hot[0]} ${a.hot[1]}, ${a.fallback}`;
}
