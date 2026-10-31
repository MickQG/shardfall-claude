import { hash3, Shape } from './kit';
import type { RigDef, RigNode } from './rig';

/**
 * Procedural building, crystal and prop models (R3D-3). Buildings stand on their footprint centre; tall parts sit
 * toward the back (-X, -Z) so they do not hide the front from the fixed camera, which looks from +X +Z.
 */

const STEEL = 0x959c97;
const STEEL2 = 0x6a716d;
const CONCRETE = 0x8a877e;
const CONCRETE2 = 0x6a675f;
const GUN = 0x3b4248;
const DARK = 0x202428;
const HAZARD = 0xe0aa2c;
const GLASS = 0x22384a;
const CYAN = 0x6fe2ff;
const AMBER = 0xffb347;
const RED = 0xff4a3a;
const SAND = 0x8f8160;
const CHITIN = 0x4b2b45;
const CHITIN2 = 0x6e4062;
const BELLY = 0x2c1a28;
const BONE = 0xd9ccb2;
const FLESH = 0x8c4460;
const GREEN = 0x9dff3c;
const ACID = 0xc8ff4a;
const MAGENTA = 0xff5ab0;

const shape = (): Shape => new Shape();

const def = (w: number, d: number, height: number, shapes: RigDef['shapes'], kids: RigNode[], o: Partial<RigDef> = {}): RigDef => ({
  shapes,
  root: { kids: [{ geo: 'body' }, ...kids] },
  move: 'static',
  radius: Math.max(w, d) / 2,
  height,
  ...o,
});

/** Aegis concrete foundation with hazard-striped corners. */
function plinth(s: Shape, w: number, d: number): Shape {
  s.box(w - 0.06, 0.1, d - 0.06, CONCRETE, { at: [0, 0.05, 0], bevel: 0.3 });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) s.box(0.16, 0.02, 0.16, HAZARD, { at: [x * (w / 2 - 0.14), 0.105, z * (d / 2 - 0.14)], bevel: 0 });
  return s;
}

/** A row of glowing window slits along X on the +Z face (and mirrored on +X when `alsoX`). */
function windows(s: Shape, x0: number, x1: number, y: number, z: number, n: number, color = CYAN): void {
  for (let i = 0; i < n; i++) s.box(((x1 - x0) / n) * 0.55, 0.05, 0.012, color, { at: [x0 + ((i + 0.5) * (x1 - x0)) / n, y, z], glow: true, bevel: 0 });
}
function windowsX(s: Shape, z0: number, z1: number, y: number, x: number, n: number, color = CYAN): void {
  for (let i = 0; i < n; i++) s.box(0.012, 0.05, ((z1 - z0) / n) * 0.55, color, { at: [x, y, z0 + ((i + 0.5) * (z1 - z0)) / n], glow: true, bevel: 0 });
}

/** A bone arch over the centre: segments along a half circle of radius `r` and height `h`, turned by `a` about Y. */
function boneArch(s: Shape, r: number, h: number, a: number, thick: number): void {
  const n = 7;
  for (let j = 0; j <= n; j++) {
    const t = (j / n) * Math.PI;
    const x = Math.cos(t) * r;
    s.box(thick, (Math.PI * Math.max(r, h)) / n + 0.04, thick, BONE, { at: [x * Math.cos(a), 0.1 + Math.sin(t) * h, -x * Math.sin(a)], rot: [0, a, t], bevel: 0.4 });
  }
}

/** Organic Vrax ground cover: a low fleshy mound with chitin rim. */
function mound(s: Shape, w: number, d: number): Shape {
  s.lathe([[0, 0], [0.5, 0.0], [0.48, 0.06], [0.36, 0.11], [0, 0.13]], BELLY, { scale: [w * 0.98, 1, d * 0.98], seg: 18 });
  s.lathe([[0.47, 0], [0.5, 0.02], [0.47, 0.07], [0.42, 0.06]], CHITIN, { scale: [w * 0.98, 1, d * 0.98], seg: 18 });
  return s;
}

// ---------------------------------------------------------------- Aegis

