import { Texture } from 'pixi.js';
import { bakeModel, type Sprite } from './bake';
import { buildingModel } from './buildings';
import type { VoxelModel } from './model';
import { UNIT_MODELS, type UnitModel } from './models';
import { NEXT_UNIT_MODELS } from './nextModels';
import { renderStyle } from './style';

export const FACINGS = 16;

export interface Baked {
  texture: Texture;
  anchorX: number;
  anchorY: number;
}

function canvasTexture(s: Sprite): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = s.width;
  canvas.height = s.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d canvas unavailable');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(s.pixels), s.width, s.height), 0, 0);
  return Texture.from(canvas);
}

/** Lazily bakes unit sprites and keeps them as textures: each (kind, team colour, part, facing) is baked at most once. */
export class SpriteCache {
  private models = new Map<string, UnitModel>();
  private baked = new Map<string, Baked>();

  /** `toTexture` turns baked pixels into a texture; tests pass a fake so no browser is needed. */
  constructor(private toTexture: (s: Sprite) => Texture = canvasTexture) {}

  model(kind: string): UnitModel {
    let m = this.models.get(kind);
    if (!m) {
      const make = (renderStyle.current === 'next' ? NEXT_UNIT_MODELS[kind] : undefined) ?? UNIT_MODELS[kind];
      if (!make) throw new Error(`no voxel model for ${kind}`);
      m = make();
      this.models.set(kind, m);
    }
    return m;
  }

  private bake(key: string, make: () => Sprite): Baked {
    let b = this.baked.get(key);
    if (!b) {
      const s = make();
      b = { texture: this.toTexture(s), anchorX: s.anchorX, anchorY: s.anchorY };
      this.baked.set(key, b);
    }
    return b;
  }

  hull(kind: string, team: number, facing: number): Baked {
    return this.bake(`${kind}|${team}|h|${facing}`, () => bakeModel(this.model(kind).hull, { team, facing, facings: FACINGS, style: renderStyle.current }));
  }

  /** A building's single facing in a team colour. */
  building(kind: string, team: number): Baked {
    return this.bake(`${kind}|${team}|b`, () => {
      const make = buildingModel(kind);
      if (!make) throw new Error(`no voxel model for ${kind}`);
      return bakeModel(make(), { team, facing: 0, facings: 1, style: renderStyle.current });
    });
  }

  /** Any single-facing model with no team colour (rocks, crystals, props), baked once per key. */
  prop(key: string, make: () => VoxelModel): Baked {
    return this.bake(`p|${key}`, () => bakeModel(make(), { team: 0xffffff, facing: 0, facings: 1, style: renderStyle.current }));
  }

  turret(kind: string, team: number, facing: number): Baked | null {
    const t = this.model(kind).turret;
    return t ? this.bake(`${kind}|${team}|t|${facing}`, () => bakeModel(t.model, { team, facing, facings: FACINGS, style: renderStyle.current })) : null;
  }

  /** Number of sprites baked so far (for tests and tooling). */
  get size(): number {
    return this.baked.size;
  }
}

export const sprites = new SpriteCache();
