import { Matrix, Sprite, Texture } from 'pixi.js';
import { EXPLORED, VISIBLE } from '../sim';
import { TILE_H, TILE_W } from './iso';

/**
 * Fog overlay: one texel per tile (black, alpha by fog state), skewed into the isometric
 * grid. Linear filtering softens the edges between hidden, explored and visible tiles.
 */
export class FogView {
  readonly sprite: Sprite;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private texture: Texture;

  constructor(
    private w: number,
    private h: number,
    /** Fog colour; the next style uses a cool blue-violet that matches its shadows. */
    private rgb: readonly [number, number, number] = [4, 7, 12],
    /** Opacity of explored-but-not-visible tiles. */
    private explored = 120,
  ) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.image = this.ctx.createImageData(w, h);
    this.texture = Texture.from(this.canvas);
    this.sprite = new Sprite(this.texture);
    this.sprite.setFromMatrix(new Matrix(TILE_W / 2, TILE_H / 2, -TILE_W / 2, TILE_H / 2, 0, 0));
    this.sprite.alpha = 0.92;
  }

  update(fog: Uint8Array): void {
    const d = this.image.data;
    for (let i = 0; i < this.w * this.h; i++) {
      const f = fog[i] as number;
      d[i * 4] = this.rgb[0];
      d[i * 4 + 1] = this.rgb[1];
      d[i * 4 + 2] = this.rgb[2];
      d[i * 4 + 3] = f & VISIBLE ? 0 : f & EXPLORED ? this.explored : 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }
}