function humHq(): RigDef {
  return def(3, 3, 2.3, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      const oct = (r: number): [number, number][] => [[r, -r * 0.55], [r, r * 0.55], [r * 0.55, r], [-r * 0.55, r], [-r, r * 0.55], [-r, -r * 0.55], [-r * 0.55, -r], [r * 0.55, -r]];
      s.hull(oct(1.15), 0.62, STEEL, { at: [0, 0.1, 0], bevel: 0.04 });
      s.hull(oct(1.18), 0.08, 'team', { at: [0, 0.6, 0], bevel: 0.02 });
      s.hull(oct(0.85), 0.36, STEEL2, { at: [0.0, 0.68, 0.0], bevel: 0.04 });
      windows(s, -0.6, 0.6, 0.42, 1.155, 6);
      windowsX(s, -0.6, 0.6, 0.42, 1.155, 6);
      windows(s, -0.4, 0.4, 0.86, 0.855, 4, AMBER);
      windowsX(s, -0.4, 0.4, 0.86, 0.855, 4, AMBER);
      // Main entrance with a lit frame, on the +X face.
      s.box(0.04, 0.3, 0.5, DARK, { at: [1.15, 0.27, 0], bevel: 0 });
      s.box(0.05, 0.03, 0.56, AMBER, { at: [1.16, 0.44, 0], glow: true, bevel: 0 });
      // Command tower, back left.
      s.cyl(0.32, 0.9, STEEL, { at: [-0.45, 1.45, -0.45], seg: 16 });
      s.cyl(0.335, 0.12, GLASS, { at: [-0.45, 1.62, -0.45], seg: 16 });
      s.cyl(0.338, 0.03, CYAN, { at: [-0.45, 1.62, -0.45], seg: 16, glow: true });
      s.cyl(0.36, 0.06, 'team', { at: [-0.45, 1.93, -0.45], seg: 16 });
      s.cone(0.3, 0.14, STEEL2, { at: [-0.45, 2.03, -0.45], seg: 16 });
      // Helipad, front right on the upper deck.
      s.cyl(0.36, 0.03, DARK, { at: [0.45, 1.06, 0.45], seg: 20 });
      s.ring(0.33, 0.012, AMBER, { at: [0.45, 1.08, 0.45], seg: 24, glow: true });
      s.box(0.04, 0.012, 0.22, HAZARD, { at: [0.38, 1.08, 0.45], bevel: 0 });
      s.box(0.04, 0.012, 0.22, HAZARD, { at: [0.52, 1.08, 0.45], bevel: 0 });
      s.box(0.14, 0.012, 0.04, HAZARD, { at: [0.45, 1.08, 0.45], bevel: 0 });
      // Antenna mast and vents.
      s.cyl(0.012, 0.7, DARK, { at: [0.5, 1.4, -0.55], seg: 5 });
      s.ball(0.025, RED, { at: [0.5, 1.76, -0.55], seg: 6, glow: true });
      for (let i = 0; i < 3; i++) s.box(0.14, 0.08, 0.1, GUN, { at: [-0.85, 0.78, 0.4 - i * 0.2] });
      return s;
    },
    radar: () => {
      const s = shape();
      s.cyl(0.03, 0.16, DARK, { at: [0, 0.08, 0], seg: 6 });
      s.lathe([[0.0, 0], [0.12, 0.02], [0.2, 0.07], [0.22, 0.09]], STEEL, { at: [0.05, 0.2, 0], rot: [0, 0, -1.1], seg: 12 });
      s.cyl(0.008, 0.12, DARK, { at: [0.1, 0.24, 0], rot: [0, 0, -1.1], seg: 4 });
      return s;
    },
  }, [{ geo: 'radar', at: [-0.45, 2.1, -0.45], anim: { k: 'spin', axis: 'y', rate: 1.1 } }]);
}

function humReactor(): RigDef {
  return def(2, 2, 1.5, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      // Two cooling towers at the back.
      for (const [x, z] of [[-0.45, -0.45], [-0.45, 0.35]] as const) {
        s.lathe([[0.36, 0], [0.3, 0.4], [0.26, 0.72], [0.29, 1.0], [0.27, 1.02]], CONCRETE, { at: [x, 0.1, z], seg: 16 });
        s.lathe([[0.37, 0], [0.37, 0.1], [0.355, 0.12]], 'team', { at: [x, 0.1, z], seg: 16 });
        s.cyl(0.24, 0.02, DARK, { at: [x, 1.1, z], seg: 14 });
      }
      // Reactor dome with a glowing core ring.
      s.cyl(0.42, 0.18, STEEL2, { at: [0.38, 0.19, 0.1], seg: 18 });
      s.ball(0.4, STEEL, { at: [0.38, 0.28, 0.1], cut: 0.5, seg: 18 });
      s.ring(0.41, 0.025, CYAN, { at: [0.38, 0.29, 0.1], seg: 24, glow: true });
      s.cyl(0.08, 0.06, CYAN, { at: [0.38, 0.69, 0.1], seg: 10, glow: true });
      s.ring(0.12, 0.02, 'team', { at: [0.38, 0.67, 0.1], seg: 14 });
      // Coolant pipes.
      s.tube(0.04, 0.6, GUN, { at: [0.0, 0.25, -0.45] });
      s.tube(0.04, 0.6, GUN, { at: [0.0, 0.25, 0.35] });
      s.box(0.2, 0.18, 0.22, STEEL2, { at: [0.5, 0.19, -0.6] });
      s.box(0.012, 0.05, 0.14, AMBER, { at: [0.605, 0.22, -0.6], glow: true, bevel: 0 });
      return s;
    },
  }, [], { vents: [[-0.45, 1.15, -0.45], [-0.45, 1.15, 0.35]] });
}

