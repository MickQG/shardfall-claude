import { Container, Sprite } from 'pixi.js';
import { buildingDef } from '../data/defs';
import { OWNER_COLORS } from './colors';
import { tileToScreen } from './iso';
import { buildingHeightPx } from './voxel/buildings';
import { sprites } from './voxel/spriteCache';

/** A building's voxel sprite, centred on its footprint (the container's origin is the footprint's top corner). */
export function drawBuilding(kind: string, owner: number): Container {
  const d = buildingDef(kind);
  const root = new Container();
  const b = sprites.building(kind, OWNER_COLORS[owner] ?? 0xffffff);
  const s = new Sprite(b.texture);
  s.anchor.set(b.anchorX / b.texture.width, b.anchorY / b.texture.height);
  const c = tileToScreen(d.w / 2, d.h / 2);
  s.position.set(c.x, c.y);
  root.addChild(s);
  return root;
}

/** Screen-space top corner of a building's footprint, for positioning the container. */
export const buildingOrigin = (tx: number, ty: number): { x: number; y: number } => tileToScreen(tx, ty);

/** Roof height in px above the footprint, from the building's model. */
export const buildingHeight = (kind: string): number => buildingHeightPx(kind);
