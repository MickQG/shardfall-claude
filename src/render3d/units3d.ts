import { Shape } from './kit';
import type { RigDef, RigNode } from './rig';

/**
 * Procedural unit models (R3D-3) with their moving parts (R3D-10) and muzzle points (R3D-9). Original designs:
 * the Aegis Union fields painted steel war machines with team-coloured armour panels; the Vrax Hive grows chitin
 * creatures with team-coloured carapace and glowing bioluminescence.
 */

// Aegis Union palette.
const STEEL = 0x8b938d;
const STEEL2 = 0x646c68;
const GUN = 0x3b4248;
const DARK = 0x202428;
const TREAD = 0x2b2b2d;
const RUBBER = 0x1a1a1c;
const OLIVE = 0x5c6a4e;
const HAZARD = 0xe0aa2c;
const GLASS = 0x22384a;
const SKIN = 0xb98a6a;
const CYAN = 0x6fe2ff;
const AMBER = 0xffb347;
const RED = 0xff4a3a;
// Vrax Hive palette.
const CHITIN = 0x4b2b45;
const CHITIN2 = 0x6e4062;
const BELLY = 0x2c1a28;
const BONE = 0xd9ccb2;
const FLESH = 0x8c4460;
const MEMBRANE = 0x7d6a96;
const SAC = 0x7fb23a;
const GREEN = 0x9dff3c;
const ACID = 0xc8ff4a;

const shape = (): Shape => new Shape();

// ---------------------------------------------------------------- Aegis infantry

/** A rifleman or rocketeer figure: helmet, armoured vest, pack and arms; legs are separate gait nodes. */
function soldier(s: Shape, rocket: boolean): Shape {
  s.box(0.07, 0.045, 0.095, OLIVE, { at: [0, 0.01, 0] }); // hips
  s.box(0.08, 0.1, 0.105, STEEL, { at: [0, 0.075, 0], bevel: 0.3 }); // vest
  s.box(0.06, 0.03, 0.11, 'team', { at: [0.01, 0.06, 0], bevel: 0.3 }); // chest band
  s.ball(0.03, 'team', { at: [0, 0.115, 0.058], scale: [1, 0.8, 1], seg: 8 }); // pauldrons
  s.ball(0.03, 'team', { at: [0, 0.115, -0.058], scale: [1, 0.8, 1], seg: 8 });
  s.box(0.05, 0.085, 0.08, STEEL2, { at: [-0.06, 0.08, 0] }); // pack
  s.box(0.02, 0.03, 0.03, AMBER, { at: [-0.087, 0.1, 0.02], glow: true, bevel: 0 }); // pack lamp
  s.ball(0.03, SKIN, { at: [0.005, 0.15, 0], seg: 8 }); // head
  s.ball(0.04, STEEL2, { at: [0, 0.158, 0], cut: 0.55, seg: 10 }); // helmet
  s.box(0.014, 0.014, 0.05, CYAN, { at: [0.032, 0.15, 0], glow: true, bevel: 0 }); // visor
  // Arms forward, holding the weapon.
  s.box(0.08, 0.026, 0.026, OLIVE, { at: [0.035, 0.085, 0.058], rot: [0, 0.25, -0.35] });
  s.box(0.08, 0.026, 0.026, OLIVE, { at: [0.035, 0.085, -0.058], rot: [0, -0.35, -0.35] });
  if (rocket) {
    s.tube(0.024, 0.24, STEEL2, { at: [0.02, 0.135, 0.06], seg: 10 }); // launcher on the shoulder
    s.tube(0.026, 0.03, 'team', { at: [-0.04, 0.135, 0.06], seg: 10 });
    s.tube(0.019, 0.01, DARK, { at: [0.145, 0.135, 0.06], seg: 10 });
    s.box(0.04, 0.03, 0.02, GUN, { at: [0.04, 0.1, 0.06] }); // grip and sight
    s.cone(0.012, 0.04, RED, { at: [-0.06, 0.16, -0.02], seg: 6, glow: true }); // spare rocket tips
    s.cone(0.012, 0.04, RED, { at: [-0.06, 0.16, 0.0], seg: 6, glow: true });
  } else {
    s.box(0.13, 0.026, 0.02, GUN, { at: [0.09, 0.075, 0.025], bevel: 0.2 }); // rifle body
    s.tube(0.006, 0.07, DARK, { at: [0.19, 0.08, 0.025] });
    s.box(0.02, 0.04, 0.014, GUN, { at: [0.08, 0.05, 0.025], rot: [0, 0, 0.2] }); // magazine
    s.box(0.03, 0.01, 0.012, CYAN, { at: [0.08, 0.093, 0.025], glow: true, bevel: 0 }); // sight
  }
  return s;
}

function soldierLeg(): Shape {
  const s = shape();
  s.box(0.042, 0.095, 0.046, OLIVE, { at: [0, -0.045, 0], bevel: 0.3 }); // thigh, from the hip down
  s.box(0.04, 0.08, 0.042, OLIVE, { at: [0.006, -0.125, 0], bevel: 0.3 }); // shin
  s.box(0.045, 0.03, 0.044, STEEL2, { at: [0.012, -0.11, 0] }); // knee pad
  s.box(0.065, 0.028, 0.046, DARK, { at: [0.016, -0.168, 0] }); // boot
  return s;
}

function infantry(rocket: boolean): RigDef {
  return {
    shapes: { body: () => soldier(shape(), rocket), leg: soldierLeg },
    move: 'walker',
    scale: 1.35,
    stride: 0.32,
    turn: 9,
    radius: 0.5,
    height: 0.36,
    weapon: rocket ? 'rocket' : 'rifle',
    root: {
      kids: [
        // Firing crouch: the hips sink and the legs brace, one forward and one back, feet on the ground.
        { geo: 'leg', at: [0, 0.182, 0.026], anim: { k: 'gait', axis: 'z', amp: 0.55, phase: 0, kneel: 0.85, drop: 0.07 } },
        { geo: 'leg', at: [0, 0.182, -0.026], anim: { k: 'gait', axis: 'z', amp: 0.55, phase: Math.PI, kneel: -0.85, drop: 0.07 } },
        { geo: 'body', at: [0, 0.18, 0], anim: { k: 'body', drop: 0.07 }, kids: [{ muzzle: true, at: rocket ? [0.16, 0.135, 0.06] : [0.23, 0.08, 0.025] }] },
      ],
    },
  };
}

// ---------------------------------------------------------------- Aegis vehicles

