/**
 * The two faction skins (UI-16, MENU-12), the font stacks (MENU-9) and the wordmark (MENU-8). The menu, HUD, sidebar,
 * loading screen and score screen read only these tokens: `data-faction="human|alien"` on a root element with the
 * `skin` class chooses the skin. Everything is CSS custom properties and inline SVG; no font or image file exists.
 */
export type SkinId = 'human' | 'alien';

/** Headings and labels: a condensed face already on the device (MENU-9). */
export const FONT_HEAD = "'Bahnschrift', 'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', sans-serif";
/** Body text (MENU-9). */
export const FONT_BODY = "'Bahnschrift', 'Segoe UI', system-ui, sans-serif";

const SHARED: Record<string, string> = { '--ink': '#dfe8e2', '--ink-dim': '#9fb1c2', '--void': '#070b10', '--bad': '#ff9a8a', '--good': '#8fe0a8', '--badge-bg': '#3a2f12' };

/** Colour tokens of each skin. Solid `--panel-top`/`--panel-bot` are the opaque equivalents of the panel gradient, for the contrast check (UI-21). */
export const SKINS: Record<SkinId, Record<string, string>> = {
  human: {
    '--accent': '#6fd3ff',
    '--accent-2': '#6fd3ff',
    '--accent-ink': '#04121a',
    '--warn': '#e0b040',
    '--panel': 'linear-gradient(180deg, rgba(24,34,46,.92), rgba(10,15,22,.92))',
    '--glass': 'linear-gradient(180deg, rgba(24,34,46,.88), rgba(10,15,22,.9))',
    '--panel-top': '#17202c',
    '--panel-bot': '#0a0f16',
    '--field': '#0d151e',
    '--sel-bg': '#12303f',
    '--edge': '#3d5b76',
    '--edge-hi': '#a9c2d6',
    '--btn-bg': 'linear-gradient(#6fd3ff, #3da8d8)',
    '--btn-lo': '#3da8d8',
    '--wm-1': '#f2f7fb',
    '--wm-2': '#b9cddd',
    '--wm-3': '#5f7f99',
    '--wm-4': '#d3e4f0',
    // Angular frames: a 10 px chamfer on the top-left and bottom-right corners, and a 1 px top bevel.
    '--r': '0',
    '--r-s': '0',
    '--clip': 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)',
    '--clip-s': 'polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px)',
    '--frame-shadow': 'inset 0 1px 0 var(--edge-hi)',
    '--hazard': 'repeating-linear-gradient(135deg, var(--warn) 0 5px, transparent 5px 10px)',
    '--hazard-h': '3px',
  },
  alien: {
    '--accent': '#b6ff5c',
    '--accent-2': '#e0a43a',
    '--accent-ink': '#0f1406',
    '--warn': '#e0a43a',
    '--panel': 'radial-gradient(120% 140% at 0% 0%, rgba(38,34,18,.92), rgba(12,11,7,.92))',
    '--glass': 'radial-gradient(120% 140% at 0% 0%, rgba(38,34,18,.88), rgba(12,11,7,.9))',
    '--panel-top': '#242011',
    '--panel-bot': '#0b0b07',
    '--field': '#11110a',
    '--sel-bg': '#222d0e',
    '--edge': '#55602c',
    '--edge-hi': '#8c9a4a',
    '--btn-bg': 'linear-gradient(#b6ff5c, #7bc22a)',
    '--btn-lo': '#7bc22a',
    '--wm-1': '#f4ffd9',
    '--wm-2': '#c8f070',
    '--wm-3': '#7da832',
    '--wm-4': '#e0a43a',
    // Organic chitin frames: asymmetric corners and a faint inner glow.
    '--r': '18px 6px 18px 6px',
    '--r-s': '10px 4px 10px 4px',
    '--clip': 'none',
    '--clip-s': 'none',
    '--frame-shadow': 'inset 0 0 14px rgba(182,255,92,.10)',
    '--hazard': 'linear-gradient(90deg, var(--accent-2), transparent 85%)',
    '--hazard-h': '2px',
  },
};

