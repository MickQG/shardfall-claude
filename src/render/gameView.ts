import { Application, Container, Graphics } from 'pixi.js';
import { AdvancedBloomFilter } from 'pixi-filters';
import { buildingDef } from '../data/defs';
import type { BuildingSnap, SimEvent, Snapshot } from '../sim';
import { buildingHeight, buildingOrigin, drawBuilding } from './buildingArt';
import type { Camera } from './camera';
import { Effects } from './effects';
import { barVisible, buildUp, damageState, edgeShade, groundTint, idleGlow } from './gfx';
import { OWNER_COLORS } from './colors';
import { FogView } from './fogView';
import type { RenderUnit } from './interp';
import { HEIGHT_PX, TILE_H, TILE_W, tileToScreen } from './iso';
import type { RallyLine } from '../ui/rally';
import { animateUnit, drawUnit, setFacing, type UnitArt } from './unitArt';
import { facingOf } from './voxel/bake';
import { FACINGS } from './voxel/spriteCache';

interface UnitSprite {
  root: Container;
  art: UnitArt;
  ring: Graphics;
  bar: Graphics;
  maxHp: number;
  lastTx: number;
  lastTy: number;
  moving: number;
  /** Facing of the last movement (hull heading). */
  heading: number;
  /** Facing the weapon points at, and until when a recent shot holds it there (ms). */
  aim: number;
  aimHold: number;
}

interface BuildingSprite {
  root: Container;
  art: Container;
  bar: Graphics;
  sel: Graphics;
  /** Scaffold, damage smoke and fire, idle lights (redrawn each frame). */
  fx: Graphics;
  ghost: boolean;
  /** When the building first appeared, in view time; -Infinity if it was already there. */
  born: number;
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
  rally: RallyLine | null;
  /** The player whose view this is: only their new buildings play the build-up animation. */
  viewer: number;
  /** Clock in ms (for animation). */
  time: number;
  /** Decorative effects allowed by the quality / reduced-motion settings. */
  fx: { bloom: boolean; particles: boolean; shake: boolean; decor: boolean };
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
  readonly effects = new Effects();
  private world = new Container();
  private unitLayer = new Container();
  private shardGfx = new Graphics();
  private overlay = new Graphics();
  private sprites = new Map<number, UnitSprite>();
  private bsprites = new Map<number, BuildingSprite>();
  private seeded = false;
  private knownBuildings = new Set<number>();
  private decorLayer = new Graphics();
  private fog: FogView | null = null;
  private lastFogTick = -1;
  private lastShardTick = -1;
  private bloom: AdvancedBloomFilter | null = null;
  private bloomOn = false;
  private dust = new Graphics();
  private motes = Array.from({ length: 46 }, (_, i) => ({ x: ((i * 97) % 100) / 100, y: ((i * 61) % 100) / 100, s: 0.4 + ((i * 29) % 10) / 14, p: i }));

  async mount(host: HTMLElement, snap: Snapshot): Promise<void> {
    await this.app.init({ resizeTo: host, background: 0x0b1015, antialias: true });
    host.appendChild(this.app.canvas);
    this.unitLayer.sortableChildren = true;
    this.world.addChild(this.drawTerrain(snap), this.decorLayer, this.shardGfx, this.overlay, this.unitLayer);
    this.drawTerrainDecor(snap);
    if (snap.fog) {
      this.fog = new FogView(snap.mapWidth, snap.mapHeight);
      this.world.addChild(this.fog.sprite);
    }
    this.effects.layer.sortableChildren = true;
    this.world.addChild(this.effects.layer);
    this.app.stage.addChild(this.world, this.dust);
    this.bloom = new AdvancedBloomFilter({ threshold: 0.55, bloomScale: 0.85, brightness: 1.05, blur: 5, quality: 3 });
  }

  /** Bloom on the crystals and combat effects, plus drifting dust motes; all optional for weak machines / reduced motion. */
  private applyFx(fx: ViewState['fx'], t: number): void {
    if (fx.bloom !== this.bloomOn && this.bloom) {
      this.bloomOn = fx.bloom;
      this.shardGfx.filters = fx.bloom ? [this.bloom] : [];
      this.effects.layer.filters = fx.bloom ? [this.bloom] : [];
    }
    this.decorLayer.visible = fx.decor;
    this.effects.decor = fx.decor;
    this.dust.clear();
    if (!fx.particles) return;
    const v = this.viewport;
    for (const m of this.motes) {
      const x = ((m.x + t * 0.000012 * m.s + Math.sin(t / 3000 + m.p) * 0.004) % 1 + 1) % 1;
      const y = ((m.y - t * 0.000006 * m.s) % 1 + 1) % 1;
      this.dust.circle(x * v.width, y * v.height, 1.2 * m.s).fill({ color: 0xcdeee0, alpha: 0.12 + 0.12 * Math.sin(t / 700 + m.p) ** 2 });
    }
  }