/** Tracks with grousers; road wheels are separate spinning nodes. */
function trackShape(len: number, h: number, w: number): Shape {
  const s = shape();
  s.box(len, h, w, TREAD, { bevel: 0.45 });
  const n = Math.round(len / 0.06);
  for (let i = 0; i < n; i++) s.box(0.022, 0.012, w + 0.004, RUBBER, { at: [-len / 2 + (i + 0.5) * (len / n), h / 2, 0], bevel: 0 });
  return s;
}

function roadWheel(r: number, w: number): Shape {
  const s = shape();
  s.cyl(r, w, GUN, { rot: [Math.PI / 2, 0, 0], seg: 12 });
  s.cyl(r * 0.45, w + 0.01, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 6 });
  return s;
}

function tire(r: number, w: number, rim: number): Shape {
  const s = shape();
  s.cyl(r, w, RUBBER, { rot: [Math.PI / 2, 0, 0], seg: 14 });
  s.cyl(r * 0.62, w + 0.012, rim, { rot: [Math.PI / 2, 0, 0], seg: 8 });
  s.cyl(r * 0.2, w + 0.02, DARK, { rot: [Math.PI / 2, 0, 0], seg: 6 });
  // Tread blocks so the spin reads.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.box(0.03, 0.022, w + 0.006, RUBBER, { at: [Math.cos(a) * r, Math.sin(a) * r, 0], rot: [0, 0, a], bevel: 0 });
  }
  return s;
}

/** Running gear on both sides: tracks plus road wheels (spinning). */
function runningGear(len: number, z: number, wheelR: number, count: number, y: number): RigNode[] {
  const nodes: RigNode[] = [
    { geo: 'track', at: [0, y, z] },
    { geo: 'track', at: [0, y, -z] },
  ];
  for (let i = 0; i < count; i++) {
    const x = -len / 2 + wheelR + 0.02 + (i * (len - wheelR * 2 - 0.04)) / (count - 1);
    for (const side of [1, -1]) nodes.push({ geo: 'roadwheel', at: [x, y - 0.01, side * (z + 0.07)], anim: { k: 'wheel', r: wheelR } });
  }
  return nodes;
}

function tank(): RigDef {
  return {
    move: 'tracked',
    turn: 6,
    radius: 0.72,
    height: 0.52,
    weapon: 'cannon',
    shapes: {
      track: () => trackShape(1.16, 0.15, 0.17),
      roadwheel: () => roadWheel(0.062, 0.04),
      hull: () => {
        const s = shape();
        s.slab([[-0.56, 0.09], [0.48, 0.09], [0.62, 0.17], [0.42, 0.28], [-0.5, 0.29], [-0.58, 0.21]], 0.6, STEEL, { bevel: 0.025 });
        // Side skirts in team colour, hazard chevrons up front.
        for (const z of [0.36, -0.36]) {
          s.slab([[-0.56, 0.12], [0.5, 0.12], [0.56, 0.21], [-0.54, 0.25]], 0.035, 'team', { at: [0, 0, z], bevel: 0.01 });
          s.box(0.08, 0.02, 0.04, HAZARD, { at: [0.5, 0.2, z], bevel: 0 });
        }
        s.box(0.3, 0.025, 0.42, DARK, { at: [-0.34, 0.295, 0], bevel: 0.2 }); // engine grille
        for (let i = 0; i < 4; i++) s.box(0.012, 0.012, 0.38, GUN, { at: [-0.45 + i * 0.075, 0.31, 0], bevel: 0 });
        s.tube(0.022, 0.08, GUN, { at: [-0.58, 0.25, 0.18] }); // exhausts
        s.tube(0.022, 0.08, GUN, { at: [-0.58, 0.25, -0.18] });
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.56, 0.2, 0.2], glow: true, bevel: 0 }); // headlights
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.56, 0.2, -0.2], glow: true, bevel: 0 });
        s.box(0.08, 0.05, 0.08, STEEL2, { at: [0.3, 0.3, -0.2] }); // driver hatch
        s.box(0.1, 0.06, 0.14, STEEL2, { at: [-0.5, 0.31, 0.18] }); // stowage
        return s;
      },
      turret: () => {
        const s = shape();
        s.hull([[0.26, -0.13], [0.3, 0], [0.26, 0.13], [-0.16, 0.21], [-0.3, 0.14], [-0.3, -0.14], [-0.16, -0.21]], 0.15, STEEL, { bevel: 0.025 });
        s.hull([[0.18, -0.09], [0.21, 0], [0.18, 0.09], [-0.12, 0.15], [-0.24, 0.1], [-0.24, -0.1], [-0.12, -0.15]], 0.025, 'team', { at: [0, 0.15, 0], bevel: 0.008 });
        s.cyl(0.055, 0.05, STEEL2, { at: [-0.1, 0.19, 0.09], seg: 10 }); // cupola
        s.box(0.03, 0.012, 0.05, CYAN, { at: [-0.06, 0.205, 0.09], glow: true, bevel: 0 }); // cupola vision block
        s.box(0.06, 0.05, 0.05, GUN, { at: [0.1, 0.18, -0.12] }); // gunner sight
        s.box(0.012, 0.03, 0.035, CYAN, { at: [0.133, 0.18, -0.12], glow: true, bevel: 0 });
        s.cyl(0.006, 0.34, DARK, { at: [-0.24, 0.32, -0.12], seg: 4 }); // antenna
        s.box(0.12, 0.08, 0.3, STEEL2, { at: [-0.34, 0.08, 0] }); // bustle rack
        for (const z of [0.17, -0.17]) for (const k of [0, 1]) s.tube(0.016, 0.06, GUN, { at: [0.12 + k * 0.01, 0.12 + k * 0.03, z], rot: [0, z > 0 ? -0.5 : 0.5, 0.4] }); // smoke dischargers
        return s;
      },
      barrel: () => {
        const s = shape();
        s.box(0.1, 0.09, 0.13, STEEL2, { at: [0.02, 0, 0] }); // mantlet
        s.tube(0.028, 0.5, GUN, { at: [0.3, 0, 0], r2: 0.032, seg: 10 });
        s.tube(0.04, 0.09, GUN, { at: [0.3, 0, 0], seg: 10 }); // fume extractor
        s.box(0.07, 0.055, 0.075, DARK, { at: [0.57, 0, 0], bevel: 0.2 }); // muzzle brake
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          kids: [
            ...runningGear(1.16, 0.29, 0.062, 5, 0.085),
            { geo: 'hull' },
            {
              anim: { k: 'turret' },
              at: [-0.04, 0.29, 0],
              geo: 'turret',
              kids: [{ geo: 'barrel', at: [0.28, 0.07, 0], anim: { k: 'barrel', recoil: 0.1 }, kids: [{ muzzle: true, at: [0.62, 0, 0] }] }],
            },
          ],
        },
      ],
    },
  };
}

