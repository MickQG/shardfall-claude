import { Container, Graphics } from 'pixi.js';
import type { SimEvent } from '../sim';
import { OWNER_COLORS } from './colors';
import { muzzleFor } from './gfx';
import { tileToScreen } from './iso';

interface Fx {
  g: Graphics;
  born: number;
  life: number;
  step: (k: number, g: Graphics) => void;
}

const TICK_MS = 50;
const toScreen = (x: number, y: number): { x: number; y: number } => tileToScreen(x / 256, y / 256);
const WEAPON_COLOR: Record<string, number> = { pierce: 0xfff1a8, rocket: 0xffb347, blast: 0xff8c42, claw: 0xff5a8a, beam: 0x9ff0ff };

/** Short-lived procedural effects driven by simulation events. Positions are iso screen pixels. */
export class Effects {
  readonly layer = new Container();
  private list: Fx[] = [];
  /** Screen shake amplitude in pixels, decays each frame. */
  shake = 0;
  /** Decorative extras (scorch decals, lingering smoke) allowed by the quality settings. */
  decor = true;

  private add(life: number, now: number, step: Fx['step'], z = 0): Graphics {
    const g = new Graphics();
    g.zIndex = 1e6 + z;
    this.layer.addChild(g);
    this.list.push({ g, born: now, life, step });
    return g;
  }

  spawn(e: SimEvent, now: number): void {
    switch (e.t) {
      case 'shot':
        return this.shot(e, now);
      case 'boom':
        return this.boom(e.x, e.y, e.r, now);
      case 'die':
        return this.die(e, now);
      case 'launch':
        return this.launch(e, now);
      case 'strike':
        return this.strike(e, now);
    }
  }

  private shot(e: Extract<SimEvent, { t: 'shot' }>, now: number): void {
    const a = toScreen(e.x, e.y);
    const b = toScreen(e.tx, e.ty);
    const color = WEAPON_COLOR[e.weapon] ?? 0xffffff;
    const aY = a.y - (e.air ? 0 : 10);
    // Muzzle flash: a directional burst whose length, width and colour depend on the weapon.
    const mz = muzzleFor(e.weapon);
    const ang = Math.atan2(b.y - aY, b.x - a.x);
    this.add(110, now, (k, g) => {
      const len = mz.len * (1 - k * 0.5);
      const w = mz.width * (1 - k);
      g.clear();
      const px = -Math.sin(ang) * w;
      const py = Math.cos(ang) * w;
      g.poly([a.x + px, aY + py, a.x + Math.cos(ang) * len, aY + Math.sin(ang) * len, a.x - px, aY - py]).fill({ color: mz.color, alpha: 1 - k });
      g.circle(a.x, aY, mz.width * 0.9 * (1 - k) + 1).fill({ color: 0xffffff, alpha: (1 - k) * 0.8 });
    }, a.y);
    if (e.flight > 0) {
      const life = e.flight * TICK_MS;
      const arc = e.weapon === 'blast';
      this.add(life, now, (k, g) => {
        const x = a.x + (b.x - a.x) * k;
        const y = aY + (b.y - aY) * k - (arc ? Math.sin(k * Math.PI) * 60 : 0);
        g.clear().circle(x, y, arc ? 4 : 3).fill(color);
        // Smoke trail.
        for (let i = 1; i <= 4; i++) {
          const kk = Math.max(0, k - i * 0.04);
          const tx = a.x + (b.x - a.x) * kk;
          const ty = aY + (b.y - aY) * kk - (arc ? Math.sin(kk * Math.PI) * 60 : 0);
          g.circle(tx, ty, 3 - i * 0.5).fill({ color: 0xcccccc, alpha: 0.35 - i * 0.07 });
        }
      }, b.y);
      this.add(life + 160, now, (k, g) => {
        const t = Math.max(0, (k * (life + 160) - life) / 160);
        g.clear();
        if (t > 0) g.circle(b.x, b.y - 6, 6 + t * 10).fill({ color, alpha: (1 - t) * 0.8 });
      }, b.y);
    } else if (e.weapon === 'claw') {
      this.add(160, now, (k, g) => {
        g.clear();
        g.moveTo(b.x - 8, b.y - 18 + k * 10).lineTo(b.x + 8, b.y - 4 + k * 10).stroke({ color, width: 3 * (1 - k) + 1, alpha: 1 - k });
        g.moveTo(b.x - 2, b.y - 20 + k * 10).lineTo(b.x + 12, b.y - 8 + k * 10).stroke({ color, width: 2 * (1 - k) + 1, alpha: 1 - k });
      }, b.y);
    } else {
      this.add(110, now, (k, g) => {
        g.clear().moveTo(a.x, aY).lineTo(b.x, b.y - 8).stroke({ color, width: 2.4 * (1 - k) + 0.6, alpha: 1 - k * 0.7 });
        g.circle(b.x, b.y - 8, 4 * (1 - k) + 1).fill({ color, alpha: 1 - k });
      }, b.y);
    }
  }