function humRefinery(): RigDef {
  return def(3, 2, 1.4, {
    body: () => {
      const s = plinth(shape(), 3, 2);
      // Processing hall at the back.
      s.slab([[-1.35, 0.1], [0.1, 0.1], [0.1, 0.62], [-0.3, 0.8], [-1.35, 0.8]], 0.95, STEEL, { at: [0, 0, -0.45], bevel: 0.03 });
      s.box(1.46, 0.06, 0.97, 'team', { at: [-0.62, 0.56, -0.45], bevel: 0.3 });
      windows(s, -1.2, 0.0, 0.35, 0.03, 5, AMBER);
      // Silos with team bands.
      for (const x of [-1.05, -0.6]) {
        s.cyl(0.2, 0.9, STEEL2, { at: [x, 0.55, 0.45], seg: 14 });
        s.ball(0.2, STEEL2, { at: [x, 1.0, 0.45], cut: 0.5, seg: 14 });
        s.cyl(0.205, 0.08, 'team', { at: [x, 0.8, 0.45], seg: 14 });
      }
      // Shard processing tank with glowing crystal slurry.
      s.cyl(0.24, 0.42, GLASS, { at: [0.35, 0.33, -0.45], seg: 14 });
      s.cyl(0.2, 0.3, 0x47e8c4, { at: [0.35, 0.3, -0.45], seg: 14, glow: true });
      s.ring(0.245, 0.02, STEEL, { at: [0.35, 0.55, -0.45], seg: 16 });
      // Unloading dock on the front right, with a hazard-marked pad.
      s.box(1.0, 0.03, 0.75, DARK, { at: [0.8, 0.115, 0.35], bevel: 0 });
      for (let i = 0; i < 5; i++) s.box(0.06, 0.012, 0.75, HAZARD, { at: [0.36 + i * 0.22, 0.13, 0.35], bevel: 0 });
      s.slab([[0.2, 0.1], [0.4, 0.1], [0.4, 0.5], [0.3, 0.55]], 0.4, STEEL2, { at: [0, 0, 0.0], bevel: 0.02 });
      s.tube(0.035, 0.7, GUN, { at: [0.1, 0.5, -0.1], rot: [0, 0, 0.3] }); // conveyor
      // Chimney.
      s.cyl(0.08, 0.7, CONCRETE2, { at: [-1.2, 1.0, -0.75], seg: 10 });
      s.cyl(0.09, 0.05, RED, { at: [-1.2, 1.32, -0.75], seg: 10, glow: true });
      return s;
    },
  }, [], { vents: [[-1.2, 1.4, -0.75]] });
}

function humBarracks(): RigDef {
  return def(2, 2, 1.1, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      s.slab([[-0.8, 0.1], [0.75, 0.1], [0.75, 0.45], [0.35, 0.68], [-0.8, 0.68]], 1.5, STEEL, { bevel: 0.04 });
      s.slab([[0.33, 0.66], [0.77, 0.43], [0.8, 0.47], [0.36, 0.72]], 1.54, 'team', { bevel: 0.01 });
      windowsX(s, -0.55, 0.55, 0.36, 0.76, 4, AMBER);
      s.box(0.04, 0.26, 0.34, DARK, { at: [0.765, 0.24, 0.0], bevel: 0 }); // door
      s.box(0.05, 0.025, 0.38, AMBER, { at: [0.77, 0.38, 0.0], glow: true, bevel: 0 });
      windows(s, -0.6, 0.2, 0.42, 0.76, 3);
      // Sandbag walls by the door.
      for (const z of [0.42, -0.42]) for (let i = 0; i < 4; i++) s.ball(0.06, SAND, { at: [0.88, 0.14 + (i % 2) * 0.06, z + (i - 1.5) * 0.08], scale: [0.9, 0.55, 1.2], seg: 6 });
      // Flag pole with a team flag; antenna; roof vents.
      s.cyl(0.012, 0.8, DARK, { at: [-0.7, 1.05, 0.7], seg: 5 });
      s.box(0.26, 0.15, 0.012, 'team', { at: [-0.56, 1.36, 0.7], bevel: 0 });
      s.cyl(0.008, 0.5, DARK, { at: [-0.6, 0.93, -0.6], seg: 4 });
      s.ball(0.02, RED, { at: [-0.6, 1.19, -0.6], seg: 6, glow: true });
      for (let i = 0; i < 2; i++) s.box(0.18, 0.08, 0.16, GUN, { at: [-0.4, 0.72, -0.35 + i * 0.4] });
      return s;
    },
  }, []);
}

function humFactory(): RigDef {
  return def(3, 3, 1.7, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      // Arched assembly hangar along X; its big bay door faces +X.
      s.box(2.3, 0.4, 1.5, STEEL2, { at: [-0.2, 0.3, -0.3], bevel: 0.05 });
      s.arch(0.75, 2.3, STEEL, { at: [-0.2, 0.5, -0.3], seg: 16 });
      for (let i = 0; i < 6; i++) s.arch(0.77, 0.05, 'team', { at: [-1.25 + i * 0.42, 0.5, -0.3], seg: 16 });
      s.box(0.05, 0.62, 1.1, DARK, { at: [0.96, 0.52, -0.3], bevel: 0 }); // bay door
      for (let i = 0; i < 5; i++) s.box(0.055, 0.04, 1.1, i % 2 ? DARK : HAZARD, { at: [0.965, 0.25 + i * 0.12, -0.3], bevel: 0 });
      s.box(0.06, 0.04, 1.2, AMBER, { at: [0.97, 0.87, -0.3], glow: true, bevel: 0 });
      // Side workshop and roller apron.
      s.box(1.2, 0.5, 0.6, STEEL, { at: [-0.5, 0.35, 0.95], bevel: 0.05 });
      s.box(1.22, 0.06, 0.62, 'team', { at: [-0.5, 0.62, 0.95], bevel: 0.3 });
      windows(s, -1.0, 0.0, 0.42, 1.255, 4, AMBER);
      s.box(0.9, 0.02, 1.2, DARK, { at: [1.0, 0.11, -0.3], bevel: 0 }); // apron
      // Gantry crane.
      for (const z of [0.55, 0.05]) s.box(0.06, 0.9, 0.06, HAZARD, { at: [0.55, 0.55, z], bevel: 0.1 });
      s.box(0.08, 0.06, 0.6, HAZARD, { at: [0.55, 1.0, 0.3], bevel: 0.1 });
      s.box(0.12, 0.1, 0.12, GUN, { at: [0.55, 0.92, 0.35] });
      // Exhaust stacks.
      for (const z of [-0.9, -1.15]) {
        s.cyl(0.07, 0.6, CONCRETE2, { at: [-1.2, 1.1, z], seg: 10 });
        s.cyl(0.075, 0.04, RED, { at: [-1.2, 1.38, z], seg: 10, glow: true });
      }
      return s;
    },
    fan: () => {
      const s = shape();
      for (let i = 0; i < 4; i++) s.box(0.24, 0.015, 0.05, GUN, { rot: [0.3, (i * Math.PI) / 2, 0], at: [Math.cos((i * Math.PI) / 2) * 0.1, 0, -Math.sin((i * Math.PI) / 2) * 0.1], bevel: 0 });
      s.cyl(0.03, 0.03, DARK, { seg: 8 });
      return s;
    },
  }, [
    { geo: 'fan', at: [-0.7, 1.27, -0.3], anim: { k: 'spin', axis: 'y', rate: 5 } },
    { geo: 'fan', at: [0.2, 1.27, -0.3], anim: { k: 'spin', axis: 'y', rate: 4.2 } },
  ], { vents: [[-1.2, 1.45, -0.9], [-1.2, 1.45, -1.15]] });
}