function artillery(): RigDef {
  return {
    move: 'tracked',
    turn: 5,
    radius: 0.74,
    height: 0.6,
    weapon: 'howitzer',
    shapes: {
      track: () => trackShape(1.26, 0.14, 0.16),
      roadwheel: () => roadWheel(0.058, 0.04),
      hull: () => {
        const s = shape();
        s.slab([[-0.62, 0.08], [0.5, 0.08], [0.64, 0.15], [0.52, 0.24], [-0.6, 0.25]], 0.58, STEEL, { bevel: 0.022 });
        for (const z of [0.34, -0.34]) s.slab([[-0.6, 0.12], [0.52, 0.12], [0.58, 0.2], [-0.6, 0.22]], 0.03, 'team', { at: [0, 0, z], bevel: 0.01 });
        s.box(0.16, 0.1, 0.4, STEEL2, { at: [0.42, 0.29, 0] }); // cab
        s.box(0.012, 0.04, 0.32, CYAN, { at: [0.505, 0.3, 0], glow: true, bevel: 0 }); // cab visor
        s.box(0.22, 0.05, 0.5, DARK, { at: [-0.66, 0.12, 0], rot: [0, 0, 0.5] }); // recoil spade
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.6, 0.18, 0.18], glow: true, bevel: 0 });
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.6, 0.18, -0.18], glow: true, bevel: 0 });
        return s;
      },
      turret: () => {
        const s = shape();
        s.hull([[0.22, -0.2], [0.26, 0], [0.22, 0.2], [-0.3, 0.22], [-0.34, 0], [-0.3, -0.22]], 0.22, STEEL, { bevel: 0.025 });
        s.box(0.42, 0.025, 0.3, 'team', { at: [-0.04, 0.23, 0], bevel: 0.3 });
        s.box(0.12, 0.06, 0.08, GUN, { at: [-0.16, 0.26, 0.12] }); // ammo hatch
        s.cyl(0.006, 0.3, DARK, { at: [-0.26, 0.38, -0.15], seg: 4 });
        s.box(0.012, 0.03, 0.05, AMBER, { at: [-0.345, 0.15, 0.12], glow: true, bevel: 0 });
        return s;
      },
      barrel: () => {
        const s = shape();
        s.box(0.14, 0.13, 0.16, STEEL2, { at: [0.02, 0, 0] });
        s.tube(0.034, 0.74, GUN, { at: [0.42, 0, 0], r2: 0.04, seg: 10 });
        s.tube(0.022, 0.5, STEEL2, { at: [0.3, -0.05, 0], seg: 6 }); // recoil cylinder
        s.box(0.09, 0.07, 0.09, DARK, { at: [0.8, 0, 0], bevel: 0.2 });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          kids: [
            ...runningGear(1.26, 0.28, 0.058, 6, 0.08),
            { geo: 'hull' },
            {
              anim: { k: 'turret' },
              at: [-0.14, 0.25, 0],
              geo: 'turret',
              kids: [{ geo: 'barrel', at: [0.22, 0.13, 0], rot: [0, 0, 0.42], anim: { k: 'barrel', recoil: 0.16 }, kids: [{ muzzle: true, at: [0.86, 0, 0] }] }],
            },
          ],
        },
      ],
    },
  };
}

function buggy(): RigDef {
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, 0.11, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: 0.11 } }] } : { geo: 'wheel', at: [x, 0.11, z], anim: { k: 'wheel', r: 0.11 } };
  return {
    move: 'wheeled',
    turn: 7.5,
    radius: 0.6,
    height: 0.42,
    weapon: 'mg',
    shapes: {
      wheel: () => tire(0.11, 0.08, STEEL2),
      body: () => {
        const s = shape();
        s.slab([[-0.42, 0.1], [0.38, 0.1], [0.5, 0.16], [0.36, 0.22], [-0.4, 0.22]], 0.36, 'team', { bevel: 0.02 });
        s.box(0.7, 0.04, 0.42, GUN, { at: [0, 0.11, 0], bevel: 0.2 }); // floor pan
        for (const z of [0.18, -0.18]) {
          s.box(0.18, 0.03, 0.12, STEEL2, { at: [0.3, 0.22, z * 1.25], bevel: 0.3 }); // fenders
          s.box(0.18, 0.03, 0.12, STEEL2, { at: [-0.3, 0.22, z * 1.25], bevel: 0.3 });
        }
        // Roll cage.
        for (const z of [0.15, -0.15]) {
          s.tube(0.012, 0.36, DARK, { at: [0.02, 0.36, z], seg: 6 });
          s.cyl(0.012, 0.16, DARK, { at: [0.2, 0.3, z], rot: [0, 0, 0.6], seg: 6 });
          s.cyl(0.012, 0.16, DARK, { at: [-0.16, 0.3, z], seg: 6 });
        }
        s.cyl(0.012, 0.3, DARK, { at: [0.02, 0.36, 0], rot: [Math.PI / 2, 0, 0], seg: 6 });
        s.box(0.08, 0.1, 0.1, OLIVE, { at: [0.05, 0.27, 0.07] }); // driver
        s.ball(0.04, STEEL2, { at: [0.06, 0.34, 0.07], cut: 0.6, seg: 8 });
        s.box(0.012, 0.012, 0.04, CYAN, { at: [0.098, 0.335, 0.07], glow: true, bevel: 0 });
        s.box(0.015, 0.03, 0.06, AMBER, { at: [0.5, 0.17, 0.12], glow: true, bevel: 0 });
        s.box(0.015, 0.03, 0.06, AMBER, { at: [0.5, 0.17, -0.12], glow: true, bevel: 0 });
        s.box(0.015, 0.02, 0.05, RED, { at: [-0.42, 0.18, 0.13], glow: true, bevel: 0 });
        s.box(0.015, 0.02, 0.05, RED, { at: [-0.42, 0.18, -0.13], glow: true, bevel: 0 });
        s.cyl(0.04, 0.1, STEEL2, { at: [-0.22, 0.27, 0], seg: 8 }); // gun ring
        return s;
      },
      turret: () => {
        const s = shape();
        s.box(0.12, 0.07, 0.12, GUN, { at: [0, 0.03, 0] });
        s.box(0.03, 0.09, 0.14, STEEL2, { at: [0.07, 0.05, 0], bevel: 0.3 }); // gun shield
        return s;
      },
      barrel: () => {
        const s = shape();
        s.tube(0.009, 0.2, DARK, { at: [0.1, 0, 0.022] });
        s.tube(0.009, 0.2, DARK, { at: [0.1, 0, -0.022] });
        s.box(0.06, 0.04, 0.07, GUN, { at: [0, 0, 0] });
        return s;
      },
    },
    root: {
      kids: [
        wheel(0.3, 0.24, true),
        wheel(0.3, -0.24, true),
        wheel(-0.3, 0.24, false),
        wheel(-0.3, -0.24, false),
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            {
              anim: { k: 'turret' },
              geo: 'turret',
              at: [-0.22, 0.32, 0],
              kids: [{ geo: 'barrel', at: [0.06, 0.05, 0], anim: { k: 'barrel', recoil: 0.025 }, kids: [{ muzzle: true, at: [0.21, 0, 0.022] }, { muzzle: true, at: [0.21, 0, -0.022] }] }],
            },
          ],
        },
      ],
    },
  };
}

