import { Container, Graphics } from 'pixi.js';
import { UNIT_DEFS } from '../data/defs';
import { OWNER_COLORS } from './colors';
import { octantVector } from './gfx';

export type Shape = 'soldier' | 'rocketeer' | 'buggy' | 'tank' | 'artillery' | 'hauler' | 'gunship' | 'skitter' | 'spitter' | 'stalker' | 'brute' | 'lobber' | 'wasp' | 'gorger';

/** One drawing per unit kind. Size is the unit's visual footprint scale. */
export const ART: Readonly<Record<string, { shape: Shape; size: number }>> = {
  hum_rifleman: { shape: 'soldier', size: 1 },
  hum_rocketeer: { shape: 'rocketeer', size: 1 },
  hum_buggy: { shape: 'buggy', size: 1.1 },
  hum_tank: { shape: 'tank', size: 1.5 },
  hum_artillery: { shape: 'artillery', size: 1.5 },
  hum_hauler: { shape: 'hauler', size: 1.6 },
  hum_gunship: { shape: 'gunship', size: 1.4 },
  ali_skitter: { shape: 'skitter', size: 0.9 },
  ali_spitter: { shape: 'spitter', size: 1 },
  ali_stalker: { shape: 'stalker', size: 1.1 },
  ali_brute: { shape: 'brute', size: 1.6 },
  ali_lobber: { shape: 'lobber', size: 1.4 },
  ali_wasp: { shape: 'wasp', size: 1.2 },
  ali_gorger: { shape: 'gorger', size: 1.6 },
};

export interface UnitArt {
  root: Container;
  /** Everything that flips and bobs. */
  body: Container;
  rotor: Graphics | null;
  load: Graphics | null;
  /** Aimable weapon barrel (lives in the flipped body, so it is counter-flipped when drawn). */
  barrel: Graphics | null;
  barrelSpec: BarrelSpec | null;
  /** Octant the barrel is currently drawn at, or -1. */
  aim: number;
  air: boolean;
  size: number;
  owner: number;
}

interface BarrelSpec {
  y: number;
  len: number;
  w: number;
  color: number;
}

/** Weapon barrels that track a heading; the shapes not listed here have no aimable weapon. */
const BARRELS: Partial<Record<Shape, BarrelSpec>> = {
  soldier: { y: -9, len: 9, w: 2.5, color: 0x222c36 },
  rocketeer: { y: -14, len: 10, w: 4, color: 0x4a5866 },
  buggy: { y: -11, len: 9, w: 2.5, color: 0x2c3742 },
  tank: { y: -15, len: 17, w: 3.5, color: 0x4a5866 },
  artillery: { y: -15, len: 21, w: 4.5, color: 0x4a5866 },
  spitter: { y: -11, len: 8, w: 3.5, color: 0xb6ff5c },
};

/** Soft top-light highlight per shape: [x, y, rx, ry] in body space. */
const HIGHLIGHT: Partial<Record<Shape, [number, number, number, number]>> = {
  soldier: [-1.5, -10, 2, 3.5],
  rocketeer: [-1.5, -10, 2, 3.5],
  buggy: [-2, -10, 7, 2],
  tank: [-2, -11, 10, 2],
  artillery: [-2, -9, 9, 1.6],
  hauler: [4, -14, 9, 1.8],
  skitter: [-1, -8, 2.5, 3],
  spitter: [-3, -9, 3, 3],
  stalker: [-2, -6, 8, 1.5],
  brute: [-4, -13, 6, 3],
  lobber: [-4, -9, 6, 2],
  gorger: [-5, -11, 8, 2.4],
};

const METAL = 0x93a6bb;
const DARK = 0x35424f;
const HIVE = 0x8a56b8;
const HIVE_DARK = 0x3d2552;
const GLOW = 0xb6ff5c;

