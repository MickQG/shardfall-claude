import { Application, Container, Graphics } from 'pixi.js';
import { buildingDef } from '../data/defs';
import type { BuildingSnap, Snapshot } from '../sim';
import { buildingHeight, buildingOrigin, drawBuilding } from './buildingArt';
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

interface BuildingSprite {
  root: Container;
  bar: Graphics;
  sel: Graphics;
  ghost: boolean;
}

export interface PlacementPreview {
  kind: string;
  tx: number;
  ty: number;
  ok: boolean;
}

export interface ViewState {
  selectedUnits: ReadonlySet<number>;
  selectedBuilding: number | null;
  placement: PlacementPreview | null;
  /** Hovered tile, for the rally flag / hover effects. */
  time: number;
}

const tilePoly = (tx: number, ty: number, w: number, h: number): number[] => {
  const t = tileToScreen(tx, ty);
  const r = tileToScreen(tx + w, ty);
  const b = tileToScreen(tx + w, ty + h);
  const l = tileToScreen(tx, ty + h);
  return [t.x, t.y, r.x, r.y, b.x, b.y, l.x, l.y];
};

export class GameView {
  readonly app = new Application();
  private world = new Container();
  private unitLayer = new Container();
  private shardGfx = new Graphics();
  private overlay = new Graphics();
  private sprites = new Map<number, UnitSprite>();
  private bsprites = new Map<number, BuildingSprite>();
  private fog: FogView | null = null;
  private lastFogTick = -1;
  private lastShardTick = -1;