function humTurret(): RigDef {
  return def(1, 1, 0.75, {
    body: () => {
      const s = shape();
      s.cyl(0.44, 0.14, CONCRETE, { at: [0, 0.07, 0], seg: 8 });
      s.cyl(0.36, 0.14, STEEL2, { at: [0, 0.21, 0], r2: 0.4, seg: 8 });
      s.ring(0.37, 0.02, 'team', { at: [0, 0.28, 0], seg: 16 });
      for (let i = 0; i < 4; i++) s.box(0.06, 0.02, 0.06, HAZARD, { at: [Math.cos((i * Math.PI) / 2 + 0.4) * 0.4, 0.145, Math.sin((i * Math.PI) / 2 + 0.4) * 0.4], bevel: 0 });
      return s;
    },
    turret: () => {
      const s = shape();
      s.hull([[0.18, -0.14], [0.22, 0], [0.18, 0.14], [-0.2, 0.18], [-0.24, 0], [-0.2, -0.18]], 0.2, STEEL, { bevel: 0.03 });
      s.box(0.26, 0.02, 0.2, 'team', { at: [-0.04, 0.205, 0], bevel: 0.3 });
      s.box(0.05, 0.05, 0.06, GUN, { at: [0.04, 0.23, -0.1] });
      s.box(0.012, 0.025, 0.04, CYAN, { at: [0.068, 0.235, -0.1], glow: true, bevel: 0 });
      s.cyl(0.07, 0.04, CYAN, { at: [-0.12, 0.21, 0], seg: 10, glow: true }); // capacitor
      return s;
    },
    barrel: () => {
      const s = shape();
      for (const z of [0.065, -0.065]) {
        s.tube(0.026, 0.4, GUN, { at: [0.2, 0, z], seg: 10 });
        for (let i = 0; i < 3; i++) s.ring(0.03, 0.008, CYAN, { at: [0.12 + i * 0.09, 0, z], rot: [0, 0, Math.PI / 2], seg: 10, glow: true });
      }
      s.box(0.1, 0.1, 0.2, STEEL2, { at: [0.02, 0, 0] });
      return s;
    },
  }, [
    {
      geo: 'turret',
      at: [0, 0.29, 0],
      anim: { k: 'turret' },
      kids: [{ geo: 'barrel', at: [0.18, 0.1, 0], anim: { k: 'barrel', recoil: 0.05 }, kids: [{ muzzle: true, at: [0.42, 0, 0.065] }, { muzzle: true, at: [0.42, 0, -0.065] }] }],
    },
  ], { weapon: 'pulse' });
}