export function drawUnit(kind: string, owner: number): UnitArt {
  const art = ART[kind];
  if (!art) throw new Error(`no art for ${kind}`);
  const team = OWNER_COLORS[owner] ?? 0xffffff;
  const root = new Container();
  const body = new Container();
  const g = new Graphics();
  const air = !!UNIT_DEFS[kind]?.air;
  let rotor: Graphics | null = null;
  let load: Graphics | null = null;

  // Ground shadow (stays on the ground even when the body hovers).
  const shadow = new Graphics();
  shadow.ellipse(0, 4, 11 * art.size, 5 * art.size).fill({ color: 0x000000, alpha: 0.35 });
  root.addChild(shadow);
  body.addChild(g);

  switch (art.shape) {
    case 'soldier':
      g.ellipse(0, -7, 5, 7).fill(METAL).stroke({ color: DARK, width: 1.5 });
      g.circle(0, -16, 4).fill(0xcdd8e4).rect(-3, -18, 6, 2).fill(team);
      break;
    case 'rocketeer':
      g.ellipse(0, -7, 5.5, 7.5).fill(METAL).stroke({ color: DARK, width: 1.5 });
      g.circle(0, -16, 4).fill(0xcdd8e4).rect(-3, -18, 6, 2).fill(team);
      g.rect(-7, -16, 14, 4).fill(0x4a5866);
      break;
    case 'buggy':
      g.poly([-13, -4, -8, -11, 9, -11, 14, -4]).fill(METAL).stroke({ color: DARK, width: 1.5 });
      g.rect(-4, -15, 8, 4).fill(team);
      g.circle(-9, -1, 4).fill(0x1a1f26).circle(9, -1, 4).fill(0x1a1f26);
      break;
    case 'tank':
      g.rect(-15, -9, 30, 11).fill(DARK).stroke({ color: 0x1a232d, width: 1.5 });
      g.rect(-13, -12, 26, 5).fill(METAL);
      g.ellipse(0, -15, 9, 6).fill(METAL).stroke({ color: DARK, width: 1.5 });
      g.rect(-15, -2, 30, 3).fill(0x1a1f26);
      g.rect(-4, -11, 8, 2).fill(team);
      break;
    case 'artillery':
      g.rect(-14, -7, 28, 9).fill(DARK).stroke({ color: 0x1a232d, width: 1.5 });
      g.rect(-10, -10, 20, 4).fill(METAL);
      g.rect(-4, -9, 6, 2).fill(team);
      break;
    case 'hauler':
      g.rect(-16, -8, 32, 10).fill(DARK).stroke({ color: 0x1a232d, width: 1.5 });
      g.rect(-16, -14, 11, 8).fill(METAL).rect(-14, -13, 7, 3).fill(0x9fe8ff);
      g.rect(-4, -16, 20, 10).fill(0x56677a).stroke({ color: DARK, width: 1 });
      g.rect(-16, -3, 32, 2).fill(team);
      g.circle(-10, 2, 3.5).fill(0x1a1f26).circle(10, 2, 3.5).fill(0x1a1f26);
      load = new Graphics();
      body.addChild(load);
      break;
    case 'gunship':
      g.ellipse(0, -22, 13, 6).fill(METAL).stroke({ color: DARK, width: 1.5 });
      g.poly([-14, -22, -22, -26, -22, -20]).fill(DARK).rect(-4, -26, 8, 3).fill(team);
      g.rect(-1, -30, 2, 5).fill(0x1a232d);
      rotor = new Graphics();
      body.addChild(rotor);
      break;
    case 'skitter':
      g.poly([0, -12, 8, -4, 0, 2, -8, -4]).fill(HIVE).stroke({ color: HIVE_DARK, width: 1.5 });
      for (const s of [-1, 1]) for (const k of [0, 1, 2]) g.moveTo(s * 5, -4 + k * 2).lineTo(s * (11 + k), -1 + k * 3).stroke({ color: HIVE_DARK, width: 1.5 });
      g.circle(2, -8, 1.8).fill(team).circle(-2, -8, 1.8).fill(team);
      break;
    case 'spitter':
      g.ellipse(0, -7, 8, 7).fill(HIVE).stroke({ color: HIVE_DARK, width: 1.5 });
      g.circle(5, -12, 4).fill(GLOW).circle(-4, -11, 2.5).fill({ color: GLOW, alpha: 0.7 });
      g.circle(2, -9, 1.6).fill(team);
      break;
    case 'stalker':
      g.poly([-14, -3, 12, -7, 16, -4, 12, -1, -10, 1]).fill(HIVE).stroke({ color: HIVE_DARK, width: 1.5 });
      g.poly([-4, -8, 0, -16, 4, -8]).fill(HIVE_DARK).circle(12, -5, 1.6).fill(team);
      break;
    case 'brute':
      g.ellipse(0, -9, 14, 11).fill(HIVE).stroke({ color: HIVE_DARK, width: 2 });
      g.poly([-8, -18, -4, -28, 0, -18]).fill(HIVE_DARK).poly([2, -18, 6, -28, 10, -18]).fill(HIVE_DARK);
      g.rect(-16, -8, 6, 12).fill(HIVE_DARK).rect(10, -8, 6, 12).fill(HIVE_DARK);
      g.circle(4, -11, 2.4).fill(team);
      break;
    case 'lobber':
      g.ellipse(0, -6, 13, 8).fill(HIVE).stroke({ color: HIVE_DARK, width: 1.5 });
      g.circle(-2, -16, 8).fill({ color: GLOW, alpha: 0.8 }).stroke({ color: HIVE_DARK, width: 1.5 });
      g.circle(6, -10, 2).fill(team);
      break;
    case 'wasp':
      g.ellipse(0, -22, 9, 5).fill(HIVE).stroke({ color: HIVE_DARK, width: 1.5 });
      g.poly([6, -22, 14, -22, 8, -19]).fill(0xffd34a).circle(-6, -23, 1.8).fill(team);
      rotor = new Graphics();
      body.addChild(rotor);
      break;
    case 'gorger':
      g.ellipse(0, -7, 17, 10).fill(HIVE).stroke({ color: HIVE_DARK, width: 2 });
      g.ellipse(-6, -13, 9, 7).fill(HIVE_DARK);
      g.circle(11, -9, 3).fill(team);
      load = new Graphics();
      body.addChild(load);
      break;
  }
  const hl = HIGHLIGHT[art.shape];
  if (hl) body.addChild(new Graphics().ellipse(hl[0], hl[1], hl[2], hl[3]).fill({ color: 0xffffff, alpha: 0.2 }));
  const barrelSpec = BARRELS[art.shape] ?? null;
  let barrel: Graphics | null = null;
  if (barrelSpec) {
    barrel = new Graphics();
    body.addChild(barrel);
  }
  body.scale.set(art.size);
  root.addChild(body);
  return { root, body, rotor, load, barrel, barrelSpec, aim: -1, air, size: art.size, owner };
}

