import { Container, Graphics } from 'pixi.js';
import { buildingDef } from '../data/defs';
import { OWNER_COLORS } from './colors';
import { HEIGHT_PX, tileToScreen } from './iso';

interface Style {
  /** Wall height in px. */
  h: number;
  wallL: number;
  wallR: number;
  roof: number;
  glow: number;
}

const HUMAN: Omit<Style, 'h'> = { wallL: 0x4d5d70, wallR: 0x3a4757, roof: 0x7e90a6, glow: 0x6fd3ff };
const ALIEN: Omit<Style, 'h'> = { wallL: 0x4b3a5e, wallR: 0x372a47, roof: 0x7a5c94, glow: 0xb6ff5c };

const HEIGHTS: Record<string, number> = {
  hq: 46, reactor: 30, generator: 28, refinery: 26, extractor: 26, barracks: 26, nest: 26, factory: 34, pit: 34,
  turret: 34, spire: 38, lab: 38, evolver: 38, lance: 70, rift: 64,
};

const kindKey = (kind: string): string => kind.slice(4);

function poly(g: Graphics, pts: { x: number; y: number }[], fill: number, alpha = 1): void {
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: fill, alpha });
}

/** Draws a procedural isometric building centred on its footprint origin (tile top corner = 0,0). */
export function drawBuilding(kind: string, owner: number): Container {
  const d = buildingDef(kind);
  const alien = d.faction === 'alien';
  const key = kindKey(kind);
  const st: Style = { ...(alien ? ALIEN : HUMAN), h: HEIGHTS[key] ?? 28 };
  const trim = OWNER_COLORS[owner] ?? 0xffffff;
  const root = new Container();
  const g = new Graphics();

  // Footprint corners relative to the building's top corner.
  const top = tileToScreen(0, 0);
  const right = tileToScreen(d.w, 0);
  const bottom = tileToScreen(d.w, d.h);
  const left = tileToScreen(0, d.h);
  const up = (p: { x: number; y: number }, n: number): { x: number; y: number } => ({ x: p.x, y: p.y - n });
  const inset = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, e: { x: number; y: number }, t: number): { x: number; y: number }[] => {
    const cx = (a.x + b.x + c.x + e.x) / 4;
    const cy = (a.y + b.y + c.y + e.y) / 4;
    return [a, b, c, e].map((p) => ({ x: p.x + (cx - p.x) * t, y: p.y + (cy - p.y) * t }));
  };

  // Ground shadow.
  poly(g, [top, right, bottom, left].map((p) => ({ x: p.x + 4, y: p.y + 6 })), 0x000000, 0.28);

  // Walls.
  poly(g, [left, bottom, up(bottom, st.h), up(left, st.h)], st.wallL);
  poly(g, [bottom, right, up(right, st.h), up(bottom, st.h)], st.wallR);
  // Roof.
  poly(g, [up(top, st.h), up(right, st.h), up(bottom, st.h), up(left, st.h)], st.roof);
  const roofIn = inset(up(top, st.h), up(right, st.h), up(bottom, st.h), up(left, st.h), 0.28);
  poly(g, roofIn, alien ? 0x4a3a5f : 0x5a6b80);

  // Rim light along the roof's lit (upper-left) edges.
  g.moveTo(up(left, st.h).x, up(left, st.h).y).lineTo(up(top, st.h).x, up(top, st.h).y).lineTo(up(right, st.h).x, up(right, st.h).y).stroke({ color: 0xffffff, width: 1.4, alpha: 0.4 });

  // Team trim strip along the base of the front walls.
  g.poly([left.x, left.y - 3, bottom.x, bottom.y - 3, bottom.x, bottom.y - 7, left.x, left.y - 7]).fill(trim);
  g.poly([bottom.x, bottom.y - 3, right.x, right.y - 3, right.x, right.y - 7, bottom.x, bottom.y - 7]).fill({ color: trim, alpha: 0.8 });

  // Windows / vents on the walls.
  const faces: [typeof left, typeof bottom][] = [[left, bottom], [bottom, right]];
  const n = Math.max(d.w, d.h) * 2;
  for (const [a, b] of faces) {
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      g.rect(x - 2, y - st.h * 0.62, 4, 6).fill({ color: st.glow, alpha: 0.75 });
    }
  }

  // Kind-specific roof details.
  const c = { x: (top.x + bottom.x) / 2, y: (top.y + bottom.y) / 2 - st.h };
  if (d.hq) {
    g.rect(c.x - 2, c.y - 26, 4, 26).fill(0x22303f);
    g.circle(c.x, c.y - 28, 5).fill(st.glow);
  } else if (key === 'reactor' || key === 'generator') {
    g.circle(c.x, c.y, 9).fill({ color: st.glow, alpha: 0.35 }).circle(c.x, c.y, 5).fill(st.glow);
  } else if (d.refinery) {
    g.ellipse(c.x - 6, c.y - 2, 12, 6).fill(0x2a3a47).ellipse(c.x - 6, c.y - 6, 12, 6).fill(alien ? 0x5d8f3b : 0x9fb4c6);
  } else if (d.weapon) {
    g.rect(c.x - 3, c.y - 14, 6, 14).fill(0x1a232d);
    g.poly([c.x - 7, c.y - 14, c.x + 7, c.y - 14, c.x, c.y - 24]).fill(trim);
  } else if (d.superweapon) {
    g.poly([c.x - 18, c.y, c.x + 18, c.y, c.x, c.y - 60]).fill({ color: st.glow, alpha: 0.5 });
    g.circle(c.x, c.y - 60, 7).fill(0xffffff);
  } else if (key === 'lab' || key === 'evolver') {
    g.ellipse(c.x, c.y, 14, 8).fill(st.glow).ellipse(c.x, c.y - 4, 10, 6).fill({ color: 0xffffff, alpha: 0.5 });
  } else {
    g.rect(c.x - 8, c.y - 4, 16, 8).fill({ color: st.glow, alpha: 0.6 });
  }

  root.addChild(g);
  return root;
}

/** Screen-space top corner of a building's footprint, for positioning the container. */
export const buildingOrigin = (tx: number, ty: number): { x: number; y: number } => tileToScreen(tx, ty);

/** Vertical extent used for hit-testing and health-bar placement. */
export const buildingHeight = (kind: string): number => (HEIGHTS[kindKey(kind)] ?? 28) + HEIGHT_PX;