function humLab(): RigDef {
  return def(2, 2, 1.4, {
    body: () => {
      const s = plinth(shape(), 2, 2);
      s.hull([[0.8, -0.8], [0.8, 0.5], [0.5, 0.8], [-0.8, 0.8], [-0.8, -0.8]], 0.4, STEEL, { at: [0, 0.1, 0], bevel: 0.04 });
      s.hull([[0.82, -0.82], [0.82, 0.51], [0.51, 0.82], [-0.82, 0.82], [-0.82, -0.82]], 0.05, 'team', { at: [0, 0.46, 0], bevel: 0.01 });
      windows(s, -0.6, 0.3, 0.3, 0.805, 4);
      windowsX(s, -0.6, 0.3, 0.3, 0.805, 4);
      // Research dome: glass over a glowing core.
      s.ball(0.38, CYAN, { at: [-0.15, 0.5, -0.15], scale: [0.6, 0.6, 0.6], seg: 12, glow: true });
      s.ball(0.42, GLASS, { at: [-0.15, 0.5, -0.15], cut: 0.5, seg: 18 });
      s.ring(0.42, 0.025, STEEL2, { at: [-0.15, 0.51, -0.15], seg: 24 });
      for (let i = 0; i < 4; i++) s.box(0.02, 0.4, 0.02, STEEL2, { at: [-0.15 + Math.cos(i * 1.57) * 0.3, 0.72, -0.15 + Math.sin(i * 1.57) * 0.3], rot: [Math.sin(i * 1.57) * -0.8, 0, Math.cos(i * 1.57) * 0.8], bevel: 0 });
      s.cyl(0.03, 0.3, DARK, { at: [0.55, 0.65, -0.55], seg: 6 }); // dish mast
      s.box(0.2, 0.12, 0.2, GUN, { at: [0.5, 0.56, 0.45] });
      return s;
    },
    dish: () => {
      const s = shape();
      s.lathe([[0.0, 0], [0.1, 0.015], [0.17, 0.05], [0.19, 0.07]], STEEL, { rot: [0, 0, -0.8], seg: 12 });
      s.cyl(0.006, 0.1, DARK, { at: [0.05, 0.05, 0], rot: [0, 0, -0.8], seg: 4 });
      s.ball(0.015, RED, { at: [0.08, 0.08, 0], seg: 6, glow: true });
      return s;
    },
    halo: () => shape().ring(0.3, 0.012, CYAN, { seg: 24, glow: true }).ring(0.24, 0.008, CYAN, { at: [0, 0.06, 0], seg: 24, glow: true }),
  }, [
    { geo: 'dish', at: [0.55, 0.82, -0.55], anim: { k: 'spin', axis: 'y', rate: 0.6 } },
    { at: [-0.15, 1.0, -0.15], rot: [0.25, 0, 0.15], kids: [{ geo: 'halo', anim: { k: 'spin', axis: 'y', rate: 1.6 } }] },
  ]);
}

function humLance(): RigDef {
  return def(3, 3, 2.4, {
    body: () => {
      const s = plinth(shape(), 3, 3);
      s.cyl(1.1, 0.2, STEEL2, { at: [0, 0.2, 0], seg: 8 });
      s.cyl(1.12, 0.05, 'team', { at: [0, 0.32, 0], seg: 8 });
      // Four pylons braced against the emitter tower.
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        s.box(0.14, 1.3, 0.14, STEEL, { at: [Math.cos(a) * 0.62, 0.9, Math.sin(a) * 0.62], rot: [Math.sin(a) * -0.32, 0, Math.cos(a) * 0.32], bevel: 0.2 });
        s.box(0.08, 0.04, 0.08, AMBER, { at: [Math.cos(a) * 0.85, 0.36, Math.sin(a) * 0.85], glow: true, bevel: 0 });
      }
      s.lathe([[0.42, 0], [0.34, 0.5], [0.22, 1.4], [0.16, 1.9], [0.2, 1.95], [0.0, 2.0]], STEEL, { at: [0, 0.3, 0], seg: 16 });
      for (let i = 0; i < 3; i++) s.ring(0.34 - i * 0.06, 0.035, CYAN, { at: [0, 0.75 + i * 0.45, 0], seg: 20, glow: true });
      s.cone(0.1, 0.3, CYAN, { at: [0, 2.42, 0], seg: 8, glow: true });
      return s;
    },
    coil: () => shape().ring(0.48, 0.03, 'team', { seg: 24 }).box(0.1, 0.08, 0.08, AMBER, { at: [0.48, 0, 0], glow: true, bevel: 0 }).box(0.1, 0.08, 0.08, AMBER, { at: [-0.48, 0, 0], glow: true, bevel: 0 }),
  }, [{ geo: 'coil', at: [0, 1.7, 0], anim: { k: 'spin', axis: 'y', rate: 1.4 } }]);
}

// ---------------------------------------------------------------- Vrax

function aliHq(): RigDef {
  return def(3, 3, 2.3, {
    body: () => {
      const s = mound(shape(), 3, 3);
      // Bone tusks rising around the heart.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        s.cone(0.1, 1.0, BONE, { at: [Math.cos(a) * 1.0, 0.45, Math.sin(a) * 1.0], rot: [Math.sin(a) * 0.45, 0, -Math.cos(a) * 0.45], seg: 7 });
      }
      // Ribbed cage over the heart.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.box(0.08, 1.1, 0.08, CHITIN2, { at: [Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], bevel: 0.4 });
      }
      s.lathe([[0.85, 0], [0.8, 0.25], [0.62, 0.5], [0.3, 0.62], [0, 0.65]], 'teamDark', { at: [0, 0.1, 0], seg: 18 }); // carapace skirt
      s.ring(0.82, 0.03, 'team', { at: [0, 0.2, 0], seg: 24 });
      s.ball(0.2, ACID, { at: [0, 1.55, 0], seg: 10, glow: true }); // crown bulb
      s.cone(0.12, 0.5, BONE, { at: [0, 1.9, 0], seg: 7 });
      return s;
    },
    heart: () => {
      const s = shape();
      s.ball(0.42, FLESH, { seg: 16, scale: [1, 1.15, 1] });
      s.ball(0.3, GREEN, { at: [0.15, 0.05, 0.15], seg: 12, glow: true });
      for (let i = 0; i < 5; i++) s.tube(0.03, 0.5, GREEN, { at: [0, -0.1 + i * 0.08, 0], rot: [0, i * 1.25, 0.6], glow: true, seg: 5 });
      return s;
    },
  }, [{ geo: 'heart', at: [0, 1.0, 0], anim: { k: 'breathe', amp: 0.06, rate: 2.2 } }]);
}

