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
 * The Shardfall wordmark (MENU-8): a flat shard emblem split by a diagonal fracture into two pieces (the upper one shifted
 * up and right), beside SHARDFALL in the heading face. A hairline fracture at 4 degrees slices the letters: the word is drawn
 * twice, clipped above and below the line, with the upper half nudged along it. Flat fills only. The text is fitted with
 * `textLength`, so it fills the same width whichever face the device has. `idPrefix` keeps clip ids unique per instance.
 */
export function wordmarkSvg(idPrefix = 'wm'): string {
  const up = `${idPrefix}-up`;
  const lo = `${idPrefix}-lo`;
  // Fracture line through the word: y = 23.5 - 0.0699 (x - 142), 4 degrees; the clips leave a 1 px gap around it.
  const y = (x: number, d: number): string => (23.5 - 0.0699 * (x - 142) + d).toFixed(2);
  const band = (d: number, edge: number): string => `0,${edge} 252,${edge} 252,${y(252, d)} 0,${y(0, d)}`;
  const text = (extra: string): string =>
    `<text${extra} x="32" y="37" textLength="220" lengthAdjust="spacingAndGlyphs" style="fill:var(--ink,#eef4f8);font-family:var(--font-head);font-stretch:87.5%;font-weight:700;font-size:38px;letter-spacing:.05em" aria-hidden="true">SHARD<tspan style="fill:var(--accent,#6fd3ff)">FALL</tspan></text>`;
  // Emblem: a 20 x 48 diamond cut along y = 29 - 0.6x; the upper piece moves up and right, leaving a gap of about 1.5 px.
  return `<svg class="wordmark" viewBox="0 0 252 48" role="img" aria-label="Shardfall" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="${up}"><polygon points="${band(-0.5, 0)}"/></clipPath><clipPath id="${lo}"><polygon points="${band(0.5, 48)}"/></clipPath></defs>`
    + `<g transform="translate(2 5) scale(.87)"><polygon points="10,0 18.21,18.07 2.19,27.69 0,22" transform="translate(.95 -2.3)" style="fill:var(--accent,#6fd3ff)"/><polygon points="18.21,18.07 20,22 10,48 2.19,27.69" style="fill:var(--ink,#eef4f8);fill-opacity:.85"/></g>`
    + `<g clip-path="url(#${up})"><g transform="translate(1.5 -.1)">${text('')}</g></g><g clip-path="url(#${lo})">${text('')}</g></svg>`;
}
