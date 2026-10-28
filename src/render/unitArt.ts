import { Container, Graphics, Sprite } from 'pixi.js';
import { UNIT_DEFS } from '../data/defs';
import { OWNER_COLORS } from './colors';
import { localOffset } from './voxel/compose';
import { sprites } from './voxel/spriteCache';

export interface UnitArt {
  root: Container;
  /** Everything that bobs: the hull and turret sprites and the overlays. */
  body: Container;
  hull: Sprite;
  turret: Sprite | null;
  rotor: Graphics | null;
  load: Graphics | null;
  air: boolean;
  owner: number;
  kind: string;
  /** Half-width of the selection brackets, in px. */
  ringR: number;
  /** Height of the unit above its ground centre, in px (where a health bar goes). */
  topY: number;
  /** Facings currently shown, or -1 before the first update. */
  hullFacing: number;
  aimFacing: number;
}

const PX_Z = 4;

/** Builds the sprites for a unit. Textures are baked lazily as facings are first shown. */
export function drawUnit(kind: string, owner: number): UnitArt {
  const model = sprites.model(kind);
  const root = new Container();
  const body = new Container();
  const hull = new Sprite();
  body.addChild(hull);
  let turret: Sprite | null = null;
  if (model.turret) {
    turret = new Sprite();
    body.addChild(turret);
  }
  let rotor: Graphics | null = null;
  if (kind === 'hum_gunship') {
    rotor = new Graphics();
    body.addChild(rotor);
  }
  let load: Graphics | null = null;
  if (model.loadPivot) {
    load = new Graphics();
    body.addChild(load);
  }
  root.addChild(body);
  const s = model.hull.scale;
  const rad = Math.hypot(model.hull.sx, model.hull.sy) / 2;
  const top = Math.max(model.hull.sz, model.turret ? model.turret.pivot.z + model.turret.model.sz : 0);
  const air = !!UNIT_DEFS[kind]?.air;
  return {
    root,
    body,
    hull,
    turret,
    rotor,
    load,
    air,
    owner,
    kind,
    ringR: Math.max(10, Math.min(26, rad * 3.2 * s * 2)),
    topY: top * PX_Z * s + 8,
    hullFacing: -1,
    aimFacing: -1,
  };
}

/** Shows the sprites for the given facings, baking any that have not been seen yet. */
export function setFacing(a: UnitArt, hullFacing: number, aimFacing: number): void {
  const team = OWNER_COLORS[a.owner] ?? 0xffffff;
  if (hullFacing !== a.hullFacing) {
    const h = sprites.hull(a.kind, team, hullFacing);
    a.hull.texture = h.texture;
    a.hull.anchor.set(h.anchorX / h.texture.width, h.anchorY / h.texture.height);
  }
  const model = sprites.model(a.kind);
  if (a.turret && model.turret && (aimFacing !== a.aimFacing || hullFacing !== a.hullFacing)) {
    const t = sprites.turret(a.kind, team, aimFacing);
    if (t) {
      a.turret.texture = t.texture;
      a.turret.anchor.set(t.anchorX / t.texture.width, t.anchorY / t.texture.height);
      const o = localOffset(model.hull.scale, model.turret.pivot, hullFacing);
      a.turret.position.set(o.dx, o.dy);
    }
  }
  if (a.load && model.loadPivot && hullFacing !== a.hullFacing) {
    const o = localOffset(model.hull.scale, model.loadPivot, hullFacing);
    a.load.position.set(o.dx, o.dy);
  }
  a.hullFacing = hullFacing;
  a.aimFacing = aimFacing;
}

/** Per-frame animation: bobbing while moving, a spinning rotor, crystal load on haulers. */
export function animateUnit(a: UnitArt, t: number, moving: boolean, loadFrac: number, motion: boolean): void {
  a.body.y = motion && moving && !a.air ? Math.sin(t / 70) * 0.8 : 0;
  if (a.rotor) {
    a.rotor.clear();
    const spin = motion ? Math.sin(t / 25) : 1;
    const y = -(sprites.model(a.kind).overlayY ?? 27);
    a.rotor.ellipse(0, y, 15 * Math.abs(spin) + 3, 3).fill({ color: 0xffffff, alpha: 0.5 });
  }
  if (a.load) {
    a.load.clear();
    if (loadFrac > 0 && a.kind === 'hum_hauler') for (let i = 0; i < Math.ceil(loadFrac * 3); i++) a.load.poly([-7 + i * 5, 0, -4 + i * 5, -7, -1 + i * 5, 0]).fill(0x35e0a1);
  }
}