  get viewport(): { width: number; height: number } {
    return { width: this.app.screen.width, height: this.app.screen.height };
  }

  private drawTerrain(snap: Snapshot): Graphics {
    const g = new Graphics();
    const hash = (x: number, y: number): number => {
      let h = (x * 374761393 + y * 668265263) | 0;
      h = (h ^ (h >> 13)) * 1274126177;
      return ((h ^ (h >> 16)) >>> 0) / 4294967295;
    };
    const mix = (c: number, f: number): number => {
      const r = Math.max(0, Math.min(255, Math.round(((c >> 16) & 255) * f)));
      const gg = Math.max(0, Math.min(255, Math.round(((c >> 8) & 255) * f)));
      const b = Math.max(0, Math.min(255, Math.round((c & 255) * f)));
      return (r << 16) | (gg << 8) | b;
    };
    for (let y = 0; y < snap.mapHeight; y++) {
      for (let x = 0; x < snap.mapWidth; x++) {
        const lvl = snap.heights[y * snap.mapWidth + x] ?? 0;
        const p = tileToScreen(x, y, lvl);
        const n = hash(x, y);
        const f = (0.9 + n * 0.2 + ((x + y) & 1 ? 0 : -0.04)) * (lvl === 0 ? groundTint(x, y) : 1);
        const top = mix(lvl === 0 ? 0x2f4f3c : lvl === 1 ? 0x5a6b73 : 0x77899a, f);
        g.poly([p.x, p.y, p.x + TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x - TILE_W / 2, p.y + TILE_H / 2]).fill(top);
        if (lvl === 0) {
          // Shade the tile edges beside rising rock: y-1 is the upper-right edge, x+1 lower-right, y+1 lower-left, x-1 upper-left.
          const e = edgeShade(snap.heights, snap.mapWidth, x, y);
          const top = [p.x, p.y] as const;
          const right = [p.x + TILE_W / 2, p.y + TILE_H / 2] as const;
          const bottom = [p.x, p.y + TILE_H] as const;
          const left = [p.x - TILE_W / 2, p.y + TILE_H / 2] as const;
          const mid = [p.x, p.y + TILE_H / 2] as const;
          if (e.n) g.poly([...top, ...right, ...mid]).fill({ color: 0x000000, alpha: 0.3 });
          if (e.e) g.poly([...right, ...bottom, ...mid]).fill({ color: 0x000000, alpha: 0.2 });
          if (e.s) g.poly([...bottom, ...left, ...mid]).fill({ color: 0x000000, alpha: 0.14 });
          if (e.w) g.poly([...left, ...top, ...mid]).fill({ color: 0x000000, alpha: 0.24 });
          // Ground detail: pebbles and moss patches.
          if (n > 0.82) g.ellipse(p.x + (n - 0.5) * 30, p.y + 16 + (hash(y, x) - 0.5) * 8, 3.5, 1.8).fill({ color: 0x1f3a2c, alpha: 0.7 });
          if (n < 0.1) g.circle(p.x + (hash(x + 9, y) - 0.5) * 24, p.y + 16, 1.4).fill({ color: 0x8fb39b, alpha: 0.6 });
        } else {
          // Faceted rock: shaded walls, a lit edge and crystal spires on the tall cores.
          const side = lvl * HEIGHT_PX;
          g.poly([p.x - TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x, p.y + TILE_H + side, p.x - TILE_W / 2, p.y + TILE_H / 2 + side]).fill(mix(0x3a4650, f));
          g.poly([p.x + TILE_W / 2, p.y + TILE_H / 2, p.x, p.y + TILE_H, p.x, p.y + TILE_H + side, p.x + TILE_W / 2, p.y + TILE_H / 2 + side]).fill(mix(0x27313a, f));
          g.moveTo(p.x - TILE_W / 2, p.y + TILE_H / 2).lineTo(p.x, p.y).lineTo(p.x + TILE_W / 2, p.y + TILE_H / 2).stroke({ color: 0xb9c8d4, width: 1.2, alpha: 0.5 });
          if (lvl >= 2 && n > 0.55) g.poly([p.x - 5, p.y + 20, p.x, p.y - 12 - n * 18, p.x + 5, p.y + 20]).fill({ color: 0x7fd8ff, alpha: 0.55 });
        }
      }
    }
    return g;
  }

