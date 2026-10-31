import { Container, Sprite, Texture } from 'pixi.js';
import { FP, type SimEvent } from '../sim';
import { tileToScreen } from './iso';

/** A short-lived pool of light on the battlefield (NXT-5): position in world pixels, radius in px, colour, life in ms. */
export interface LightSpec {
  x: number;
  y: number;
  radius: number;
  color: number;
  life: number;
  /** Peak brightness 0..1. */
  power: number;
}

/** At most this many lights live at once; the oldest give way, so a huge fight cannot flood the GPU. */
export const MAX_LIGHTS = 40;

const at = (x: number, y: number): { x: number; y: number } => tileToScreen(x / FP, y / FP);

/** Which light, if any, a simulation event casts. Pure. */
export function lightFor(e: SimEvent): LightSpec | null {
  switch (e.t) {
    case 'shot': {
      const p = at(e.x, e.y);
      return { x: p.x, y: p.y - 8, radius: 46, color: e.weapon === 'claw' ? 0xb6ff5c : 0xffc46a, life: 140, power: 0.55 };
    }
    case 'boom': {
      const p = at(e.x, e.y);
      return { x: p.x, y: p.y, radius: 90 + e.r * 40, color: 0xff9440, life: 520, power: 0.8 };
    }
    case 'die': {
      const p = at(e.x, e.y);
      return { x: p.x, y: p.y, radius: e.big ? 150 : 80, color: 0xff7a30, life: e.big ? 900 : 500, power: 0.85 };
    }
    case 'strike': {
      const p = at(e.x, e.y);
      return { x: p.x, y: p.y, radius: 420, color: 0xfff0c0, life: 1400, power: 1 };
    }
    default:
      return null;
  }
}

/** Brightness 0..1 of a light `age` ms into its `life`: a fast rise, then an ease-out fade. Pure. */
export function lightPower(spec: Pick<LightSpec, 'life' | 'power'>, age: number): number {
  if (age < 0 || age >= spec.life) return 0;
  const t = age / spec.life;
  const rise = Math.min(1, t / 0.08);
  return spec.power * rise * (1 - t) * (1 - t);
}

let glow: Texture | null = null;

/** A soft radial gradient, white in the middle, drawn once and shared by every light. */
function glowTexture(): Texture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  glow = Texture.from(c);
  return glow;
}

/** Additive light pools from muzzle flashes, explosions and deaths, flattened onto the iso ground. */
export class LightPools {
  readonly layer = new Container();
  private live: { s: Sprite; spec: LightSpec; born: number }[] = [];

  constructor() {
    this.layer.blendMode = 'add';
  }

  spawn(e: SimEvent, now: number): void {
    const spec = lightFor(e);
    if (!spec) return;
    if (this.live.length >= MAX_LIGHTS) this.live.shift()?.s.destroy();
    const s = new Sprite(glowTexture());
    s.anchor.set(0.5);
    s.position.set(spec.x, spec.y);
    s.width = spec.radius * 2;
    s.height = spec.radius; // squashed onto the ground plane
    s.tint = spec.color;
    s.alpha = 0;
    this.layer.addChild(s);
    this.live.push({ s, spec, born: now });
  }

  update(now: number): void {
    this.live = this.live.filter((l) => {
      const p = lightPower(l.spec, now - l.born);
      if (p <= 0 && now - l.born >= l.spec.life) {
        l.s.destroy();
        return false;
      }
      l.s.alpha = p;
      return true;
    });
  }

  get count(): number {
    return this.live.length;
  }
}