/** Pairs of text colour and the colour behind it that the skins must keep readable (UI-21). */
export const CONTRAST_PAIRS: readonly { fg: string; bg: string; large?: boolean }[] = [
  ...['--panel-top', '--panel-bot', '--field', '--sel-bg', '--void'].flatMap((bg) => ['--ink', '--ink-dim', '--accent'].map((fg) => ({ fg, bg }))),
  ...['--panel-top', '--panel-bot'].flatMap((bg) => ['--accent-2', '--warn', '--bad', '--good'].map((fg) => ({ fg, bg }))),
  { fg: '--warn', bg: '--badge-bg' },
  { fg: '--accent-ink', bg: '--accent' },
  { fg: '--accent-ink', bg: '--btn-lo' },
  { fg: '--wm-2', bg: '--void', large: true },
];

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** The token value of a skin, falling back to the shared ones. */
export const tokenOf = (skin: SkinId, name: string): string => SKINS[skin][name] ?? SHARED[name] ?? '';

const decl = (m: Record<string, string>): string => Object.entries(m).map(([k, v]) => `${k}: ${v};`).join(' ');

/** Skin tokens, font variables and the shared frame helpers every skinned root can use. */
export function themeCss(): string {
  return `
.skin { ${decl(SHARED)} --font-head: ${FONT_HEAD}; --font-body: ${FONT_BODY}; font-family: var(--font-body); color: var(--ink); }
.skin[data-faction="human"] { ${decl(SKINS.human)} }
.skin[data-faction="alien"] { ${decl(SKINS.alien)} }
.skin .head, .skin h1, .skin h2, .skin h3, .skin h4 { font-family: var(--font-head); font-stretch: 87.5%; text-transform: uppercase; letter-spacing: .1em; }
.skin .frame { background: var(--panel); border: 1px solid var(--edge); border-radius: var(--r); clip-path: var(--clip); box-shadow: var(--frame-shadow); }
.skin .hdr { position: relative; padding-bottom: 6px; }
.skin .hdr::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: var(--hazard-h); background: var(--hazard); opacity: .35; border-radius: 2px; }
`;
}

/** Adds the theme to the page once. */
export function ensureTheme(): void {
  if (document.getElementById('theme-css')) return;
  const s = document.createElement('style');
  s.id = 'theme-css';
  s.textContent = themeCss();
  document.head.appendChild(s);
}

/**
 * The Shardfall wordmark (MENU-8): a faceted shard emblem from four polygons beside SHARDFALL in the heading face with a
 * metallic gradient fill. Its text is fitted with `textLength`, so it fills the same width whichever face the device has.
 */
export function wordmarkSvg(idPrefix = 'wm'): string {
  const g = `${idPrefix}-metal`;
  const facets: [string, number][] = [
    ['22,2 6,20 20,22', 0.95],
    ['22,2 20,22 38,16', 0.62],
    ['6,20 18,46 20,22', 0.45],
    ['20,22 18,46 38,16', 0.8],
  ];
  const poly = facets.map(([p, o]) => `<polygon points="${p}" style="fill:var(--accent,#6fd3ff);fill-opacity:${o};stroke:var(--edge-hi,#a9c2d6);stroke-width:1;stroke-linejoin:round"/>`).join('');
  return `<svg class="wordmark" viewBox="0 0 252 48" role="img" aria-label="Shardfall" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--wm-1,#f2f7fb)"/><stop offset=".48" style="stop-color:var(--wm-2,#b9cddd)"/><stop offset=".52" style="stop-color:var(--wm-3,#5f7f99)"/><stop offset="1" style="stop-color:var(--wm-4,#d3e4f0)"/></linearGradient></defs>${poly}<text x="50" y="37" textLength="200" lengthAdjust="spacingAndGlyphs" fill="url(#${g})" style="font-family:var(--font-head);font-stretch:87.5%;font-weight:700;font-size:38px;letter-spacing:.06em" aria-hidden="true">SHARDFALL</text></svg>`;
}
