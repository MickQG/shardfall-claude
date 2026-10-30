import { buildingDef } from '../data/defs';
import { EXPLORED, VISIBLE, type Snapshot } from '../sim';
import { OWNER_COLORS } from '../render/colors';

export interface MiniLayout {
  /** Pixel size of the minimap canvas. */
  width: number;
  height: number;
  /** Map size in tiles. */
  mapW: number;
  mapH: number;
}

/** Tile (fractional) to minimap pixel: the minimap is the isometric diamond of the map. */
export function tileToMini(l: MiniLayout, tx: number, ty: number): { x: number; y: number } {
  const n = l.mapW + l.mapH;
  return { x: ((tx - ty + l.mapH) / n) * l.width, y: ((tx + ty) / n) * l.height };
}

export function miniToTile(l: MiniLayout, x: number, y: number): { x: number; y: number } {
  const n = l.mapW + l.mapH;
  const a = (x / l.width) * n - l.mapH; // tx - ty
  const b = (y / l.height) * n; // tx + ty
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** Draws the minimap: terrain, fog, units and the camera view marker. */
/** A tile position clamped onto a map of the given size (at most the centre of the last tile). */
export function clampTile(tx: number, ty: number, width: number, height: number): { x: number; y: number } {
  return { x: Math.min(width - 0.5, Math.max(0, tx)), y: Math.min(height - 0.5, Math.max(0, ty)) };
}

export class Minimap {
  readonly canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private terrain: HTMLCanvasElement;
  readonly layout: MiniLayout;
  private pings: { tx: number; ty: number; born: number; color: string }[] = [];

  /** Flash a ring on the minimap (alerts). `now` is the caller's clock in ms. */
  ping(tx: number, ty: number, now: number, color = '#ff5a4a'): void {
    this.pings.push({ tx, ty, born: now, color });
  }

  constructor(snap: Snapshot, width = 220, height = 110) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.layout = { width, height, mapW: snap.mapWidth, mapH: snap.mapHeight };
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.terrain = this.bakeTerrain(snap);
  }

  private bakeTerrain(snap: Snapshot): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.layout.width;
    c.height = this.layout.height;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    const { mapW, mapH } = this.layout;
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const h = snap.heights[y * mapW + x] ?? 0;
        g.fillStyle = h === 0 ? '#2f4a3a' : h === 1 ? '#3f6b4c' : '#57896a';
        const p = tileToMini(this.layout, x, y);
        g.fillRect(p.x - 1, p.y, 2.4, 1.4);
      }
    }
    return c;
  }

  draw(snap: Snapshot, camTiles: { x: number; y: number }[], now = 0): void {
    const { ctx, layout: l } = this;
    ctx.clearRect(0, 0, l.width, l.height);
    ctx.drawImage(this.terrain, 0, 0);
    if (snap.fog) {
      for (let y = 0; y < l.mapH; y++) {
        for (let x = 0; x < l.mapW; x++) {
          const f = snap.fog[y * l.mapW + x] as number;
          if (f & VISIBLE) continue;
          const p = tileToMini(l, x, y);
          ctx.fillStyle = f & EXPLORED ? 'rgba(5,8,12,0.55)' : 'rgb(5,8,12)';
          ctx.fillRect(p.x - 1, p.y, 2.4, 1.4);
        }
      }
    }
    for (const b of [...snap.ghosts, ...snap.buildings]) {
      const d = buildingDef(b.kind);
      const p = tileToMini(l, b.tx + d.w / 2, b.ty + d.h / 2);
      ctx.fillStyle = `#${(OWNER_COLORS[b.owner] ?? 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.fillRect(p.x - 2.5, p.y - 2, 5, 4);
    }
    for (let i = 0; i < snap.shards.length; i++) {
      if ((snap.shards[i] as number) === 0) continue;
      const p = tileToMini(l, (i % l.mapW) + 0.5, Math.floor(i / l.mapW) + 0.5);
      ctx.fillStyle = '#35e0a1';
      ctx.fillRect(p.x - 1, p.y - 0.5, 2, 1.4);
    }
    for (const u of snap.units) {
      const p = tileToMini(l, u.x / 256, u.y / 256);
      ctx.fillStyle = `#${(OWNER_COLORS[u.owner] ?? 0xffffff).toString(16).padStart(6, '0')}`;
      ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
    }
    this.pings = this.pings.filter((p) => now - p.born < 2200);
    for (const p of this.pings) {
      const k = (now - p.born) / 2200;
      const c = tileToMini(l, p.tx + 0.5, p.ty + 0.5);
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, 4 + k * 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (camTiles.length === 4) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      camTiles.forEach((t, i) => {
        const p = tileToMini(l, t.x, t.y);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }
}