function hauler(): RigDef {
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, 0.12, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: 0.12 } }] } : { geo: 'wheel', at: [x, 0.12, z], anim: { k: 'wheel', r: 0.12 } };
  return {
    move: 'wheeled',
    turn: 5,
    radius: 0.8,
    height: 0.62,
    shapes: {
      wheel: () => tire(0.12, 0.1, HAZARD),
      body: () => {
        const s = shape();
        s.box(1.36, 0.08, 0.5, GUN, { at: [0, 0.15, 0], bevel: 0.2 }); // frame
        s.slab([[0.36, 0.18], [0.66, 0.18], [0.7, 0.3], [0.6, 0.46], [0.36, 0.48]], 0.56, 'team', { bevel: 0.02 }); // cab
        s.slab([[0.58, 0.32], [0.66, 0.32], [0.6, 0.44], [0.55, 0.44]], 0.48, GLASS, { at: [0.012, 0, 0], bevel: 0.005 }); // windscreen
        s.box(0.06, 0.03, 0.1, AMBER, { at: [0.5, 0.5, 0], glow: true, bevel: 0.3 }); // beacon
        s.box(0.02, 0.04, 0.08, AMBER, { at: [0.7, 0.22, 0.18], glow: true, bevel: 0 });
        s.box(0.02, 0.04, 0.08, AMBER, { at: [0.7, 0.22, -0.18], glow: true, bevel: 0 });
        s.cyl(0.025, 0.3, GUN, { at: [0.33, 0.42, 0.22], seg: 8 }); // exhaust stack
        // Ore hopper: sloped steel bin with team bands and hazard stripes.
        s.slab([[-0.66, 0.2], [0.3, 0.2], [0.34, 0.52], [-0.7, 0.52]], 0.6, STEEL, { bevel: 0.025 });
        s.box(1.0, 0.04, 0.62, 'team', { at: [-0.18, 0.5, 0], bevel: 0.25 });
        for (let i = 0; i < 5; i++) s.box(0.06, 0.02, 0.625, i % 2 ? DARK : HAZARD, { at: [-0.6 + i * 0.07, 0.26, 0], bevel: 0 });
        s.box(0.9, 0.02, 0.5, DARK, { at: [-0.18, 0.525, 0], bevel: 0 }); // hopper mouth
        s.box(0.12, 0.08, 0.3, STEEL2, { at: [-0.72, 0.22, 0] }); // tail gate
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.785, 0.24, 0.12], glow: true, bevel: 0 });
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.785, 0.24, -0.12], glow: true, bevel: 0 });
        return s;
      },
      cargo: () => {
        const s = shape();
        for (let i = 0; i < 6; i++) {
          const x = -0.55 + (i % 3) * 0.3;
          const z = i < 3 ? 0.12 : -0.12;
          s.cyl(0.035, 0.14, 0x47e8c4, { at: [x, 0.56, z], rot: [0.3 * (i % 2 ? 1 : -1), 0, 0.2 * ((i % 3) - 1)], seg: 6 });
          s.cone(0.035, 0.06, CYAN, { at: [x, 0.66, z], rot: [0.3 * (i % 2 ? 1 : -1), 0, 0.2 * ((i % 3) - 1)], seg: 6, glow: true });
        }
        return s;
      },
    },
    root: {
      kids: [
        wheel(0.48, 0.28, true),
        wheel(0.48, -0.28, true),
        wheel(-0.3, 0.28, false),
        wheel(-0.3, -0.28, false),
        wheel(-0.56, 0.28, false),
        wheel(-0.56, -0.28, false),
        { anim: { k: 'body' }, geo: 'body', kids: [{ geo: 'cargo', anim: { k: 'cargo' } }] },
      ],
    },
  };
}