  private boom(x: number, y: number, r: number, now: number): void {
    const p = toScreen(x, y);
    const size = 26 + r * 22;
    this.add(520, now, (k, g) => {
      g.clear();
      g.circle(p.x, p.y - 6, size * (0.3 + k * 0.9)).stroke({ color: 0xffd28a, width: 3 * (1 - k), alpha: (1 - k) * 0.8 });
      g.circle(p.x, p.y - 6, size * (0.2 + k * 0.5)).fill({ color: 0xff8c2a, alpha: (1 - k) * 0.7 });
      g.circle(p.x, p.y - 8, size * 0.28 * (1 - k)).fill({ color: 0xfff3c4, alpha: 1 - k });
    }, p.y);
    if (this.decor) this.add(9000, now, (k, g) => g.clear().ellipse(p.x, p.y + 2, size * 0.55, size * 0.27).fill({ color: 0x000000, alpha: 0.36 * (1 - k) }), -1e6);
    this.shake = Math.max(this.shake, 2 + r * 2);
  }

  private die(e: Extract<SimEvent, { t: 'die' }>, now: number): void {
    const p = toScreen(e.x, e.y);
    const n = e.big ? 16 : 7;
    const sc = e.big ? 1.8 : 1;
    // Fireball and shockwave.
    this.add(e.big ? 700 : 420, now, (k, g) => {
      g.clear();
      g.circle(p.x, p.y - 8, 18 * sc * (0.4 + k)).fill({ color: 0xff9a3c, alpha: (1 - k) * 0.85 });
      g.circle(p.x, p.y - 8, 9 * sc * (1 - k)).fill({ color: 0xffffff, alpha: 1 - k });
      g.ellipse(p.x, p.y + 2, 34 * sc * k, 14 * sc * k).stroke({ color: 0xffe0a0, width: 2, alpha: (1 - k) * 0.7 });
    }, p.y);
    // Debris and smoke particles.
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (e.x % 7);
      const sp = (20 + ((i * 37 + e.x) % 30)) * sc;
      const col = i % 3 === 0 ? 0x5a5a5a : i % 3 === 1 ? (OWNER_COLORS[e.owner] ?? 0xffffff) : 0xffb347;
      this.add(600 + (i % 4) * 90, now, (k, g) => {
        g.clear().circle(p.x + Math.cos(ang) * sp * k, p.y - 10 + Math.sin(ang) * sp * 0.5 * k - 30 * k * (1 - k), 3 * (1 - k) + 1).fill({ color: col, alpha: 1 - k });
      }, p.y);
    }
    // Scorch mark.
    this.add(this.decor ? 9000 : 3500, now, (k, g) => g.clear().ellipse(p.x, p.y + 2, 16 * sc, 7 * sc).fill({ color: 0x000000, alpha: 0.4 * (1 - k) }), -1e6);
    if (e.big && this.decor) {
      for (let i = 0; i < 5; i++) {
        const ox = (i - 2) * 9;
        this.add(2600 + i * 250, now, (k, g) => g.clear().circle(p.x + ox + Math.sin(k * 5 + i) * 4, p.y - 14 - k * 60, 7 + k * 12).fill({ color: 0x3a3a3a, alpha: (1 - k) * 0.5 }), p.y + 1);
      }
    }
    this.shake = Math.max(this.shake, e.big ? 6 : 1.5);
  }

  private launch(e: Extract<SimEvent, { t: 'launch' }>, now: number): void {
    const p = toScreen(e.x, e.y);
    this.add(e.delay * TICK_MS, now, (k, g) => {
      g.clear().rect(p.x - 3, p.y - 400 * k - 40, 6, 400 * k).fill({ color: 0xffffff, alpha: 1 - k * 0.4 });
      g.circle(p.x, p.y - 40, 14 * (1 - k) + 4).fill({ color: 0x9ff0ff, alpha: 0.7 });
    }, p.y);
  }

  private strike(e: Extract<SimEvent, { t: 'strike' }>, now: number): void {
    const p = toScreen(e.x, e.y);
    const r = Math.max(2, e.r) * 34;
    this.add(1100, now, (k, g) => {
      g.clear();
      g.rect(p.x - 10 * (1 - k), p.y - 900, 20 * (1 - k), 900).fill({ color: 0xffffff, alpha: (1 - k) * 0.9 });
      g.ellipse(p.x, p.y, r * (0.2 + k), r * (0.2 + k) * 0.5).fill({ color: 0xffb060, alpha: (1 - k) * 0.55 });
      g.ellipse(p.x, p.y, r * (0.3 + 1.1 * k), r * (0.3 + 1.1 * k) * 0.5).stroke({ color: 0xffffff, width: 4 * (1 - k), alpha: 1 - k });
    }, p.y);
    this.shake = Math.max(this.shake, 14);
  }

  /** Advance and cull effects; returns the current shake offset to apply to the camera. */
  update(now: number): { x: number; y: number } {
    const keep: Fx[] = [];
    for (const f of this.list) {
      const k = (now - f.born) / f.life;
      if (k >= 1) {
        f.g.destroy();
        continue;
      }
      f.step(Math.max(0, k), f.g);
      keep.push(f);
    }
    this.list = keep;
    this.shake *= 0.9;
    if (this.shake < 0.2) this.shake = 0;
    return { x: (Math.sin(now * 0.09) * this.shake) | 0, y: (Math.cos(now * 0.11) * this.shake) | 0 };
  }
}
