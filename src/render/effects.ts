import { Container, Graphics } from 'pixi.js';
import type { SimEvent } from '../sim';
import { buildingDef } from '../data/defs';
import { OWNER_COLORS } from './colors';
import { muzzleFor, shadeCube } from './gfx';
import { tileToScreen } from './iso';

interface Fx {
  g: Graphics;
  born: number;
  life: number;
  step: (k: number, g: Graphics) => void;
}

const TICK_MS = 50;
const toScreen = (x: number, y: number): { x: number; y: number } => tileToScreen(x / 256, y / 256);
const WEAPON_COLOR: Record<string, number> = { pierce: 0xfff1a8, rocket: 0xffb347, blast: 0xff8c42, claw: 0xff5a8a, bite: 0xff7a9a, beam: 0x9ff0ff };
/** Shots fired by top-rank (elite) units, in both renderers (BAL-7). */
export const ELITE_SHOT_2D = 0xd36bff;

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
    const color = e.elite ? ELITE_SHOT_2D : WEAPON_COLOR[e.weapon] ?? 0xffffff;
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
    } else if (e.weapon === 'claw' || e.weapon === 'bite') {
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
    if (e.crushed) return this.crushed(p, e.kind.startsWith('ali_'), now);
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
        // A small lit cube: bright top, mid left face, dark right face.
        const cx = p.x + Math.cos(ang) * sp * k;
        const cy = p.y - 10 + Math.sin(ang) * sp * 0.5 * k - 30 * k * (1 - k);
        const s = 3 * (1 - k) + 1.5;
        const c = shadeCube(col);
        g.clear();
        g.poly([cx, cy - s, cx + s, cy - s / 2, cx, cy, cx - s, cy - s / 2]).fill({ color: c.top, alpha: 1 - k });
        g.poly([cx - s, cy - s / 2, cx, cy, cx, cy + s, cx - s, cy + s / 2]).fill({ color: c.left, alpha: 1 - k });
        g.poly([cx + s, cy - s / 2, cx, cy, cx, cy + s, cx + s, cy + s / 2]).fill({ color: c.right, alpha: 1 - k });
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

  /** A squad run over by a heavy vehicle (BAL-2): a flat puff of dust (Aegis) or ichor (Vrax) and a lasting mark. */
  private crushed(p: { x: number; y: number }, organic: boolean, now: number): void {
    const dust = organic ? 0x4a6a2a : 0x9a8c72;
    this.add(520, now, (k, g) => g.clear().ellipse(p.x, p.y - 2, 10 + 16 * k, 4 + 6 * k).fill({ color: dust, alpha: (1 - k) * 0.7 }), p.y);
    this.add(this.decor ? 9000 : 3500, now, (k, g) => g.clear().ellipse(p.x, p.y + 2, 13, 5).fill({ color: organic ? 0x3f8a10 : 0x2a2420, alpha: 0.45 * (1 - k) }), -1e6);
    this.shake = Math.max(this.shake, 1);
  }

  private launch(e: Extract<SimEvent, { t: 'launch' }>, now: number): void {
    const p = toScreen(e.x, e.y);
    // A launch site out of sight (SW-2) is not shown: only the target is marked.
    if (!e.unseen)
      this.add(e.delay * TICK_MS, now, (k, g) => {
        g.clear().rect(p.x - 3, p.y - 400 * k - 40, 6, 400 * k).fill({ color: 0xffffff, alpha: 1 - k * 0.4 });
        g.circle(p.x, p.y - 40, 14 * (1 - k) + 4).fill({ color: 0x9ff0ff, alpha: 0.7 });
      }, p.y);
    // The target is marked until the strike lands: a glowing disc and rings pulsing faster as it nears (R3D-16).
    const t = toScreen(e.tx, e.ty);
    const r = (buildingDef(e.kind).superweapon?.radius ?? 3) * 34;
    const color = e.kind.startsWith('ali_') ? 0xb6ff5c : 0x8fd8ff;
    this.add(e.delay * TICK_MS, now, (k, g) => {
      const pulse = (k * (3 + 6 * k)) % 1;
      g.clear().ellipse(t.x, t.y, r, r * 0.5).fill({ color, alpha: 0.08 + 0.25 * k });
      g.ellipse(t.x, t.y, r * (1.1 - 0.8 * pulse), r * (1.1 - 0.8 * pulse) * 0.5).stroke({ color, width: 3, alpha: 0.9 - 0.5 * pulse });
      g.rect(t.x - 1 - 3 * k, t.y - 900, 2 + 6 * k, 900).fill({ color: 0xffffff, alpha: 0.15 + 0.5 * k });
    }, t.y);
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