  /** Extra ground decals (cracks, pebble clusters) on open ground; toggled as a whole by the quality setting. */
  private drawTerrainDecor(snap: Snapshot): void {
    const g = this.decorLayer;
    for (let y = 0; y < snap.mapHeight; y++) {
      for (let x = 0; x < snap.mapWidth; x++) {
        if ((snap.heights[y * snap.mapWidth + x] ?? 0) !== 0 || snap.shards[y * snap.mapWidth + x]) continue;
        const n = (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000;
        const p = tileToScreen(x + 0.5, y + 0.5);
        if (n < 22) {
          g.moveTo(p.x - 9, p.y - 1).lineTo(p.x - 2, p.y + 3).lineTo(p.x + 3, p.y).lineTo(p.x + 10, p.y + 4).stroke({ color: 0x14261d, width: 1.2, alpha: 0.55 });
        } else if (n < 40) {
          for (let k = 0; k < 3; k++) g.ellipse(p.x + ((n * (k + 3)) % 14) - 7, p.y + ((n * (k + 5)) % 8) - 4, 2.4, 1.3).fill({ color: 0x7e8f86, alpha: 0.55 });
        }
      }
    }
  }

  private drawShards(snap: Snapshot, time: number, twinkle = false): void {
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
        if (twinkle) {
          const tw = Math.max(0, Math.sin(time / 380 + x * 2.3 + y * 1.1 + k * 1.7));
          if (tw > 0.95) g.moveTo(cx - 4, cy - h).lineTo(cx + 4, cy - h).moveTo(cx, cy - h - 4).lineTo(cx, cy - h + 4).stroke({ color: 0xffffff, width: 1.2, alpha: (tw - 0.95) * 18 });
        }
      }
    }
  }

  private makeUnit(u: RenderUnit): UnitSprite {
    const art = drawUnit(u.kind, u.owner);
    const root = art.root;
    const r = art.ringR;
    // Team-coloured corner brackets around the unit's footprint.
    const ring = new Graphics();
    const bw = r + 7;
    const bh = (r + 7) * 0.62;
    const bc = OWNER_COLORS[u.owner] ?? 0xffffff;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const cx = sx * bw;
      const cy = 3 + sy * bh;
      ring.moveTo(cx - sx * 7, cy).lineTo(cx, cy).lineTo(cx, cy - sy * 5).stroke({ color: 0x04130d, width: 4 });
      ring.moveTo(cx - sx * 7, cy).lineTo(cx, cy).lineTo(cx, cy - sy * 5).stroke({ color: bc, width: 2 });
    }
    ring.visible = false;
    const bar = new Graphics();
    bar.visible = false;
    root.addChild(ring, bar);
    this.unitLayer.addChild(root);
    return { root, art, ring, bar, maxHp: Math.max(u.hp, 1), lastTx: u.tx, lastTy: u.ty, moving: 0, heading: 0, aim: 0, aimHold: 0 };
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
    const fx = new Graphics();
    root.addChild(art, fx, sel, bar);
    const o = buildingOrigin(b.tx, b.ty);
    root.position.set(o.x, o.y);
    const d = buildingDef(b.kind);
    root.zIndex = tileToScreen(b.tx + d.w, b.ty + d.h).y - 1;
    sel.poly(tilePoly(0, 0, d.w, d.h).map((v, i) => (i % 2 === 0 ? v : v + 0))).stroke({ color: 0xffffff, width: 2 });
    this.unitLayer.addChild(root);
    return { root, art, bar, sel, fx, ghost, born: -Infinity };
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
        // Only the viewer's own new buildings rise; ones present at the start or first seen through the fog do not.
        if (!ghost && this.seeded && b.owner === vs.viewer && !this.knownBuildings.has(id)) s.born = vs.time;
        this.bsprites.set(id, s);
      }
      this.knownBuildings.add(id);
      s.sel.visible = vs.selectedBuilding === id;
      const d = buildingDef(b.kind);
      const selected = vs.selectedBuilding === id;
      const top = tileToScreen(d.w / 2, d.h / 2);
      const h = buildingHeight(b.kind);
      const showHp = !ghost && barVisible(b.hp, d.hp, selected);
      const head = ghost ? undefined : b.queue[0];
      const producing = !!head && !head.ready;
      s.bar.visible = showHp || producing;
      s.bar.clear();
      if (s.bar.visible) {
        const bx = top.x - 24;
        const by = top.y - h - 6;
        if (showHp) {
          const frac = Math.max(0, Math.min(1, b.hp / d.hp));
          s.bar.rect(bx - 1, by - 1, 50, 7).fill(0x04130d).rect(bx, by, 48 * frac, 5).fill(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30);
        }
        if (head && producing) s.bar.rect(bx - 1, by + 7, 50, 5).fill(0x04130d).rect(bx, by + 8, 48 * (head.pct / 100), 3).fill(0x6fd3ff);
      }
      this.drawBuildingFx(s, b, vs, top, h);
    }
    this.seeded = true;
  }

  /** Build-up scaffold, damage smoke and fire, and idle lights for one building. All skipped when decor is off. */
  private drawBuildingFx(s: BuildingSprite, b: BuildingSnap, vs: ViewState, top: { x: number; y: number }, h: number): void {
    const g = s.fx;
    g.clear();
    s.art.y = 0;
    if (s.ghost || !vs.fx.decor) {
      if (!s.ghost) s.art.alpha = 1;
      return;
    }
    const d = buildingDef(b.kind);
    const p = buildUp(vs.time, s.born);
    s.art.alpha = 0.3 + 0.7 * p;
    s.art.y = (1 - p) * 14;
    if (p < 1) {
      const trim = OWNER_COLORS[b.owner] ?? 0xffffff;
      const t0 = tileToScreen(0, 0);
      const r0 = tileToScreen(d.w, 0);
      const b0 = tileToScreen(d.w, d.h);
      const l0 = tileToScreen(0, d.h);
      const al = 1 - p * 0.85;
      for (const c of [t0, r0, b0, l0]) g.moveTo(c.x, c.y).lineTo(c.x, c.y - h).stroke({ color: trim, width: 2, alpha: al });
      for (const [a, c] of [[l0, b0], [b0, r0]] as const) {
        const n = 4;
        for (let i = 0; i < n; i++) {
          const y0 = (i / n) * h;
          const y1 = ((i + 1) / n) * h;
          g.moveTo(a.x, a.y - (i % 2 ? y1 : y0)).lineTo(c.x, c.y - (i % 2 ? y0 : y1)).stroke({ color: trim, width: 1.2, alpha: al * 0.8 });
        }
      }
      g.moveTo(l0.x, l0.y - h * p).lineTo(b0.x, b0.y - h * p).lineTo(r0.x, r0.y - h * p).stroke({ color: 0xffffff, width: 2, alpha: al });
      return;
    }
    const state = damageState(b.hp, d.hp);
    if (state !== 'intact') {
      const puffs = state === 'critical' ? 5 : 3;
      for (let i = 0; i < puffs; i++) {
        const ph = (((vs.time / (state === 'critical' ? 900 : 1500) + i / puffs) % 1) + 1) % 1;
        g.circle(top.x + (i - (puffs - 1) / 2) * 8 + Math.sin(vs.time / 400 + i) * 3, top.y - h - ph * 38, 4 + ph * 8).fill({ color: state === 'critical' ? 0x2b2b2b : 0x555555, alpha: (1 - ph) * 0.5 });
      }
      if (state === 'critical') {
        for (let i = 0; i < 3; i++) {
          const fl = 0.6 + 0.4 * Math.sin(vs.time / 70 + i * 2.1);
          const fx = top.x + (i - 1) * 10;
          g.poly([fx - 4, top.y - h + 2, fx, top.y - h - 12 * fl, fx + 4, top.y - h + 2]).fill({ color: 0xff6a1f, alpha: 0.9 });
          g.poly([fx - 2, top.y - h + 2, fx, top.y - h - 6 * fl, fx + 2, top.y - h + 2]).fill({ color: 0xffe08a, alpha: 0.95 });
        }
      }
    }
    const glow = idleGlow(d.faction, vs.time + b.id * 211);
    if (d.faction === 'human') {
      g.moveTo(top.x, top.y - h).lineTo(top.x, top.y - h - 9).stroke({ color: 0x1a232d, width: 1.5 });
      g.circle(top.x, top.y - h - 10, 2.2).fill({ color: 0xff5a4a, alpha: 0.25 + 0.75 * glow });
      if (glow > 0) g.circle(top.x, top.y - h - 10, 6).fill({ color: 0xff5a4a, alpha: 0.25 });
    } else {
      g.ellipse(top.x, top.y - h, 9 + glow * 4, 4.5 + glow * 2).fill({ color: 0xb6ff5c, alpha: 0.08 + 0.22 * glow });
    }
  }

  /** Points the weapon of the nearest unit of the shooter's side at the shot's target for a moment. */
  aim(e: SimEvent, now: number): void {
    if (e.t !== 'shot') return;
    const sx = e.x / 256;
    const sy = e.y / 256;
    let best: UnitSprite | null = null;
    let bd = 1.2 * 1.2;
    for (const s of this.sprites.values()) {
      if (s.art.owner !== e.owner) continue;
      const d = (s.lastTx - sx) ** 2 + (s.lastTy - sy) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (!best) return;
    const dx = e.tx / 256 - sx;
    const dy = e.ty / 256 - sy;
    best.aim = facingOf(dx, dy, FACINGS);
    best.aimHold = now + 700;
  }

  private drawOverlay(vs: ViewState): void {
    const g = this.overlay;
    g.clear();
    const r = vs.rally;
    if (r) {
      const a = tileToScreen(r.from.tx, r.from.ty);
      const b = tileToScreen(r.to.tx + 0.5, r.to.ty + 0.5);
      const n = Math.max(1, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 14));
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 0.55) / n;
        g.moveTo(a.x + (b.x - a.x) * t0, a.y + (b.y - a.y) * t0).lineTo(a.x + (b.x - a.x) * t1, a.y + (b.y - a.y) * t1).stroke({ color: 0x7ff5cd, width: 2, alpha: 0.85 });
      }
      g.circle(b.x, b.y, 6).stroke({ color: 0x7ff5cd, width: 2 }).circle(b.x, b.y, 2).fill(0x7ff5cd);
      g.poly(tilePoly(r.to.tx, r.to.ty, 1, 1)).fill({ color: 0x7ff5cd, alpha: 0.18 });
    }
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
    this.applyFx(vs.fx, vs.time);
    const sh = vs.fx.shake ? this.effects.update(vs.time) : (this.effects.update(vs.time), { x: 0, y: 0 });
    this.world.position.set(v.width / 2 - cam.x * cam.zoom + sh.x, v.height / 2 - cam.y * cam.zoom + sh.y);

    if (snap) {
      if (this.fog && snap.fog && snap.tick !== this.lastFogTick) {
        this.fog.update(snap.fog);
        this.lastFogTick = snap.tick;
      }
      if (snap.tick !== this.lastShardTick && snap.tick % 4 === 0) {
        this.drawShards(snap, vs.time, vs.fx.decor);
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
      const mdx = u.tx - s.lastTx;
      const mdy = u.ty - s.lastTy;
      const moved = Math.abs(mdx) + Math.abs(mdy) > 0.002;
      s.moving = moved ? 6 : Math.max(0, s.moving - 1);
      if (moved) s.heading = facingOf(mdx, mdy, FACINGS);
      // The weapon points at its target while a shot holds it, else along the heading. Hulls without a turret turn with it.
      const aimF = vs.time <= s.aimHold ? s.aim : s.heading;
      setFacing(s.art, s.art.turret ? s.heading : aimF, aimF);
      s.lastTx = u.tx;
      s.lastTy = u.ty;
      animateUnit(s.art, vs.time + u.id * 37, s.moving > 0, u.load / 200, vs.fx.particles || vs.fx.shake);
      const sel = vs.selectedUnits.has(u.id);
      s.ring.visible = sel;
      s.bar.visible = barVisible(u.hp, s.maxHp, sel);
      if (s.bar.visible) {
        const frac = Math.max(0, Math.min(1, u.hp / s.maxHp));
        const top = -s.art.topY;
        s.bar.clear().rect(-13, top - 1, 26, 6).fill(0x04130d).rect(-12, top, 24 * frac, 4).fill(frac > 0.5 ? 0x4cd964 : frac > 0.25 ? 0xffcc00 : 0xff3b30);
        s.bar.rect(-12, top, 24 * frac, 1).fill({ color: 0xffffff, alpha: 0.35 });
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