function aliGenerator(): RigDef {
  return def(2, 2, 1.2, {
    body: () => {
      const s = mound(shape(), 2, 2);
      for (const [x, z, r] of [[-0.4, -0.35, 0.36], [0.35, -0.4, 0.28], [-0.35, 0.4, 0.3]] as const) {
        s.ball(r, CHITIN2, { at: [x, r * 0.75, z], scale: [1, 1.2, 1], seg: 14 });
        s.ball(r * 1.01, 'teamDark', { at: [x, r * 0.8, z], scale: [0.9, 1.15, 0.9], cut: 0.3, seg: 14 });
        s.ring(r * 0.55, 0.02, 'team', { at: [x, r * 1.55, z], seg: 12 });
        for (let i = 0; i < 3; i++) s.tube(0.018, r * 1.4, GREEN, { at: [x, r * (0.5 + i * 0.25), z], rot: [0, i * 1.1, 0.4], glow: true, seg: 5 });
      }
      return s;
    },
    orb: () => shape().ball(0.22, GREEN, { seg: 14, glow: true }).ring(0.27, 0.03, BONE, { seg: 16 }),
  }, [{ geo: 'orb', at: [0.3, 0.45, 0.3], anim: { k: 'breathe', amp: 0.12, rate: 3 } }]);
}

function aliExtractor(): RigDef {
  return def(3, 2, 1.3, {
    body: () => {
      const s = mound(shape(), 3, 2);
      // A hunched digester at the back with feeding tubes into the ground.
      s.ball(0.6, CHITIN, { at: [-0.6, 0.35, -0.2], scale: [1.4, 0.95, 1], seg: 16 });
      s.ball(0.6, 'teamDark', { at: [-0.6, 0.38, -0.2], scale: [1.3, 0.92, 0.85], cut: 0.35, seg: 16 });
      s.ball(0.12, 'team', { at: [-0.6, 0.93, -0.2], scale: [3, 0.4, 1.2], seg: 10 });
      for (let i = 0; i < 4; i++) s.cone(0.07, 0.4, BONE, { at: [-1.0 + i * 0.27, 0.95, -0.2], rot: [0, 0, 0.4], seg: 6 });
      for (const z of [0.4, -0.65]) s.tube(0.07, 0.8, FLESH, { at: [0.2, 0.15, z], rot: [0, 0.3, -0.25], seg: 8 });
      // Feeding maw with a glowing pool, front right, where gorgers unload.
      s.ring(0.38, 0.08, BONE, { at: [0.75, 0.15, 0.25], seg: 16 });
      s.cyl(0.32, 0.03, ACID, { at: [0.75, 0.15, 0.25], seg: 16, glow: true });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        s.cone(0.04, 0.16, BONE, { at: [0.75 + Math.cos(a) * 0.38, 0.24, 0.25 + Math.sin(a) * 0.38], rot: [Math.sin(a) * -0.6, 0, Math.cos(a) * 0.6], seg: 4 });
      }
      for (let i = 0; i < 3; i++) s.ball(0.05, GREEN, { at: [-0.25 + i * 0.12, 0.62 - i * 0.05, 0.25], seg: 6, glow: true });
      return s;
    },
  }, [], { vents: [[-0.6, 0.95, -0.2]] });
}

function aliNest(): RigDef {
  return def(2, 2, 1.0, {
    body: () => {
      const s = mound(shape(), 2, 2);
      const eggs = [[-0.4, -0.4, 0.3], [0.1, -0.5, 0.24], [-0.5, 0.15, 0.26], [0.05, 0.0, 0.34], [0.5, 0.2, 0.2], [0.2, 0.5, 0.22], [-0.25, 0.55, 0.18]] as const;
      for (const [x, z, r] of eggs) {
        s.ball(r, CHITIN2, { at: [x, r * 1.1, z], scale: [1, 1.4, 1], seg: 12 });
        s.ball(r * 1.02, 'teamDark', { at: [x, r * 1.0, z], scale: [0.95, 1.2, 0.95], cut: 0.25, seg: 12 });
        s.ball(r * 0.35, GREEN, { at: [x, r * 2.4, z], seg: 8, glow: true });
      }
      return s;
    },
  }, []);
}

function aliPit(): RigDef {
  return def(3, 3, 1.4, {
    body: () => {
      const s = shape();
      // A crater ring with a glowing brood pool and bone arches over it.
      s.lathe([[1.42, 0], [1.38, 0.18], [1.1, 0.34], [0.85, 0.3], [0.7, 0.08], [0.6, 0.02]], CHITIN, { seg: 22 });
      s.lathe([[1.2, 0.3], [1.05, 0.36], [0.88, 0.32]], 'team', { seg: 22 });
      s.cyl(0.72, 0.04, ACID, { at: [0, 0.04, 0], seg: 22, glow: true });
      for (let i = 0; i < 3; i++) boneArch(s, 1.0, 0.95, (i / 3) * Math.PI + 0.3, 0.09);
      for (let i = 0; i < 5; i++) s.ball(0.06, GREEN, { at: [Math.cos(i * 1.3) * 0.4, 0.08, Math.sin(i * 1.3) * 0.4], seg: 6, glow: true });
      return s;
    },
  }, []);
}