function gunship(): RigDef {
  return {
    move: 'air',
    turn: 4.5,
    radius: 0.7,
    height: 0.45,
    weapon: 'chaingun',
    shapes: {
      body: () => {
        const s = shape();
        s.ball(0.2, STEEL, { at: [0.12, 0, 0], scale: [2.1, 0.85, 0.95], seg: 14 }); // fuselage
        s.ball(0.15, 'team', { at: [0.08, 0.06, 0], scale: [2.2, 0.7, 1.05], seg: 12, cut: 0.5 }); // dorsal armour
        s.ball(0.11, GLASS, { at: [0.36, 0.05, 0], scale: [1.4, 0.75, 0.85], seg: 12 }); // canopy
        s.box(0.04, 0.012, 0.1, CYAN, { at: [0.42, 0.1, 0], glow: true, bevel: 0 }); // HUD glow
        s.tube(0.06, 0.6, STEEL2, { at: [-0.45, 0.03, 0], r2: 0.11, seg: 10 }); // tail boom
        s.slab([[-0.84, 0.0], [-0.7, 0.0], [-0.74, 0.22], [-0.84, 0.24]], 0.02, 'team', { at: [0, 0.03, 0], bevel: 0.006 }); // fin
        s.box(0.1, 0.012, 0.36, STEEL2, { at: [-0.74, 0.04, 0], bevel: 0.2 }); // tailplane
        s.box(0.16, 0.025, 0.72, STEEL2, { at: [0.0, -0.02, 0], bevel: 0.3 }); // stub wings
        for (const z of [0.3, -0.3]) {
          s.tube(0.045, 0.26, GUN, { at: [0.0, -0.06, z], seg: 10 }); // engine pods
          s.cyl(0.032, 0.012, AMBER, { at: [-0.135, -0.06, z], rot: [0, 0, Math.PI / 2], seg: 10, glow: true }); // exhaust glow
          s.tube(0.022, 0.18, DARK, { at: [0.04, -0.11, z * 0.8], seg: 6 }); // rocket pods
          s.box(0.015, 0.012, 0.012, RED, { at: [0.08, -0.02, z * 1.2], glow: true, bevel: 0 }); // nav lights
        }
        // Skids.
        for (const z of [0.12, -0.12]) {
          s.tube(0.01, 0.5, DARK, { at: [0.1, -0.2, z], seg: 6 });
          s.cyl(0.008, 0.08, DARK, { at: [0.25, -0.16, z], seg: 4 });
          s.cyl(0.008, 0.08, DARK, { at: [-0.05, -0.16, z], seg: 4 });
        }
        s.cyl(0.04, 0.08, GUN, { at: [0.1, 0.17, 0], seg: 10 }); // rotor mast
        return s;
      },
      rotor: () => {
        const s = shape();
        s.cyl(0.05, 0.03, STEEL2, { seg: 10 });
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          s.box(0.6, 0.008, 0.05, DARK, { at: [Math.cos(a) * 0.31, 0.01, Math.sin(a) * 0.31], rot: [0.06, -a, 0], bevel: 0 });
          s.box(0.04, 0.009, 0.051, HAZARD, { at: [Math.cos(a) * 0.59, 0.011, Math.sin(a) * 0.59], rot: [0, -a, 0], bevel: 0 });
        }
        return s;
      },
      tailrotor: () => {
        const s = shape();
        for (let i = 0; i < 3; i++) s.box(0.012, 0.16, 0.006, DARK, { rot: [0, 0, (i * Math.PI * 2) / 3], at: [0, 0, 0], bevel: 0 });
        return s;
      },
      turret: () => {
        const s = shape();
        s.ball(0.05, GUN, { seg: 10 });
        s.box(0.012, 0.02, 0.03, RED, { at: [0.045, 0.01, 0], glow: true, bevel: 0 });
        return s;
      },
      barrel: () => {
        const s = shape();
        for (const z of [0.018, -0.018]) s.tube(0.008, 0.16, DARK, { at: [0.1, 0, z], seg: 6 });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            { geo: 'rotor', at: [0.1, 0.22, 0], anim: { k: 'spin', axis: 'y', rate: 26 } },
            { geo: 'tailrotor', at: [-0.82, 0.12, 0.025], anim: { k: 'spin', axis: 'z', rate: 40 } },
            {
              geo: 'turret',
              at: [0.42, -0.1, 0],
              anim: { k: 'turret' },
              kids: [{ geo: 'barrel', anim: { k: 'barrel', recoil: 0.015 }, kids: [{ muzzle: true, at: [0.19, 0, 0.018] }, { muzzle: true, at: [0.19, 0, -0.018] }] }],
            },
          ],
        },
      ],
    },
  };
}

// ---------------------------------------------------------------- Vrax creatures

/**
 * An insect leg from the hip out to one side (`side` +1 right, -1 left): the femur rises to a high knee, the tibia
 * drops to a bone tip on the ground `drop` below the hip and `reach` out.
 */
function insectLeg(side: number, reach: number, drop: number, rise: number, thick: number, color: number): Shape {
  const s = shape();
  const knee = [0, rise, side * reach * 0.48] as const;
  const shin = [0, -drop * 0.72, side * reach * 0.9] as const;
  const foot = [0, -drop, side * reach] as const;
  s.ball(thick * 1.1, color, { seg: 6 });
  s.strut([0, 0, 0], knee, thick, color, { r2: thick * 0.85 });
  s.ball(thick * 0.95, color, { at: knee, seg: 6 });
  s.strut(knee, shin, thick * 0.85, color, { r2: thick * 0.6 });
  s.strut(shin, foot, thick * 0.6, BONE, { r2: thick * 0.15 });
  return s;
}

/** A bird-like hind leg hanging from the hip, `len` down to the ground: thigh forward, shin back, foot with claws. */
function digitigrade(len: number, thick: number, color: number): Shape {
  const s = shape();
  const knee = [len * 0.12, -len * 0.42, 0] as const;
  const hock = [-len * 0.12, -len * 0.78, 0] as const;
  const foot = [len * 0.02, -len * 0.97, 0] as const;
  s.ball(thick * 1.5, color, { scale: [1.2, 1.3, 1], seg: 8 });
  s.strut([0, 0, 0], knee, thick * 1.35, color, { r2: thick });
  s.ball(thick, color, { at: knee, seg: 6 });
  s.strut(knee, hock, thick, color, { r2: thick * 0.75 });
  s.strut(hock, foot, thick * 0.75, color, { r2: thick * 0.6 });
  for (const z of [-thick * 0.8, 0, thick * 0.8]) s.strut(foot, [foot[0] + len * 0.16, -len, z], thick * 0.4, BONE, { r2: thick * 0.1 });
  return s;
}

/** Six insect legs in a tripod gait (alternate legs share a phase). */
function sixLegs(xs: readonly number[], y: number, z: number, amp: number, lift: number): RigNode[] {
  const out: RigNode[] = [];
  xs.forEach((x, i) => {
    out.push({ geo: 'legR', at: [x, y, z], anim: { k: 'gait', axis: 'y', amp, phase: i % 2 ? Math.PI : 0, lift } });
    out.push({ geo: 'legL', at: [x, y, -z], anim: { k: 'gait', axis: 'y', amp: -amp, phase: i % 2 ? 0 : Math.PI, lift } });
  });
  return out;
}

function skitterer(): RigDef {
  return {
    move: 'walker',
    organic: true,
    scale: 1.35,
    stride: 0.26,
    turn: 10,
    radius: 0.52,
    height: 0.24,
    weapon: 'claw',
    shapes: {
      legR: () => insectLeg(1, 0.13, 0.11, 0.05, 0.012, CHITIN),
      legL: () => insectLeg(-1, 0.13, 0.11, 0.05, 0.012, CHITIN),
      body: () => {
        const s = shape();
        s.ball(0.085, CHITIN, { at: [-0.1, 0.0, 0], scale: [1.4, 0.75, 1], seg: 10 }); // abdomen
        s.ball(0.088, 'teamDark', { at: [-0.1, 0.012, 0], scale: [1.38, 0.72, 0.9], seg: 10, cut: 0.45 }); // carapace
        s.ball(0.022, 'team', { at: [-0.13, 0.072, 0], scale: [2.2, 0.5, 1], seg: 8 }); // team blaze
        for (let i = 0; i < 3; i++) s.box(0.012, 0.012, 0.13, BELLY, { at: [-0.16 + i * 0.05, 0.05, 0], rot: [0, 0, 0.3], bevel: 0 }); // segments
        s.ball(0.06, CHITIN2, { at: [0.02, 0.01, 0], seg: 10 }); // thorax
        s.ball(0.045, CHITIN, { at: [0.09, 0.0, 0], scale: [1.2, 0.85, 1], seg: 8 }); // head
        s.ball(0.012, GREEN, { at: [0.12, 0.022, 0.025], seg: 6, glow: true });
        s.ball(0.012, GREEN, { at: [0.12, 0.022, -0.025], seg: 6, glow: true });
        for (const z of [0.022, -0.022]) s.cone(0.012, 0.07, BONE, { at: [0.15, -0.01, z], rot: [0, 0, -Math.PI / 2 - 0.2], seg: 5 }); // mandibles
        for (const z of [0.05, -0.05]) s.cone(0.014, 0.12, BONE, { at: [0.08, 0.05, z], rot: [z > 0 ? 0.4 : -0.4, 0, -1.1], seg: 5 }); // claws
        return s;
      },
    },
    root: { kids: [{ anim: { k: 'body' }, geo: 'body', at: [0, 0.12, 0], kids: [...sixLegs([0.05, -0.02, -0.09], -0.01, 0.04, 0.35, 0.03), { muzzle: true, at: [0.18, 0, 0] }] }] },
  };
}