/** Per-frame animation: bobbing while moving, spinning rotors, crystal load on haulers. `facing` is +1 or -1. */
/** Points the unit's weapon barrel along octant `o` (0 = right, clockwise). Redraws only when the heading changes. */
export function aimUnit(a: UnitArt, o: number): void {
  if (!a.barrel || !a.barrelSpec || a.aim === o) return;
  a.aim = o;
  const v = octantVector(o);
  const s = a.barrelSpec;
  a.barrel.clear();
  a.barrel.moveTo(0, s.y).lineTo(v.x * s.len, s.y + v.y * s.len).stroke({ color: s.color, width: s.w, cap: 'round' });
  a.barrel.circle(0, s.y, s.w * 0.9).fill(s.color);
}

export function animateUnit(a: UnitArt, t: number, moving: boolean, facing: number, loadFrac: number, motion: boolean): void {
  a.body.scale.x = a.size * facing;
  if (a.barrel) a.barrel.scale.x = facing;
  a.body.y = motion ? (moving ? Math.sin(t / 70) * 1.2 : 0) + (a.air ? Math.sin(t / 400) * 2 : 0) : 0;
  if (a.rotor) {
    a.rotor.clear();
    const spin = motion ? Math.sin(t / 25) : 1;
    a.rotor.ellipse(0, -30, 16 * Math.abs(spin) + 3, 3).fill({ color: 0xffffff, alpha: 0.5 });
  }
  if (a.load) {
    a.load.clear();
    if (loadFrac > 0) for (let i = 0; i < Math.ceil(loadFrac * 3); i++) a.load.poly([-2 + i * 5, -15, 1 + i * 5, -22, 4 + i * 5, -15]).fill(0x35e0a1);
  }
}