function aliSpire(): RigDef {
  return def(1, 1, 1.5, {
    body: () => {
      const s = shape();
      s.lathe([[0.42, 0], [0.38, 0.12], [0.2, 0.4], [0.14, 0.9], [0.17, 1.05], [0.12, 1.1]], CHITIN, { seg: 10 });
      s.lathe([[0.4, 0.04], [0.34, 0.16], [0.26, 0.28]], 'team', { seg: 10 });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        s.cone(0.04, 0.3, BONE, { at: [Math.cos(a) * 0.3, 0.2, Math.sin(a) * 0.3], rot: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7], seg: 5 });
      }
      for (let i = 0; i < 3; i++) s.ring(0.17 - i * 0.012, 0.02, GREEN, { at: [0, 0.55 + i * 0.15, 0], seg: 12, glow: true });
      return s;
    },
    turret: () => {
      const s = shape();
      s.ball(0.17, CHITIN2, { scale: [1.3, 0.9, 1], seg: 12 });
      s.ball(0.17, 'team', { at: [0, 0.02, 0], scale: [1.2, 0.85, 0.8], cut: 0.4, seg: 12 });
      s.ball(0.04, GREEN, { at: [0.18, 0.05, 0], seg: 8, glow: true });
      for (const z of [0.1, -0.1]) s.cone(0.03, 0.18, BONE, { at: [-0.12, 0.12, z], rot: [z > 0 ? 0.4 : -0.4, 0, 0.8], seg: 5 });
      return s;
    },
    barrel: () => shape().tube(0.04, 0.28, BONE, { at: [0.12, 0, 0], r2: 0.06, seg: 8 }).ring(0.035, 0.012, GREEN, { at: [0.26, 0, 0], rot: [0, 0, Math.PI / 2], seg: 10, glow: true }),
  }, [
    { geo: 'turret', at: [0, 1.2, 0], anim: { k: 'turret' }, kids: [{ geo: 'barrel', at: [0.12, 0, 0], anim: { k: 'barrel', recoil: 0.06 }, kids: [{ muzzle: true, at: [0.3, 0, 0] }] }] },
  ], { weapon: 'spine' });
}

function aliEvolver(): RigDef {
  return def(2, 2, 1.9, {
    body: () => {
      const s = mound(shape(), 2, 2);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.tube(0.05, 0.7, FLESH, { at: [Math.cos(a) * 0.55, 0.15, Math.sin(a) * 0.55], rot: [0, -a, 0.15], r2: 0.02, seg: 6 });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.4;
        s.box(0.07, 1.5, 0.07, BONE, { at: [Math.cos(a) * 0.42, 0.85, Math.sin(a) * 0.42], rot: [Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18], bevel: 0.4 });
      }
      s.lathe([[0.3, 0], [0.38, 0.1], [0.3, 0.2]], 'team', { at: [0, 0.1, 0], seg: 14 });
      return s;
    },
    pod: () => {
      const s = shape();
      s.lathe([[0.0, 0], [0.24, 0.12], [0.34, 0.5], [0.3, 0.9], [0.14, 1.15], [0.0, 1.2]], MAGENTA, { seg: 14, glow: true, scale: [0.8, 1, 0.8] });
      s.lathe([[0.0, -0.02], [0.27, 0.1], [0.37, 0.5], [0.33, 0.9], [0.16, 1.16], [0.0, 1.22]], CHITIN2, { seg: 7, scale: [0.88, 1, 0.88] });
      return s;
    },
  }, [{ geo: 'pod', at: [0, 0.3, 0], anim: { k: 'breathe', amp: 0.05, rate: 1.4 } }]);
}

