import { Application, Container, Graphics } from 'pixi.js';
import type { Snapshot } from '../sim';
import { HEIGHT_PX, TILE_H, TILE_W, tileToScreen } from './iso';

const PALETTE = [0x2f4a3a, 0x3f6b4c, 0x57896a];

export async function mountMap(host: HTMLElement, snap: Snapshot): Promise<Application> {
  const app = new Application();
  await app.init({ resizeTo: host, background: 0x0b1015, antialias: true });
  host.appendChild(app.canvas);

  const world = new Container();
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
  world.addChild(g);
  world.x = app.screen.width / 2;
  world.y = app.screen.height / 2 - (snap.mapHeight * TILE_H) / 2;
  app.stage.addChild(world);
  return app;
}