function spitter(): RigDef {
  return {
    move: 'walker',
    organic: true,
    scale: 1.3,
    stride: 0.3,
    turn: 9,
    radius: 0.52,
    height: 0.4,
    weapon: 'acid',
    shapes: {
      leg: () => digitigrade(0.2, 0.026, CHITIN),
      body: () => {
        const s = shape();
        s.ball(0.07, CHITIN, { at: [0, 0.04, 0], scale: [1.3, 1, 1], seg: 10 }); // torso
        s.ball(0.072, 'team', { at: [-0.01, 0.05, 0], scale: [1.25, 0.95, 0.85], seg: 10, cut: 0.42 }); // back plate
        s.ball(0.065, SAC, { at: [-0.06, 0.12, 0], scale: [1, 1.15, 1], seg: 10 }); // acid sac
        s.ring(0.058, 0.008, ACID, { at: [-0.06, 0.14, 0], seg: 12, glow: true });
        s.ring(0.045, 0.007, ACID, { at: [-0.06, 0.18, 0], seg: 12, glow: true });
        s.ring(0.05, 0.01, CHITIN2, { at: [-0.06, 0.1, 0], seg: 10 });
        s.cyl(0.025, 0.08, CHITIN2, { at: [0.07, 0.1, 0], rot: [0, 0, -0.8], seg: 8 }); // neck
        s.ball(0.04, CHITIN, { at: [0.12, 0.13, 0], scale: [1.4, 0.8, 0.9], seg: 8 }); // head
        s.cone(0.018, 0.05, BONE, { at: [0.16, 0.115, 0], rot: [0, 0, -Math.PI / 2], seg: 5 }); // spout
        s.ball(0.01, GREEN, { at: [0.14, 0.145, 0.02], seg: 6, glow: true });
        s.ball(0.01, GREEN, { at: [0.14, 0.145, -0.02], seg: 6, glow: true });
        for (const z of [0.055, -0.055]) s.cone(0.012, 0.08, BONE, { at: [0.06, 0.02, z], rot: [0, 0, -2.2], seg: 5 }); // forearm hooks
        return s;
      },
    },
    root: {
      kids: [
        { geo: 'leg', at: [-0.01, 0.2, 0.04], anim: { k: 'gait', axis: 'z', amp: 0.5, phase: 0 } },
        { geo: 'leg', at: [-0.01, 0.2, -0.04], anim: { k: 'gait', axis: 'z', amp: 0.5, phase: Math.PI } },
        { anim: { k: 'body' }, geo: 'body', at: [0, 0.2, 0], kids: [{ muzzle: true, at: [0.19, 0.115, 0] }] },
      ],
    },
  };
}

function stalker(): RigDef {
  return {
    move: 'walker',
    organic: true,
    stride: 0.9,
    turn: 7,
    radius: 0.62,
    height: 0.46,
    weapon: 'claw',
    shapes: {
      leg: () => digitigrade(0.3, 0.035, CHITIN),
      body: () => {
        const s = shape();
        s.ball(0.2, CHITIN, { at: [0, 0, 0], scale: [1.8, 0.55, 0.65], seg: 14 }); // torso
        s.ball(0.2, 'team', { at: [0, 0.015, 0], scale: [1.7, 0.52, 0.5], seg: 12, cut: 0.42 }); // back stripe
        for (let i = 0; i < 5; i++) s.cone(0.02, 0.09 - i * 0.008, BONE, { at: [0.18 - i * 0.1, 0.11, 0], rot: [0, 0, 0.5], seg: 5 }); // dorsal spines
        s.cyl(0.06, 0.18, CHITIN2, { at: [0.36, 0.05, 0], rot: [0, 0, -1.2], seg: 10 }); // neck
        s.ball(0.07, CHITIN, { at: [0.48, 0.09, 0], scale: [1.7, 0.7, 0.8], seg: 10 }); // head
        s.cone(0.03, 0.12, BONE, { at: [0.6, 0.06, 0.03], rot: [0, 0, -Math.PI / 2 - 0.15], seg: 5 }); // jaw blades
        s.cone(0.03, 0.12, BONE, { at: [0.6, 0.06, -0.03], rot: [0, 0, -Math.PI / 2 - 0.15], seg: 5 });
        for (const z of [0.035, -0.035]) {
          s.ball(0.014, GREEN, { at: [0.53, 0.12, z], seg: 6, glow: true });
          s.ball(0.01, GREEN, { at: [0.5, 0.12, z * 1.2], seg: 6, glow: true });
        }
        s.tube(0.05, 0.42, CHITIN, { at: [-0.5, 0.02, 0], r2: 0.012, rot: [0, 0, 0.12], seg: 8 }); // tail
        s.cone(0.03, 0.12, BONE, { at: [-0.76, 0.05, 0], rot: [0, 0, Math.PI / 2 + 0.2], seg: 5 });
        // Scythe arms folded forward.
        for (const z of [0.1, -0.1]) {
          s.box(0.2, 0.03, 0.03, CHITIN2, { at: [0.28, -0.04, z], rot: [0, 0, 0.6], bevel: 0.35 });
          s.cone(0.025, 0.24, BONE, { at: [0.42, -0.1, z], rot: [0, 0, -2.4], seg: 5 });
        }
        return s;
      },
    },
    root: {
      kids: [
        { anim: { k: 'body' }, geo: 'body', at: [0, 0.32, 0], kids: [{ muzzle: true, at: [0.65, -0.05, 0] }] },
        { geo: 'leg', at: [0.18, 0.31, 0.1], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: 0 } },
        { geo: 'leg', at: [0.18, 0.31, -0.1], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: Math.PI } },
        { geo: 'leg', at: [-0.22, 0.31, 0.11], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: Math.PI } },
        { geo: 'leg', at: [-0.22, 0.31, -0.11], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: 0 } },
      ],
    },
  };
}