function aliRift(): RigDef {
  return def(3, 3, 2.4, {
    body: () => {
      const s = mound(shape(), 3, 3);
      // Two curved bone horns cradle the rift, set across the camera's line of sight so the portal shows between them.
      for (const side of [1, -1]) {
        const n = 7;
        const pt = (i: number): [number, number, number] => {
          const k = i / n;
          const w = side * 0.95 * (1 - 0.55 * k * k);
          return [w * 0.707, 0.12 + 1.9 * k, -w * 0.707];
        };
        for (let i = 0; i < n; i++) s.strut(pt(i), pt(i + 1), 0.13 * (1 - i / n) + 0.02, BONE, { r2: 0.13 * (1 - (i + 1) / n) + 0.02, seg: 7 });
        s.ball(0.17, CHITIN, { at: pt(0), scale: [1, 0.6, 1], seg: 10 });
      }
      s.lathe([[0.7, 0], [0.62, 0.2], [0.4, 0.3]], 'teamDark', { at: [0, 0.1, 0], seg: 18 });
      s.cyl(0.45, 0.04, MAGENTA, { at: [0, 0.32, 0], seg: 18, glow: true });
      return s;
    },
    portal: () => {
      // Drawn in the local YZ plane (facing +X); the node turns it toward the camera.
      const s = shape();
      s.ring(0.62, 0.06, MAGENTA, { rot: [0, 0, Math.PI / 2], seg: 28, glow: true });
      s.ring(0.5, 0.03, 0xffb0e0, { rot: [0, 0, Math.PI / 2], seg: 24, glow: true });
      s.cyl(0.6, 0.02, 0x5a1050, { rot: [0, 0, Math.PI / 2], seg: 24 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        s.box(0.02, 0.36, 0.05, MAGENTA, { at: [0.015, Math.sin(a) * 0.25, Math.cos(a) * 0.25], rot: [a + 0.9, 0, 0], glow: true, bevel: 0 });
      }
      return s;
    },
    // Turned toward the camera and tilted back so the fixed overhead view sees it face on.
  }, [{ at: [0, 1.2, 0], rot: [0, -Math.PI / 4, 0.62], kids: [{ geo: 'portal', anim: { k: 'spin', axis: 'x', rate: 0.9 } }] }]);
}

// ---------------------------------------------------------------- crystals and props

/** A shard crystal cluster for a depletion level 1..4: hexagonal prisms with pointed tips. */
export function crystalShape(level: number, seed: number): Shape {
  const s = shape();
  const n = [1, 2, 3, 5][Math.min(4, Math.max(1, level)) - 1] as number;
  for (let i = 0; i < n; i++) {
    const a = hash3(seed, i, 1) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.1 + hash3(seed, i, 2) * 0.14;
    const h = (i === 0 ? 0.28 + level * 0.06 : 0.14 + hash3(seed, i, 3) * 0.16) * (0.75 + level * 0.08);
    const w = i === 0 ? 0.07 : 0.045;
    const tilt: [number, number, number] = [Math.sin(a) * 0.35 * (r > 0 ? 1 : 0.3), 0, -Math.cos(a) * 0.35 * (r > 0 ? 1 : 0.3)];
    const at: [number, number, number] = [Math.cos(a) * r, h / 2, Math.sin(a) * r];
    s.cyl(w, h, 0x2fc7b0, { at, rot: tilt, seg: 6 });
    s.cyl(w * 0.55, h * 0.9, 0x9ffcff, { at, rot: tilt, seg: 6, glow: true });
    // The tip sits on the prism's top along its tilted axis: (0, L, 0) turned by the XYZ Euler (no Y turn).
    const L = h / 2 + w * 1.1;
    const tip: [number, number, number] = [at[0] - L * Math.sin(tilt[2]), at[1] + L * Math.cos(tilt[2]) * Math.cos(tilt[0]), at[2] + L * Math.cos(tilt[2]) * Math.sin(tilt[0])];
    s.cone(w, w * 2.2, 0x56e8d0, { at: tip, rot: tilt, seg: 6 });
  }
  s.rock(0.12, 0x5a5f63, seed, { at: [0, 0.02, 0], scale: [1.3, 0.5, 1.3] });
  return s;
}

/** Ground props by kind and variant (the same choice of tiles as the classic view). */
export function propShape(kind: string, variant: number): Shape {
  const s = shape();
  if (kind === 'pebbles') {
    s.rock(0.16, 0x7a8079, variant * 3 + 1, { at: [0, 0.06, 0], scale: [1.2, 0.9, 1] });
    s.rock(0.1, 0x666b66, variant * 3 + 2, { at: [0.18, 0.03, 0.1] });
    s.rock(0.07, 0x7f857e, variant * 3 + 3, { at: [-0.12, 0.02, 0.16] });
  } else if (kind === 'sprout') {
    // Alien flora: a curved stalk with a glowing bulb and fronds.
    s.cyl(0.025, 0.4 + variant * 0.06, 0x4a3a68, { at: [0, 0.2 + variant * 0.03, 0], r2: 0.04, seg: 6 });
    s.ball(0.11, 0x8a56b8, { at: [0, 0.44 + variant * 0.06, 0], scale: [1, 0.75, 1], seg: 10 });
    s.ball(0.07, GREEN, { at: [0, 0.4 + variant * 0.06, 0], seg: 8, glow: true });
    for (let i = 0; i < 4; i++) s.cone(0.03, 0.22, 0x5c3f7a, { at: [Math.cos(i * 1.6) * 0.07, 0.08, Math.sin(i * 1.6) * 0.07], rot: [Math.sin(i * 1.6) * 0.8, 0, -Math.cos(i * 1.6) * 0.8], seg: 4 });
  } else {
    // Rock spire.
    s.rock(0.18, 0x8b8577, variant * 5 + 11, { at: [0, 0.32, 0], scale: [0.8, 2.4, 0.8], rough: 0.3 });
    s.rock(0.12, 0x77725f, variant * 5 + 12, { at: [0.14, 0.06, 0.06] });
  }
  return s;
}

/** A grass tuft: a few tapered blades. */
export function grassShape(variant: number, color: number): Shape {
  const s = shape();
  for (let i = 0; i < 5; i++) {
    const a = hash3(variant, i, 9) * Math.PI * 2;
    const h = 0.06 + hash3(variant, i, 10) * 0.06;
    s.cone(0.012, h, color, { at: [Math.cos(a) * 0.035, h / 2, Math.sin(a) * 0.035], rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], seg: 3 });
  }
  return s;
}

export const BUILDING_RIGS: Readonly<Record<string, () => RigDef>> = {
  hum_hq: humHq,
  hum_reactor: humReactor,
  hum_refinery: humRefinery,
  hum_barracks: humBarracks,
  hum_factory: humFactory,
  hum_turret: humTurret,
  hum_lab: humLab,
  hum_lance: humLance,
  ali_hq: aliHq,
  ali_generator: aliGenerator,
  ali_extractor: aliExtractor,
  ali_nest: aliNest,
  ali_pit: aliPit,
  ali_spire: aliSpire,
  ali_evolver: aliEvolver,
  ali_rift: aliRift,
};
