import type { BakeStyle } from './bake';

/** The art style chosen once at startup (`?gfx=next` selects 'next'); read by the sprite cache and building heights. */
export const renderStyle: { current: BakeStyle } = { current: 'classic' };