function brute(): RigDef {
  return {
    move: 'walker',
    organic: true,
    stride: 0.75,
    turn: 5,
    radius: 0.8,
    height: 0.95,
    weapon: 'claw',
    shapes: {
      arm: () => {
        const s = shape();
        s.ball(0.11, CHITIN2, { at: [0, -0.04, 0], seg: 10 }); // shoulder
        s.box(0.12, 0.3, 0.12, CHITIN, { at: [0.04, -0.2, 0], rot: [0, 0, 0.25], bevel: 0.4 });
        s.box(0.14, 0.26, 0.14, CHITIN2, { at: [0.08, -0.43, 0], rot: [0, 0, -0.15], bevel: 0.4 });
        s.ball(0.1, BELLY, { at: [0.1, -0.56, 0], scale: [1.2, 0.8, 1.1], seg: 10 }); // fist
        for (const z of [-0.05, 0, 0.05]) s.cone(0.022, 0.1, BONE, { at: [0.2, -0.58, z], rot: [0, 0, -Math.PI / 2], seg: 5 });
        s.box(0.16, 0.05, 0.15, 'team', { at: [0.02, 0.03, 0], bevel: 0.4 }); // shoulder plate
        return s;
      },
      leg: () => {
        const s = shape();
        s.box(0.16, 0.22, 0.15, CHITIN, { at: [-0.02, -0.1, 0], bevel: 0.4 });
        s.box(0.12, 0.2, 0.12, CHITIN2, { at: [0.02, -0.27, 0], bevel: 0.4 });
        s.box(0.18, 0.05, 0.14, BELLY, { at: [0.05, -0.365, 0], bevel: 0.4 });
        return s;
      },
      body: () => {
        const s = shape();
        s.ball(0.32, CHITIN, { at: [0, 0, 0], scale: [1.05, 0.8, 0.95], seg: 14 }); // torso
        s.ball(0.32, 'teamDark', { at: [-0.04, 0.03, 0], scale: [1.0, 0.8, 0.82], seg: 14, cut: 0.38 }); // back armour
        for (let i = 0; i < 4; i++) s.cone(0.05, 0.2 - i * 0.025, BONE, { at: [0.08 - i * 0.12, 0.28 - i * 0.02, 0], rot: [0, 0, 0.5], seg: 6 }); // hump spikes
        for (const z of [0.18, -0.18]) s.cone(0.04, 0.16, BONE, { at: [0.06, 0.2, z], rot: [z > 0 ? 0.7 : -0.7, 0, 0.2], seg: 6 });
        s.ball(0.12, CHITIN2, { at: [0.3, -0.06, 0], scale: [1.2, 0.85, 1], seg: 10 }); // head, low between the shoulders
        for (const z of [0.07, -0.07]) {
          s.cone(0.03, 0.18, BONE, { at: [0.42, -0.08, z], rot: [z > 0 ? 0.6 : -0.6, 0, -1.4], seg: 6 }); // tusks
          s.ball(0.02, GREEN, { at: [0.42, -0.0, z * 0.6], seg: 6, glow: true });
        }
        // Glowing veins along the flanks.
        for (const z of [0.29, -0.29]) for (let i = 0; i < 3; i++) s.tube(0.012, 0.22, GREEN, { at: [-0.1 + i * 0.1, -0.05 + i * 0.03, z * (0.95 - i * 0.05)], rot: [0, 0, 0.5 - i * 0.3], glow: true, seg: 5 });
        s.ball(0.2, BELLY, { at: [-0.16, -0.12, 0], scale: [1.1, 0.8, 1.1], seg: 10 }); // haunch
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          at: [0, 0.5, 0],
          kids: [
            { geo: 'body' },
            { geo: 'arm', at: [0.2, 0.06, 0.3], anim: { k: 'gait', axis: 'z', amp: 0.45, phase: 0 } },
            { geo: 'arm', at: [0.2, 0.06, -0.3], anim: { k: 'gait', axis: 'z', amp: 0.45, phase: Math.PI } },
            { muzzle: true, at: [0.5, -0.4, 0] },
          ],
        },
        { geo: 'leg', at: [-0.22, 0.38, 0.17], anim: { k: 'gait', axis: 'z', amp: 0.4, phase: Math.PI } },
        { geo: 'leg', at: [-0.22, 0.38, -0.17], anim: { k: 'gait', axis: 'z', amp: 0.4, phase: 0 } },
      ],
    },
  };
}

function lobber(): RigDef {
  return {
    move: 'walker',
    organic: true,
    stride: 0.55,
    turn: 4,
    radius: 0.8,
    height: 0.8,
    weapon: 'acidBig',
    shapes: {
      legR: () => insectLeg(1, 0.44, 0.27, 0.17, 0.045, CHITIN),
      legL: () => insectLeg(-1, 0.44, 0.27, 0.17, 0.045, CHITIN),
      body: () => {
        const s = shape();
        s.ball(0.3, CHITIN, { at: [0, 0, 0], scale: [1.5, 0.6, 1.05], seg: 14 }); // carapace
        s.ball(0.3, 'teamDark', { at: [0, 0.02, 0], scale: [1.45, 0.58, 0.95], seg: 14, cut: 0.4 });
        for (const z of [0.2, -0.2]) s.ball(0.05, 'team', { at: [0.18, 0.12, z], scale: [2.4, 0.5, 0.8], seg: 8 }); // team blazes
        s.ball(0.12, CHITIN2, { at: [0.44, -0.02, 0], scale: [1.1, 0.8, 1], seg: 10 }); // head
        for (const z of [0.05, -0.05]) s.ball(0.02, GREEN, { at: [0.54, 0.02, z], seg: 6, glow: true });
        // The acid sac swells on the back, ribbed with bone.
        s.lathe([[0.0, 0], [0.2, 0.04], [0.26, 0.16], [0.22, 0.3], [0.1, 0.38], [0.0, 0.4]], SAC, { at: [-0.12, 0.12, 0], seg: 14 });
        for (let i = 0; i < 3; i++) s.ring(0.235 - Math.abs(i - 1) * 0.035, 0.012, ACID, { at: [-0.12, 0.2 + i * 0.08, 0], seg: 16, glow: true });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          s.box(0.03, 0.34, 0.03, BONE, { at: [-0.12 + Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], bevel: 0.3 });
        }
        return s;
      },
      barrel: () => {
        const s = shape();
        s.tube(0.07, 0.26, CHITIN2, { at: [0.08, 0, 0], r2: 0.1, seg: 10 }); // spout
        s.ring(0.065, 0.02, BONE, { at: [0.2, 0, 0], rot: [0, 0, Math.PI / 2], seg: 12 });
        s.cyl(0.05, 0.02, ACID, { at: [0.215, 0, 0], rot: [0, 0, Math.PI / 2], seg: 10, glow: true });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          geo: 'body',
          at: [0, 0.3, 0],
          kids: [
            ...sixLegs([0.25, 0.0, -0.25], -0.03, 0.18, 0.3, 0.06),
            { geo: 'barrel', at: [0.0, 0.5, 0], rot: [0, 0, 1.05], anim: { k: 'barrel', recoil: 0.09 }, kids: [{ muzzle: true, at: [0.26, 0, 0] }] },
          ],
        },
      ],
    },
  };
}

