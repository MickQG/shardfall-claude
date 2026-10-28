import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../sim';
import type { Camera } from './camera';
import { OWNER_COLORS } from './colors';
import { FogView } from './fogView';
import type { RenderUnit } from './interp';
import { HEIGHT_PX, TILE_H, TILE_W, tileToScreen } from './iso';

const PALETTE = [0x2f4a3a, 0x3f6b4c, 0x57896a];

interface UnitSprite {
  root: Container;
  ring: Graphics;
  bar: Graphics;
  maxHp: number;
}

export class GameView {
  readonly app = new Application();
  private world = new Container();
  private unitLayer = new Container();
  private sprites = new Map<number, UnitSprite>();
  private fog: FogView | null = null;
  private lastFogTick = -1;

  async mount(host: HTMLElement, snap: Snapshot): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b1015, antialias: true });
    host.appendChild(this.app.canvas);
    this.unitLayer.sortableChildren = true;
    this.world.addChild(this.drawTerrain(snap), this.unitLayer);
    if (snap.fog) {
      this.fog = new FogView(snap.mapWidth, snap.mapHeight);
      this.world.addChild(this.fog.sprite);
    }
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

  private makeSprite(u: RenderUnit): UnitSprite {
    const root = new Container();
    const body = new Graphics();
    const color = OWNER_COLORS[u.owner] ?? 0xffffff;
    const r = u.kind === 'scout' ? 7 : 10;
    body.ellipse(0, 4, r + 2, (r + 2) / 2).fill({ color: 0x000000, alpha: 0.35 });
    body.circle(0, -r / 2, r).fill(color).stroke({ color: 0x0b1015, width: 2 });
    const ring = new Graphics();
    ring.ellipse(0, 3, r + 6, (r + 6) / 2).stroke({ color: 0xffffff, width: 2 });
    ring.visible = false;
    const bar = new Graphics();
    bar.visible = false;
    root.addChild(body, ring, bar);
    this.unitLayer.addChild(root);
    return { root, ring, bar, maxHp: Math.max(u.hp, 1) };
  }

  /** Draw interpolated units under the given camera. */
  update(units: readonly RenderUnit[], cam: Camera, selected: ReadonlySet<number>, snap?: Snapshot | null): void {
    const v = this.viewport;
    this.world.scale.set(cam.zoom);
    this.world.position.set(v.width / 2 - cam.x * cam.zoom, v.height / 2 - cam.y * cam.zoom);

    if (this.fog && snap?.fog && snap.tick !== this.lastFogTick) {
      this.fog.update(snap.fog);
      this.lastFogTick = snap.tick;
    }

    const seen = new Set<number>();
    for (const u of units) {
      seen.add(u.id);
      let s = this.sprites.get(u.id);
      if (!s) {
        s = this.makeSprite(u);
        this.sprites.set(u.id, s);
      }
      const p = tileToScreen(u.tx, u.ty);
      s.root.position.set(p.x, p.y);
      s.root.zIndex = p.y;
      const sel = selected.has(u.id);
      s.ring.visible = sel;
      const hurt = u.hp < s.maxHp;
      s.bar.visible = sel || hurt;
      if (s.bar.visible) {
        const frac = Math.max(0, Math.min(1, u.hp / s.maxHp));
        s.bar.clear().rect(-12, -26, 24, 4).fill(0x000000).rect(-12, -26, 24 * frac, 4).fill(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30);
      }
    }
    for (const [id, s] of this.sprites) {
      if (!seen.has(id)) {
        s.root.destroy({ children: true });
        this.sprites.delete(id);
      }
    }
  }
}