  async mount(host: HTMLElement, snap: Snapshot): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b1015, antialias: true });
    host.appendChild(this.app.canvas);
    this.unitLayer.sortableChildren = true;
    this.world.addChild(this.drawTerrain(snap), this.shardGfx, this.overlay, this.unitLayer);
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

  private drawShards(snap: Snapshot, time: number): void {
    const g = this.shardGfx;
    g.clear();
    const W = snap.mapWidth;
    for (let i = 0; i < snap.shards.length; i++) {
      const amt = snap.shards[i] as number;
      if (amt === 0) continue;
      const x = i % W;
      const y = (i - x) / W;
      const p = tileToScreen(x + 0.5, y + 0.5);
      const size = amt > 2000 ? 3 : amt > 800 ? 2 : amt > 200 ? 1.4 : 0.9;
      const pulse = 0.55 + 0.25 * Math.sin(time / 500 + x * 1.7 + y * 0.9);
      g.ellipse(p.x, p.y + 4, 22 * Math.min(size, 2), 10 * Math.min(size, 2)).fill({ color: 0x35e0a1, alpha: 0.12 * pulse });
      const n = size >= 3 ? 3 : size >= 1.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const jx = ((x * 7 + y * 13 + k * 5) % 11) - 5;
        const jy = ((x * 3 + y * 17 + k * 7) % 7) - 3;
        const h = 8 + size * 5 + k * 2;
        const cx = p.x + jx;
        const cy = p.y + jy;
        g.poly([cx, cy - h, cx + 6, cy - h * 0.45, cx + 4, cy, cx - 4, cy, cx - 6, cy - h * 0.45]).fill({ color: 0x35e0a1, alpha: 0.92 });
        g.poly([cx, cy - h, cx + 6, cy - h * 0.45, cx + 1, cy - h * 0.4]).fill({ color: 0xbffbe6, alpha: 0.85 });
      }
    }
  }

  private makeUnit(u: RenderUnit): UnitSprite {
    const root = new Container();
    const body = new Graphics();
    const color = OWNER_COLORS[u.owner] ?? 0xffffff;
    const big = u.kind.endsWith('hauler') || u.kind.endsWith('gorger') || u.kind.endsWith('tank') || u.kind.endsWith('brute');
    const r = u.kind.endsWith('buggy') || u.kind.endsWith('stalker') ? 7 : big ? 13 : 10;
    body.ellipse(0, 4, r + 2, (r + 2) / 2).fill({ color: 0x000000, alpha: 0.35 });
    if (u.kind.startsWith('ali_')) body.poly([0, -r * 1.7, r, -r / 2, 0, r / 3, -r, -r / 2]).fill(color).stroke({ color: 0x0b1015, width: 2 });
    else body.circle(0, -r / 2, r).fill(color).stroke({ color: 0x0b1015, width: 2 });
    const ring = new Graphics();
    ring.ellipse(0, 3, r + 6, (r + 6) / 2).stroke({ color: 0xffffff, width: 2 });
    ring.visible = false;
    const bar = new Graphics();
    bar.visible = false;
    root.addChild(body, ring, bar);
    this.unitLayer.addChild(root);
    return { root, ring, bar, maxHp: Math.max(u.hp, 1) };
  }

  private makeBuilding(b: BuildingSnap, ghost: boolean): BuildingSprite {
    const root = new Container();
    const art = drawBuilding(b.kind, b.owner);
    if (ghost) {
      art.alpha = 0.5;
      art.tint = 0x8899aa;
    }
    const sel = new Graphics();
    sel.visible = false;
    const bar = new Graphics();
    bar.visible = false;
    root.addChild(art, sel, bar);
    const o = buildingOrigin(b.tx, b.ty);
    root.position.set(o.x, o.y);
    const d = buildingDef(b.kind);
    root.zIndex = tileToScreen(b.tx + d.w, b.ty + d.h).y - 1;
    sel.poly(tilePoly(0, 0, d.w, d.h).map((v, i) => (i % 2 === 0 ? v : v + 0))).stroke({ color: 0xffffff, width: 2 });
    this.unitLayer.addChild(root);
    return { root, bar, sel, ghost };
  }

  private syncBuildings(snap: Snapshot, vs: ViewState): void {
    const want = new Map<number, { b: BuildingSnap; ghost: boolean }>();
    for (const g of snap.ghosts) want.set(g.id, { b: g, ghost: true });
    for (const b of snap.buildings) want.set(b.id, { b, ghost: false });
    for (const [id, s] of this.bsprites) {
      const w = want.get(id);
      if (!w || w.ghost !== s.ghost) {
        s.root.destroy({ children: true });
        this.bsprites.delete(id);
      }
    }
    for (const [id, { b, ghost }] of want) {
      let s = this.bsprites.get(id);
      if (!s) {
        s = this.makeBuilding(b, ghost);
        this.bsprites.set(id, s);
      }
      s.sel.visible = vs.selectedBuilding === id;
      const d = buildingDef(b.kind);
      const hurt = b.hp < d.hp;
      s.bar.visible = !ghost && (vs.selectedBuilding === id || hurt);
      if (s.bar.visible) {
        const frac = Math.max(0, Math.min(1, b.hp / d.hp));
        const top = tileToScreen(d.w / 2, d.h / 2);
        const bx = top.x - 24;
        const by = top.y - buildingHeight(b.kind) - 6;
        s.bar.clear().rect(bx, by, 48, 5).fill(0x000000).rect(bx, by, 48 * frac, 5).fill(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30);
      }
    }
  }

  private drawOverlay(vs: ViewState): void {
    const g = this.overlay;
    g.clear();
    const p = vs.placement;
    if (!p) return;
    const d = buildingDef(p.kind);
    const col = p.ok ? 0x3cff8a : 0xff4a4a;
    g.poly(tilePoly(p.tx, p.ty, d.w, d.h)).fill({ color: col, alpha: 0.32 }).stroke({ color: col, width: 2 });
    // Footprint grid.
    for (let y = 0; y < d.h; y++) for (let x = 0; x < d.w; x++) g.poly(tilePoly(p.tx + x, p.ty + y, 1, 1)).stroke({ color: col, width: 1, alpha: 0.5 });
  }

  /** Draw interpolated units under the given camera. */
  update(units: readonly RenderUnit[], cam: Camera, vs: ViewState, snap: Snapshot | null): void {
    const v = this.viewport;
    this.world.scale.set(cam.zoom);
    this.world.position.set(v.width / 2 - cam.x * cam.zoom, v.height / 2 - cam.y * cam.zoom);

    if (snap) {
      if (this.fog && snap.fog && snap.tick !== this.lastFogTick) {
        this.fog.update(snap.fog);
        this.lastFogTick = snap.tick;
      }
      if (snap.tick !== this.lastShardTick && snap.tick % 4 === 0) {
        this.drawShards(snap, vs.time);
        this.lastShardTick = snap.tick;
      }
      this.syncBuildings(snap, vs);
    }
    this.drawOverlay(vs);

    const seen = new Set<number>();
    for (const u of units) {
      seen.add(u.id);
      let s = this.sprites.get(u.id);
      if (!s) {
        s = this.makeUnit(u);
        this.sprites.set(u.id, s);
      }
      const p = tileToScreen(u.tx, u.ty);
      s.root.position.set(p.x, p.y);
      s.root.zIndex = p.y;
      const sel = vs.selectedUnits.has(u.id);
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