function gorger(): RigDef {
  return {
    move: 'walker',
    organic: true,
    stride: 0.4,
    turn: 4.5,
    radius: 0.8,
    height: 0.66,
    shapes: {
      legR: () => insectLeg(1, 0.3, 0.24, 0.1, 0.04, CHITIN),
      legL: () => insectLeg(-1, 0.3, 0.24, 0.1, 0.04, CHITIN),
      body: () => {
        const s = shape();
        // Three swollen segments, front to back, team plates on top.
        const seg = [[0.4, 0.2], [0.05, 0.28], [-0.38, 0.24]] as const;
        for (const [x, r] of seg) {
          s.ball(r, CHITIN, { at: [x, 0, 0], scale: [1, 0.78, 1], seg: 12 });
          s.ball(r * 0.98, 'teamDark', { at: [x, 0.02, 0], scale: [0.85, 0.76, 0.85], seg: 12, cut: 0.35 });
          s.ball(r * 0.25, 'team', { at: [x, r * 0.76, 0], scale: [1.6, 0.4, 1], seg: 8 });
        }
        s.ring(0.12, 0.035, BONE, { at: [0.6, -0.02, 0], rot: [0, 0, Math.PI / 2], seg: 12 }); // maw
        s.cyl(0.1, 0.02, FLESH, { at: [0.62, -0.02, 0], rot: [0, 0, Math.PI / 2], seg: 10 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          s.cone(0.02, 0.07, BONE, { at: [0.64, -0.02 + Math.sin(a) * 0.09, Math.cos(a) * 0.09], rot: [0, 0, -Math.PI / 2], seg: 4 });
        }
        for (const z of [0.12, -0.12]) s.ball(0.022, GREEN, { at: [0.52, 0.1, z], seg: 6, glow: true });
        return s;
      },
      cargo: () => {
        const s = shape();
        s.ball(0.17, SAC, { at: [0.05, 0.2, 0], scale: [1.2, 0.7, 0.9], seg: 12 });
        s.ring(0.15, 0.014, ACID, { at: [0.05, 0.25, 0], scale: [1.2, 1, 0.9], seg: 14, glow: true });
        s.ball(0.05, ACID, { at: [0.05, 0.32, 0], seg: 8, glow: true });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          geo: 'body',
          at: [0, 0.3, 0],
          kids: [...sixLegs([0.35, 0.02, -0.32], -0.06, 0.16, 0.3, 0.04), { geo: 'cargo', anim: { k: 'cargo' } }],
        },
      ],
    },
  };
}

function wasp(): RigDef {
  const wing = (z: number, x: number, ph: number): RigNode => ({ geo: z > 0 ? 'wingR' : 'wingL', at: [x, 0.07, z], anim: { k: 'flap', axis: 'x', amp: z > 0 ? 0.6 : -0.6, rate: 38, phase: ph } });
  return {
    move: 'air',
    organic: true,
    turn: 5,
    radius: 0.62,
    height: 0.4,
    weapon: 'sting',
    shapes: {
      wingR: () => shape().ball(0.16, MEMBRANE, { at: [-0.03, 0, 0.17], scale: [0.45, 0.03, 1], seg: 10 }).strut([0.02, 0.004, 0.0], [-0.04, 0.004, 0.33], 0.007, CHITIN),
      wingL: () => shape().ball(0.16, MEMBRANE, { at: [-0.03, 0, -0.17], scale: [0.45, 0.03, 1], seg: 10 }).strut([0.02, 0.004, 0.0], [-0.04, 0.004, -0.33], 0.007, CHITIN),
      body: () => {
        const s = shape();
        s.ball(0.1, CHITIN, { at: [0.08, 0, 0], scale: [1.2, 0.9, 0.9], seg: 12 }); // thorax
        s.ball(0.07, CHITIN2, { at: [0.24, 0.0, 0], scale: [1.1, 0.9, 1], seg: 10 }); // head
        for (const z of [0.045, -0.045]) s.ball(0.03, GREEN, { at: [0.27, 0.02, z], scale: [0.8, 1, 0.6], seg: 8, glow: true }); // compound eyes
        s.ball(0.12, CHITIN, { at: [-0.18, -0.04, 0], scale: [1.6, 0.8, 0.85], seg: 12 }); // abdomen
        for (let i = 0; i < 3; i++) s.ring(0.092 - i * 0.012, 0.02, 'team', { at: [-0.12 - i * 0.08, -0.04 - i * 0.004, 0], rot: [0, 0, Math.PI / 2 - 0.15], seg: 12 }); // team bands
        s.cone(0.03, 0.16, BONE, { at: [-0.12, -0.16, 0], rot: [0, 0, -2.2], seg: 6 }); // stinger, curled forward under the body
        s.ball(0.02, ACID, { at: [-0.02, -0.21, 0], seg: 6, glow: true });
        for (const z of [0.05, -0.05]) for (let i = 0; i < 3; i++) s.cyl(0.008, 0.14, BELLY, { at: [0.12 - i * 0.06, -0.1, z], rot: [z > 0 ? -0.4 : 0.4, 0, 0.3], seg: 4 }); // dangling legs
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [wing(0.05, 0.12, 0), wing(-0.05, 0.12, 0), wing(0.05, 0.02, 0.6), wing(-0.05, 0.02, 0.6), { muzzle: true, at: [0.0, -0.22, 0] }],
        },
      ],
    },
  };
}

export const UNIT_RIGS: Readonly<Record<string, () => RigDef>> = {
  hum_rifleman: () => infantry(false),
  hum_rocketeer: () => infantry(true),
  hum_buggy: buggy,
  hum_tank: tank,
  hum_artillery: artillery,
  hum_hauler: hauler,
  hum_gunship: gunship,
  ali_skitter: skitterer,
  ali_spitter: spitter,
  ali_stalker: stalker,
  ali_brute: brute,
  ali_lobber: lobber,
  ali_gorger: gorger,
  ali_wasp: wasp,
};
