import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../sim';
import type { Camera } from './camera';
import { HEIGHT_PX, TILE_H, TILE_W, tileToScreen } from './iso';
import type { RenderUnit } from './interp';

const PALETTE = [0x2f4a3a, 0x3f6b4c, 0x57896a];
export const OWNER_COLORS = [0x4aa3ff, 0xff5a4a];

export class GameView {
  readonly app = new Application();
  private world = new Container();
  private unitLayer = new Container();
  private sprites = new Map<number, Graphics>();

  async mount(host: HTMLElement, snap: Snapshot): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b1015, antialias: true });
    host.appendChild(this.app.canvas);
    this.world.addChild(this.drawTerrain(snap), this.unitLayer);
    this.app.stage.addChild(this.world);
  }

  get viewport(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  private drawTerrain(snap: Snapshot): Graphics {
    const g = new Graphics();
    for (let y = 0; y < snap.mapHeight; y++) {
      for (let x = 0; x < snap.mapWidth; x++) {
        const lvl = snap.heights[y * snap.mapWidth + x] ?? 0;
        const p = tileToScreen(x, y, lvl);
        const shade = (x + y) & 1 ? 0 : 0x050505;
        const col = (PALETTE[Math.min(lvl, 2)] ?? 0x2f4a3a) + shade;
        g.poly([p.x, p.y, p.x + TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x - TILE_W / 2, p.y + TILE_H / 2]).fill(col);
        if (lvl > 0) {
          const side = lvl * HEIGHT_PX;
          g.poly([p.x - TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x, p.y + TILE_H + side, p.x - TILE_W / 2, p.y + TILE_H / 2 + side]).fill(0x1c2d24);
          g.poly([p.x + TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x, p.y + TILE_H + side, p.x + TILE_W / 2, p.y + TILE_H / 2 + side]).fill(0x16241d);
        }
      }
    }
    return g;
  }

  /** Draw interpolated units under the given camera. */
  update(units: readonly RenderUnit[], cam: Camera): void {
    const v = this.viewport;
    this.world.scale.set(cam.zoom);
    this.world.position.set(v.width / 2 - cam.x * cam.zoom, v.height / 2 - cam.y * cam.zoom);

    const seen = new Set<number>();
    for (const u of units) {
      seen.add(u.id);
      let s = this.sprites.get(u.id);
      if (!s) {
        s = new Graphics();
        const color = OWNER_COLORS[u.owner] ?? 0xffffff;
        const r = u.kind === 'scout' ? 7 : 10;
        s.ellipse(0, 4, r + 2, (r + 2) / 2).fill({ color: 0x000000, alpha: 0.35 });
        s.circle(0, -r / 2, r).fill(color).stroke({ color: 0x0b1015, width: 2 });
        this.unitLayer.addChild(s);
        this.sprites.set(u.id, s);
      }
      const p = tileToScreen(u.tx, u.ty);
      s.position.set(p.x, p.y);
      s.zIndex = p.y;
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        s.destroy();
        this.sprites.delete(id);
      }
    }
    this.unitLayer.sortableChildren = true;
  }
}
