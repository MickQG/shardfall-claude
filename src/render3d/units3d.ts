import { Shape, type V3 } from './kit';
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
/** Rocketeers' heavier gunmetal fatigues. */
const HEAVY_CLOTH = 0x4a4f58;
const HAZARD = 0xe0aa2c;
const SKIN = 0xb98a6a;
/** Vehicle colour schemes (R3D-23): the tank is olive with tan camouflage blocks, the buggy sand with a bold dark stripe, the artillery slate blue over pale grey with a hazard-banded barrel. */
const TANK_OLIVE = 0x4f5d3a;
const TANK_DARK = 0x38432b;
const TANK_TAN = 0x93855a;
const BUGGY_SAND = 0xcdb47c;
const BUGGY_SAND2 = 0xa88e58;
const BUGGY_STRIPE = 0x262b33;
const BUGGY_WHITE = 0xece6d4;
const ARTY_SLATE = 0x4b525c;
const ARTY_PALE = 0xb4bcc2;
const ARTY_BAND = 0xf2c53a;
const CYAN = 0x6fe2ff;
const AMBER = 0xffb347;
const RED = 0xff4a3a;
// Vrax Hive palette.
const CHITIN = 0x4b2b45;
const CHITIN2 = 0x6e4062;
const BELLY = 0x2c1a28;
const BONE = 0xd9ccb2;
const FLESH = 0x8c4460;
const SAC = 0x7fb23a;
const GREEN = 0x9dff3c;
const ACID = 0xc8ff4a;

const shape = (): Shape => new Shape();

// ---------------------------------------------------------------- Aegis infantry

/**
 * A rifleman or rocketeer figure: helmet, armoured vest, pack and arms; legs are separate gait nodes. The two read apart
 * at a glance: riflemen are light olive troopers with a cyan visor and a rifle; rocketeers are heavier, in gunmetal grey
 * with broad team-coloured pauldrons, a red visor, a rocket rack on the back and a fat launcher on the shoulder.
 */
function soldier(s: Shape, rocket: boolean): Shape {
  const cloth = rocket ? HEAVY_CLOTH : OLIVE;
  s.box(0.07, 0.045, 0.095, cloth, { at: [0, 0.01, 0] }); // hips
  s.box(rocket ? 0.09 : 0.08, rocket ? 0.11 : 0.1, rocket ? 0.12 : 0.105, rocket ? STEEL2 : STEEL, { at: [0, 0.075, 0], bevel: 0.3 }); // vest
  s.box(0.06, 0.03, rocket ? 0.125 : 0.11, 'team', { at: [0.01, 0.06, 0], bevel: 0.3 }); // chest band
  const pad = rocket ? 0.04 : 0.03;
  s.ball(pad, 'team', { at: [0, 0.118, rocket ? 0.068 : 0.058], scale: [1, 0.8, 1], seg: 8 }); // pauldrons
  s.ball(pad, 'team', { at: [0, 0.118, rocket ? -0.068 : -0.058], scale: [1, 0.8, 1], seg: 8 });
  s.ball(0.03, SKIN, { at: [0.005, 0.15, 0], seg: 8 }); // head
  if (rocket) {
    // A closed heavy helmet with a red T-visor.
    s.ball(0.044, STEEL2, { at: [0, 0.156, 0], cut: 0.62, seg: 10 });
    s.box(0.012, 0.016, 0.05, RED, { at: [0.036, 0.152, 0], glow: true, bevel: 0 });
    s.box(0.012, 0.03, 0.012, RED, { at: [0.036, 0.142, 0], glow: true, bevel: 0 });
    // A rack of three rockets on the back, warheads up.
    s.box(0.04, 0.1, 0.09, GUN, { at: [-0.065, 0.09, 0], bevel: 0.2 });
    for (const z of [-0.028, 0, 0.028]) {
      s.tube(0.011, 0.07, STEEL, { at: [-0.07, 0.15, z], rot: [0, 0, Math.PI / 2], seg: 6 });
      s.cone(0.012, 0.03, RED, { at: [-0.07, 0.2, z], seg: 6, glow: true });
    }
    s.box(0.08, 0.03, 0.03, cloth, { at: [0.035, 0.085, 0.07], rot: [0, 0.25, -0.35] }); // arms
    s.box(0.08, 0.03, 0.03, cloth, { at: [0.035, 0.085, -0.06], rot: [0, -0.35, -0.35] });
    // A fat launcher on the right shoulder: team band, hazard stripe and a wide muzzle.
    s.tube(0.03, 0.26, GUN, { at: [0.02, 0.14, 0.07], seg: 10 });
    s.tube(0.033, 0.035, 'team', { at: [-0.05, 0.14, 0.07], seg: 10 });
    s.tube(0.032, 0.02, HAZARD, { at: [0.09, 0.14, 0.07], seg: 10 });
    s.tube(0.036, 0.02, DARK, { at: [0.155, 0.14, 0.07], seg: 10 });
    s.box(0.04, 0.03, 0.02, GUN, { at: [0.04, 0.1, 0.07] }); // grip
    s.box(0.03, 0.025, 0.02, STEEL, { at: [0.04, 0.17, 0.095] }); // sight
  } else {
    s.box(0.05, 0.085, 0.08, STEEL2, { at: [-0.06, 0.08, 0] }); // pack
    s.box(0.02, 0.03, 0.03, AMBER, { at: [-0.087, 0.1, 0.02], glow: true, bevel: 0 }); // pack lamp
    s.ball(0.04, STEEL2, { at: [0, 0.158, 0], cut: 0.55, seg: 10 }); // helmet
    s.box(0.014, 0.014, 0.05, CYAN, { at: [0.032, 0.15, 0], glow: true, bevel: 0 }); // visor
    // Arms forward, holding the rifle.
    s.box(0.08, 0.026, 0.026, cloth, { at: [0.035, 0.085, 0.058], rot: [0, 0.25, -0.35] });
    s.box(0.08, 0.026, 0.026, cloth, { at: [0.035, 0.085, -0.058], rot: [0, -0.35, -0.35] });
    s.box(0.13, 0.026, 0.02, GUN, { at: [0.09, 0.075, 0.025], bevel: 0.2 }); // rifle body
    s.tube(0.006, 0.07, DARK, { at: [0.19, 0.08, 0.025] });
    s.box(0.02, 0.04, 0.014, GUN, { at: [0.08, 0.05, 0.025], rot: [0, 0, 0.2] }); // magazine
    s.box(0.03, 0.01, 0.012, CYAN, { at: [0.08, 0.093, 0.025], glow: true, bevel: 0 }); // sight
  }
  return s;
}

function soldierLeg(rocket: boolean): Shape {
  const s = shape();
  const cloth = rocket ? HEAVY_CLOTH : OLIVE;
  s.box(rocket ? 0.048 : 0.042, 0.095, rocket ? 0.05 : 0.046, cloth, { at: [0, -0.045, 0], bevel: 0.3 }); // thigh, from the hip down
  s.box(0.04, 0.08, 0.042, cloth, { at: [0.006, -0.125, 0], bevel: 0.3 }); // shin
  s.box(rocket ? 0.05 : 0.045, rocket ? 0.04 : 0.03, rocket ? 0.05 : 0.044, rocket ? 'team' : STEEL2, { at: [0.012, -0.11, 0] }); // knee pad
  s.box(rocket ? 0.07 : 0.065, 0.028, rocket ? 0.05 : 0.046, DARK, { at: [0.016, -0.168, 0] }); // boot
  return s;
}

function infantry(rocket: boolean): RigDef {
  return {
    shapes: { body: () => soldier(shape(), rocket), leg: () => soldierLeg(rocket) },
    move: 'walker',
    scale: rocket ? 1.45 : 1.35,
    // Long, easy strides: the legs swing gently rather than scurry.
    stride: 0.46,
    turn: 9,
    radius: 0.5,
    height: 0.36,
    weapon: rocket ? 'rocket' : 'rifle',
    root: {
      kids: [
        // Firing crouch: the hips sink and the legs brace, one forward and one back, feet on the ground.
        { geo: 'leg', at: [0, 0.182, 0.026], anim: { k: 'gait', axis: 'z', amp: 0.3, phase: 0, kneel: 0.85, drop: 0.07 } },
        { geo: 'leg', at: [0, 0.182, -0.026], anim: { k: 'gait', axis: 'z', amp: 0.3, phase: Math.PI, kneel: -0.85, drop: 0.07 } },
        { geo: 'body', at: [0, 0.18, 0], anim: { k: 'body', drop: 0.07 }, kids: [{ muzzle: true, at: rocket ? [0.17, 0.14, 0.07] : [0.23, 0.08, 0.025] }] },
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
        s.slab([[-0.56, 0.09], [0.48, 0.09], [0.62, 0.17], [0.42, 0.28], [-0.5, 0.29], [-0.58, 0.21]], 0.6, TANK_OLIVE, { bevel: 0.025 });
        // Tan camouflage blocks across the deck and glacis, dark olive flanks.
        s.box(0.34, 0.012, 0.26, TANK_TAN, { at: [0.12, 0.286, 0.17], bevel: 0 });
        s.box(0.28, 0.012, 0.22, TANK_DARK, { at: [-0.12, 0.292, -0.18], bevel: 0 });
        s.box(0.2, 0.012, 0.2, TANK_TAN, { at: [-0.36, 0.296, 0.22], bevel: 0 });
        s.slab([[0.44, 0.255], [0.56, 0.2], [0.6, 0.17], [0.44, 0.17]], 0.34, TANK_DARK, { at: [0, 0.006, 0], bevel: 0 });
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
        s.hull([[0.26, -0.13], [0.3, 0], [0.26, 0.13], [-0.16, 0.21], [-0.3, 0.14], [-0.3, -0.14], [-0.16, -0.21]], 0.15, TANK_OLIVE, { bevel: 0.025 });
        s.box(0.22, 0.012, 0.16, TANK_TAN, { at: [-0.12, 0.156, -0.09], bevel: 0 });
        s.box(0.16, 0.012, 0.12, TANK_DARK, { at: [0.05, 0.156, 0.1], bevel: 0 });
        s.hull([[0.18, -0.09], [0.21, 0], [0.18, 0.09], [-0.12, 0.15], [-0.24, 0.1], [-0.24, -0.1], [-0.12, -0.15]], 0.025, 'team', { at: [0, 0.15, 0], bevel: 0.008 });
        s.cyl(0.055, 0.05, STEEL2, { at: [-0.1, 0.19, 0.09], seg: 10 }); // cupola
        s.box(0.03, 0.012, 0.05, CYAN, { at: [-0.06, 0.205, 0.09], glow: true, bevel: 0 }); // cupola vision block
        s.box(0.06, 0.05, 0.05, GUN, { at: [0.1, 0.18, -0.12] }); // gunner sight
        s.box(0.012, 0.03, 0.035, CYAN, { at: [0.133, 0.18, -0.12], glow: true, bevel: 0 });
        s.cyl(0.006, 0.34, DARK, { at: [-0.24, 0.32, -0.12], seg: 4 }); // antenna
        s.box(0.12, 0.08, 0.3, TANK_DARK, { at: [-0.34, 0.08, 0] }); // bustle rack
        for (const z of [0.17, -0.17]) for (const k of [0, 1]) s.tube(0.016, 0.06, GUN, { at: [0.12 + k * 0.01, 0.12 + k * 0.03, z], rot: [0, z > 0 ? -0.5 : 0.5, 0.4] }); // smoke dischargers
        return s;
      },
      barrel: () => {
        const s = shape();
        s.box(0.1, 0.09, 0.13, TANK_DARK, { at: [0.02, 0, 0] }); // mantlet
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

/**
 * Hammer Artillery (R3D-32): a modern self-propelled howitzer, an original design. A long, low tracked hull on seven
 * road wheels carries a large, enclosed, faceted turret set toward the rear; the long barrel, with a multi-baffle muzzle
 * brake, reaches out over the hull front and rests in a travel lock on the glacis until the gun has a target. No open
 * deck, no outriggers, no crew. The barrel rides an elevating cradle, so shots leave the muzzle at its current angle.
 */
/** Barrel elevation in the travel lock (nearly level) and fully raised, radians (R3D-32). */
export const HAMMER_LOCK = 0.035;
export const HAMMER_RAISED = 0.68;
/** Where the barrel hinges in the turret, and the muzzle's distance along the barrel from that hinge (R3D-32). */
export const HAMMER_TRUNNION: V3 = [0.44, 0.2, 0];
export const HAMMER_MUZZLE = 1.14;

function artillery(): RigDef {
  const LEN = 1.5;
  return {
    move: 'tracked',
    turn: 5,
    radius: 0.78,
    height: 0.7,
    weapon: 'howitzer',
    shapes: {
      track: () => trackShape(LEN, 0.14, 0.16),
      roadwheel: () => roadWheel(0.058, 0.04),
      hull: () => {
        const s = shape();
        s.box(1.42, 0.08, 0.42, GUN, { at: [0, 0.12, 0], bevel: 0.2 }); // belly between the tracks
        // The faceted hull: a low wedge with a shallow glacis.
        s.slab([[-0.74, 0.15], [0.7, 0.15], [0.8, 0.2], [0.46, 0.3], [-0.7, 0.3], [-0.76, 0.24]], 0.5, ARTY_SLATE, { bevel: 0.02 });
        // A pale grey roof deck over the slate hull, and a hazard stripe across the glacis.
        s.box(0.9, 0.012, 0.4, ARTY_PALE, { at: [-0.22, 0.298, 0], bevel: 0 });
        for (let i = 0; i < 4; i++) s.box(0.04, 0.012, 0.1, i % 2 ? DARK : ARTY_BAND, { at: [0.64, 0.255, -0.15 + i * 0.1], bevel: 0, rot: [0, 0, -0.5] });
        // Sponsons over the tracks, closed by smooth side skirts with a team stripe.
        for (const z of [0.325, -0.325]) {
          s.box(1.36, 0.1, 0.18, ARTY_SLATE, { at: [-0.02, 0.24, z], bevel: 0.25 });
          s.box(1.0, 0.026, 0.012, 'team', { at: [-0.05, 0.27, z * 1.285], bevel: 0 });
        }
        // The travel lock on the glacis: two posts and a pad the barrel rests above.
        for (const z of [0.06, -0.06]) s.box(0.07, 0.17, 0.035, GUN, { at: [0.52, 0.365, z], bevel: 0.2 });
        s.box(0.1, 0.025, 0.16, DARK, { at: [0.52, 0.455, 0], bevel: 0.2 });
        // Driver's optics and sensor block on the glacis, engine deck louvres, small cyan lenses.
        s.box(0.08, 0.05, 0.1, GUN, { at: [0.34, 0.325, 0.15], bevel: 0.25 });
        s.box(0.012, 0.022, 0.05, CYAN, { at: [0.382, 0.326, 0.15], glow: true, bevel: 0 });
        s.box(0.34, 0.016, 0.36, DARK, { at: [-0.5, 0.305, 0], bevel: 0.2 });
        for (const z of [0.18, -0.18]) s.box(0.016, 0.02, 0.04, CYAN, { at: [0.752, 0.19, z], glow: true, bevel: 0 });
        s.box(0.012, 0.03, 0.1, RED, { at: [-0.762, 0.22, 0.14], glow: true, bevel: 0 });
        s.box(0.012, 0.03, 0.1, RED, { at: [-0.762, 0.22, -0.14], glow: true, bevel: 0 });
        return s;
      },
      turret: () => {
        // Large, enclosed and angular: a chamfered plan block with a sloped roof wedge, a rear bustle and optics.
        const s = shape();
        s.cyl(0.3, 0.04, STEEL2, { at: [0, 0.02, 0], seg: 16 });
        s.hull([[-0.38, -0.18], [-0.3, -0.26], [0.26, -0.26], [0.36, -0.14], [0.36, 0.14], [0.26, 0.26], [-0.3, 0.26], [-0.38, 0.18]], 0.26, ARTY_PALE, { at: [0, 0.04, 0], bevel: 0.02 });
        s.slab([[-0.32, 0], [0.3, 0], [0.12, 0.09], [-0.26, 0.09]], 0.36, ARTY_SLATE, { at: [0, 0.29, 0], bevel: 0.015 });
        s.box(0.4, 0.012, 0.08, 'team', { at: [-0.04, 0.385, 0], bevel: 0 });
        s.box(0.07, 0.17, 0.3, GUN, { at: [-0.4, 0.17, 0], bevel: 0.3 }); // rear bustle
        // Optics: a commander's sight block and a gunner's sensor block, each with a small cyan lens.
        s.box(0.1, 0.07, 0.12, GUN, { at: [-0.12, 0.42, 0.12], bevel: 0.25 });
        s.box(0.012, 0.035, 0.07, CYAN, { at: [-0.066, 0.425, 0.12], glow: true, bevel: 0 });
        s.box(0.11, 0.05, 0.09, GUN, { at: [0.16, 0.4, -0.1], bevel: 0.25 });
        s.box(0.012, 0.025, 0.05, CYAN, { at: [0.216, 0.4, -0.1], glow: true, bevel: 0 });
        s.cyl(0.006, 0.2, DARK, { at: [-0.3, 0.48, 0.2], seg: 4 }); // short antenna
        for (const z of [0.285, -0.285]) for (const x of [0.2, 0.25]) s.tube(0.014, 0.06, DARK, { at: [x, 0.25, z], seg: 6 }); // smoke dischargers
        return s;
      },
      cradle: () => {
        const s = shape();
        s.box(0.22, 0.12, 0.14, STEEL2, { at: [0.01, 0, 0], bevel: 0.25 });
        for (const z of [0.07, -0.07]) s.box(0.1, 0.09, 0.015, GUN, { at: [0.01, 0, z] }); // trunnion cheeks
        return s;
      },
      barrel: () => {
        const s = shape();
        s.tube(0.03, 1.0, GUN, { at: [0.5, 0, 0], r2: 0.034, seg: 10 });
        s.tube(0.04, 0.4, ARTY_PALE, { at: [0.22, 0, 0], seg: 10 }); // thermal sleeve
        // A hazard band of alternating yellow and black rings near the muzzle.
        for (let i = 0; i < 6; i++) s.tube(0.036, 0.04, i % 2 ? DARK : ARTY_BAND, { at: [0.78 + i * 0.04, 0, 0], seg: 10 });
        s.tube(0.047, 0.12, GUN, { at: [0.6, 0, 0], seg: 10 }); // fume extractor
        s.tube(0.036, 0.13, DARK, { at: [1.065, 0, 0], seg: 8 }); // muzzle brake core and its three baffles
        for (const x of [1.02, 1.065, 1.11]) s.box(0.014, 0.1, 0.1, GUN, { at: [x, 0, 0], bevel: 0.2 });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          kids: [
            ...runningGear(LEN, 0.29, 0.058, 7, 0.08),
            { geo: 'hull' },
            {
              anim: { k: 'turret' },
              at: [-0.34, 0.3, 0],
              geo: 'turret',
              // The cradle elevates the barrel from the travel lock; the barrel recoils along itself inside it.
              kids: [
                {
                  geo: 'cradle',
                  at: HAMMER_TRUNNION,
                  anim: { k: 'elev', lo: HAMMER_LOCK, hi: HAMMER_RAISED },
                  kids: [{ geo: 'barrel', anim: { k: 'barrel', recoil: 0.1 }, kids: [{ muzzle: true, at: [HAMMER_MUZZLE, 0, 0] }] }],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

/**
 * Scout Buggy (R3D-33): a fast, light, high-tech scout car, an original design. A low wedge of armour on four
 * long-travel wheels with visible suspension arms, a closed cab under a tinted canopy, a sensor mast at the back and a
 * small remote weapon station with twin barrels. No driver or crew figure.
 */
const CANOPY = 0x2c3a48;
/** The buggy is drawn at about three quarters of the tank's footprint: it is the light scout. Wheels roll by the scaled radius. */
const BUGGY_SCALE = 0.78;

function buggy(): RigDef {
  const R = 0.125;
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, R, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: R * BUGGY_SCALE } }] } : { geo: 'wheel', at: [x, R, z], anim: { k: 'wheel', r: R * BUGGY_SCALE } };
  return {
    move: 'wheeled',
    turn: 7.5,
    scale: BUGGY_SCALE,
    radius: 0.47,
    height: 0.62,
    weapon: 'mg',
    ride: 0.05,
    shapes: {
      wheel: () => tire(R, 0.1, STEEL2),
      body: () => {
        const s = shape();
        s.slab([[-0.46, 0.16], [0.46, 0.16], [0.58, 0.22], [0.3, 0.31], [-0.32, 0.33], [-0.46, 0.27]], 0.34, BUGGY_SAND, { bevel: 0.02 });
        // A bold dark racing stripe down the hood and roof, sand-brown arch panels.
        s.box(0.62, 0.012, 0.09, BUGGY_STRIPE, { at: [0.2, 0.298, 0.0], bevel: 0 });
        s.box(0.4, 0.012, 0.09, BUGGY_STRIPE, { at: [-0.18, 0.338, 0.0], bevel: 0 });
        for (const z of [0.1, -0.1]) s.box(0.5, 0.01, 0.025, BUGGY_WHITE, { at: [0.2, 0.3, z * 1.1], bevel: 0 });
        for (const z of [0.172, -0.172]) s.slab([[-0.4, 0.19], [0.44, 0.19], [0.5, 0.22], [0.3, 0.27], [-0.4, 0.27]], 0.02, 'team', { at: [0, 0, z], bevel: 0.005 });
        s.box(0.9, 0.03, 0.3, DARK, { at: [0, 0.15, 0], bevel: 0.2 }); // skid plate
        s.box(0.1, 0.02, 0.4, GUN, { at: [0.6, 0.17, 0], bevel: 0.3 }); // splitter
        // Long-travel suspension: an upper and a lower arm and a sprung shock to each wheel hub.
        for (const x of [0.36, -0.36]) {
          for (const z of [1, -1]) {
            s.strut([x * 0.55, 0.27, z * 0.15], [x, 0.24, z * 0.25], 0.011, DARK);
            s.strut([x * 0.5, 0.17, z * 0.14], [x, 0.14, z * 0.25], 0.011, DARK);
            s.strut([x * 0.8, 0.31, z * 0.15], [x, 0.17, z * 0.25], 0.016, 'team');
            s.box(0.28, 0.02, 0.12, BUGGY_SAND2, { at: [x, 0.292, z * 0.3], bevel: 0.3 }); // fender flares
            s.box(0.05, 0.03, 0.1, STEEL2, { at: [x, 0.292, z * 0.22], bevel: 0.2 }); // and the stay that holds each to the body
          }
        }
        // The tinted canopy over a closed cab, with a roof plate.
        s.slab([[-0.22, 0.31], [0.26, 0.31], [0.1, 0.44], [-0.14, 0.45], [-0.22, 0.4]], 0.28, CANOPY, { bevel: 0.015 });
        s.box(0.26, 0.015, 0.25, BUGGY_SAND2, { at: [-0.02, 0.452, 0], bevel: 0.2 });
        s.box(0.28, 0.018, 0.07, BUGGY_STRIPE, { at: [-0.02, 0.456, 0], bevel: 0 });
        // Sensor mast at the back, with a small cyan lens.
        s.cyl(0.012, 0.3, DARK, { at: [-0.38, 0.45, 0], seg: 6 });
        s.box(0.06, 0.03, 0.08, GUN, { at: [-0.38, 0.61, 0], bevel: 0.3 });
        s.box(0.012, 0.014, 0.03, CYAN, { at: [-0.347, 0.61, 0], glow: true, bevel: 0 });
        for (const z of [0.1, -0.1]) {
          s.box(0.012, 0.02, 0.07, AMBER, { at: [0.555, 0.238, z], glow: true, bevel: 0 });
          s.box(0.012, 0.02, 0.06, RED, { at: [-0.465, 0.24, z * 1.2], glow: true, bevel: 0 });
        }
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
        wheel(0.36, 0.3, true),
        wheel(0.36, -0.3, true),
        wheel(-0.36, 0.3, false),
        wheel(-0.36, -0.3, false),
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            {
              anim: { k: 'turret' },
              geo: 'turret',
              at: [0.0, 0.465, 0],
              kids: [{ geo: 'barrel', at: [0.06, 0.05, 0], anim: { k: 'barrel', recoil: 0.025 }, kids: [{ muzzle: true, at: [0.21, 0, 0.022] }, { muzzle: true, at: [0.21, 0, -0.022] }] }],
            },
          ],
        },
      ],
    },
  };
}

/** Where the hauler's rear hatch hinges and its head's arms pivot: body-frame points (R3D-30). */
export const HAULER_HATCH: [number, number, number] = [-0.8, 0.62, 0];
export const HAULER_ARM: V3 = [0.66, 0.27, 0];
/** How far a lowered head's arms turn down from level, and how far the arms rise to clear the ground, radians (R3D-30). */
const HEAD_DOWN = -0.445;
const HEAD_UP = 0.645;

/**
 * Shard Hauler (R3D-30): a heavy, armoured industrial harvester, an original design. A long chassis on six big wheels
 * carries a raised armoured cab at the front-left and a large boxed hopper behind it. Across the front, a housed toothed
 * drum hangs on two hydraulic arms: raised clear while driving, lowered onto the ground to mine, feeding a conveyor that
 * carries crystals up into the hopper. A rear hatch opens to discharge.
 */
function hauler(): RigDef {
  const R = 0.14;
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, R, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: R } }] } : { geo: 'wheel', at: [x, R, z], anim: { k: 'wheel', r: R } };
  const BELT = -0.4636;
  return {
    move: 'wheeled',
    turn: 5,
    radius: 0.85,
    height: 0.78,
    shapes: {
      wheel: () => tire(R, 0.12, HAZARD),
      body: () => {
        const s = shape();
        s.box(1.5, 0.14, 0.5, GUN, { at: [-0.02, 0.23, 0], bevel: 0.15 }); // the chassis frame, between the wheels
        s.box(0.1, 0.12, 0.5, GUN, { at: [0.7, 0.22, 0], bevel: 0.2 }); // bumper and arm mounts
        for (const x of [0.46, -0.04, -0.54]) for (const z of [0.34, -0.34]) s.box(0.34, 0.03, 0.15, STEEL2, { at: [x, 0.32, z], bevel: 0.3 }); // fenders
        // The hopper: a boxed bin with a floor, team bands, a front wall and a rim.
        s.box(0.86, 0.03, 0.58, STEEL, { at: [-0.34, 0.335, 0], bevel: 0.2 });
        for (const z of [0.29, -0.29]) {
          s.slab([[-0.78, 0.32], [0.1, 0.32], [0.1, 0.62], [-0.78, 0.62]], 0.04, STEEL, { at: [0, 0, z], bevel: 0.01 });
          s.box(0.78, 0.07, 0.048, 'team', { at: [-0.34, 0.5, z], bevel: 0.2 });
          s.box(0.88, 0.03, 0.05, DARK, { at: [-0.34, 0.63, z], bevel: 0.2 });
          s.box(0.05, 0.3, 0.05, GUN, { at: [-0.8, 0.47, z], bevel: 0.2 });
          for (let i = 0; i < 4; i++) s.box(0.06, 0.03, 0.052, i % 2 ? DARK : HAZARD, { at: [-0.66 + i * 0.07, 0.36, z], bevel: 0 });
        }
        s.box(0.05, 0.28, 0.6, STEEL2, { at: [0.08, 0.46, 0], bevel: 0.2 });
        // The armoured cab, front-left: sloped front, dark visor, side window, team roof and a beacon.
        s.slab([[0.14, 0.3], [0.66, 0.3], [0.68, 0.4], [0.58, 0.62], [0.2, 0.66]], 0.27, STEEL, { at: [0, 0, 0.165], bevel: 0.02 });
        s.box(0.03, 0.16, 0.23, DARK, { at: [0.635, 0.51, 0.165], rot: [0, 0, 0.43], bevel: 0.1 });
        s.box(0.22, 0.09, 0.01, DARK, { at: [0.4, 0.52, 0.302], bevel: 0 });
        s.box(0.42, 0.02, 0.29, 'team', { at: [0.39, 0.665, 0.165], bevel: 0.3 });
        s.box(0.05, 0.025, 0.07, AMBER, { at: [0.3, 0.69, 0.165], glow: true, bevel: 0.3 });
        s.cyl(0.005, 0.2, DARK, { at: [0.24, 0.78, 0.26], seg: 4 });
        for (const z of [0.09, 0.24]) s.box(0.02, 0.04, 0.05, AMBER, { at: [0.69, 0.36, z], glow: true, bevel: 0 });
        s.cyl(0.028, 0.34, GUN, { at: [0.14, 0.47, 0.3], seg: 8 }); // exhaust stack
        s.cyl(0.036, 0.02, DARK, { at: [0.14, 0.65, 0.3], seg: 8 });
        // The conveyor trough from the head up into the hopper, on legs; its cleats are a separate scrolling part.
        s.box(1.0, 0.04, 0.18, DARK, { at: [0.41, 0.495, -0.13], rot: [0, 0, BELT], bevel: 0.1 });
        for (const z of [0.09, -0.09]) s.box(1.0, 0.065, 0.025, STEEL2, { at: [0.41, 0.515, -0.13 + z], rot: [0, 0, BELT], bevel: 0.2 });
        for (const x of [0.6, 0.24]) s.box(0.03, 0.2, 0.03, GUN, { at: [x, 0.36, -0.13] });
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.755, 0.25, 0.14], glow: true, bevel: 0 }); // tail lights
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.755, 0.25, -0.14], glow: true, bevel: 0 });
        return s;
      },
      hatch: () => {
        // The rear hatch, hinged along its top edge: hazard-striped and swinging up and out to discharge.
        const s = shape();
        s.box(0.04, 0.3, 0.52, STEEL2, { at: [-0.8, 0.47, 0], bevel: 0.15 });
        for (let i = 0; i < 3; i++) s.box(0.046, 0.03, 0.5, i % 2 ? DARK : HAZARD, { at: [-0.8, 0.37 + i * 0.07, 0], bevel: 0 });
        return s;
      },
      head: () => {
        // The harvesting head, in the arms' own frame (X along the arms, pivot at the origin): two hydraulic arms with
        // rams, and the hood and side plates that house the drum at the far end.
        const s = shape();
        for (const z of [0.27, -0.27]) {
          s.box(0.36, 0.05, 0.045, GUN, { at: [0.18, 0, z], bevel: 0.2 });
          s.strut([0.06, 0.1, z * 0.9], [0.26, 0.03, z], 0.014, STEEL);
          s.cyl(0.04, 0.05, STEEL2, { at: [0, 0, z], rot: [Math.PI / 2, 0, 0], seg: 8 });
          s.box(0.26, 0.18, 0.03, STEEL2, { at: [0.36, 0.04, z * 1.06], bevel: 0.2 });
        }
        s.box(0.16, 0.03, 0.56, 'team', { at: [0.25, 0.16, 0], bevel: 0.2 }); // a hood over the back of the drum only, so its teeth show
        s.box(0.03, 0.05, 0.56, HAZARD, { at: [0.54, -0.04, 0], bevel: 0.2 }); // a low lip at the front
        s.box(0.06, 0.14, 0.24, DARK, { at: [0.22, 0.1, -0.13], bevel: 0.2 }); // the throat toward the conveyor
        return s;
      },
      drum: () => {
        // A toothed cutter drum across the front that chews crystals off the ground.
        const s = shape();
        s.cyl(0.085, 0.5, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 10 });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          s.box(0.05, 0.045, 0.46, i % 2 ? HAZARD : GUN, { at: [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], rot: [0, 0, a], bevel: 0 });
        }
        return s;
      },
      cleats: () => {
        // The conveyor's cleats, with crystals riding on them; the node slides them along the trough.
        const s = shape();
        for (let i = 0; i < 10; i++) {
          const x = -0.45 + i * 0.1;
          s.box(0.02, 0.035, 0.15, HAZARD, { at: [x, 0.05, 0], bevel: 0 });
          s.cone(0.026, 0.07, i % 2 ? 0x47e8c4 : 0x7ff0dc, { at: [x + 0.05, 0.06, ((i % 3) - 1) * 0.04], seg: 5 });
        }
        return s;
      },
      cargo: () => {
        const s = shape();
        // A heap of crystals standing proud of the hopper when full (it rises from the floor with the load).
        for (let i = 0; i < 12; i++) {
          const cx = i % 4;
          const cz = Math.floor(i / 4);
          const x = -0.6 + cx * 0.17 + (cz % 2) * 0.05;
          const z = (cz - 1) * 0.17;
          const h = 0.17 + 0.12 * (1 - Math.abs(cx - 1.5) / 1.5) * (1 - Math.abs(cz - 1) * 0.5);
          const tilt: [number, number, number] = [0.3 * (i % 2 ? 1 : -1), 0, 0.22 * ((i % 3) - 1)];
          s.cyl(0.05, h, 0x47e8c4, { at: [x, 0.35 + h / 2, z], rot: tilt, seg: 6 });
          s.cone(0.05, 0.09, 0x7ff0dc, { at: [x, 0.35 + h + 0.03, z], rot: tilt, seg: 6 });
        }
        return s;
      },
    },
    root: {
      kids: [
        wheel(0.46, 0.34, true),
        wheel(0.46, -0.34, true),
        wheel(-0.04, 0.34, false),
        wheel(-0.04, -0.34, false),
        wheel(-0.54, 0.34, false),
        wheel(-0.54, -0.34, false),
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            // The head hangs lowered at rest and lifts clear on its arms while driving; the drum turns at its far end.
            { geo: 'head', at: HAULER_ARM, rot: [0, 0, HEAD_DOWN], anim: { k: 'arm', up: HEAD_UP, bob: 0.025 }, kids: [{ geo: 'drum', at: [0.36, 0, 0], anim: { k: 'drum' } }] },
            { geo: 'cleats', at: [0.41, 0.52, -0.13], rot: [0, 0, BELT], anim: { k: 'scroll', pitch: 0.1, per: -0.045 } },
            // The hatch swings up and out about its top hinge; the crystal heap sits in the hopper and rises as it fills.
            { geo: 'hatch', anim: { k: 'tip', pivot: HAULER_HATCH, max: -1.1 } },
            { geo: 'cargo', anim: { k: 'cargo', pivot: [-0.3, 0.35, 0] } },
          ],
        },
      ],
    },
  };
}

/**
 * Paladin, the Aegis hero (HERO-1): a giant four-legged assault walker, twice the size of the old tank. Four thick
 * reverse-jointed legs stride under a long, low armoured hull that turns to face its target; a missile pod rides on each
 * shoulder for aircraft and twin heavy cannons hang beneath; gold trim and a glowing visor mark it as the hero.
 */
/** How far the Paladin's cannon cradle swivels under its hull either way, radians: clear of the front legs (AIM-2). */
export const PALADIN_SWIVEL = 0.2;
/** How steeply the Paladin's pods are cocked up at rest, radians: mortar tubes, mouths up and forward (HERO-8). */
export const PALADIN_POD_TILT = 1.0;
/** How far out the Paladin's hips sit from the hull's centre line: beside the hull, not under it (AIM-2). */
const PALADIN_HIP = 0.38;

/** The Paladin's leg joints, in the leg's plane: the knee from the hip, the ankle from the knee (HERO-6). */
const PALADIN_KNEE = [-0.17, -0.24] as const;
const PALADIN_ANKLE = [0.2, -0.22] as const;
const PALADIN_KNEE3: V3 = [...PALADIN_KNEE, 0];
const PALADIN_ANKLE3: V3 = [...PALADIN_ANKLE, 0];
/** How far the Paladin's soles reach below its ankles. */
const PALADIN_SOLE = 0.06;
/** Tiles per full gait cycle and model scale: together they set how far a planted foot travels back. */
const PALADIN_STRIDE = 2.0;
const PALADIN_SCALE = 2.2;

/**
 * One of the Paladin's legs at hip `x` on side `side` (+1 or -1 in Z), its foot standing `fore` ahead of the hip: a thigh, a shin and a foot posed by IK so the
 * foot plants (HERO-6). A planted foot moves back half a stride's length (in model units) over its half of the cycle,
 * exactly as far as the hull moves forward.
 */
function paladinLeg(x: number, side: 1 | -1, phase: number, fore: number): RigNode {
  return {
    geo: 'thigh',
    at: [x, 0.53, side * PALADIN_HIP],
    rot: [-side * 0.16, 0, 0],
    anim: { k: 'step', phase, fore, reach: PALADIN_STRIDE / (4 * PALADIN_SCALE), lift: 0.06, knee: PALADIN_KNEE, ankle: PALADIN_ANKLE, sole: PALADIN_SOLE },
    kids: [{ geo: 'shin', at: PALADIN_KNEE3, kids: [{ geo: 'foot', at: PALADIN_ANKLE3 }] }],
  };
}

function paladin(): RigDef {
  const GOLD = 0xd8b24a;
  return {
    move: 'walker',
    // A long, unhurried stride: the cycle is slow, so the walk reads heavy and smooth.
    stride: PALADIN_STRIDE,
    // The hull bobs and sways gently with each step, and the walk takes about a second to build up or settle (HERO-6).
    walk: { bob: 0.012, sway: 0.016, blend: 3.5 },
    turn: 4,
    radius: 0.72,
    height: 0.86,
    scale: PALADIN_SCALE,
    weapon: 'heroCannon',
    shapes: {
      // A reverse-jointed leg in three parts, so its knee bends and its foot plants (HERO-6): a thick thigh back and down
      // from the hip to the knee, a stout shin forward and down to the ankle, and a broad armoured foot that stays level.
      // Together at rest they make the leg as it always was. Shorter than before, so the hull rides low.
      thigh: () => {
        const s = shape();
        s.cyl(0.1, 0.15, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 14 });
        s.strut([0, 0, 0], PALADIN_KNEE3, 0.095, STEEL, { r2: 0.082 });
        s.box(0.2, 0.2, 0.13, 'team', { at: [-0.085, -0.12, 0], rot: [0, 0, 0.62], bevel: 0.2 });
        s.cyl(0.082, 0.14, GUN, { at: PALADIN_KNEE3, rot: [Math.PI / 2, 0, 0], seg: 12 });
        return s;
      },
      shin: () => {
        // From the knee (origin) to the ankle.
        const s = shape();
        s.strut([0, 0, 0], PALADIN_ANKLE3, 0.075, STEEL, { r2: 0.062 });
        s.box(0.11, 0.16, 0.1, STEEL2, { at: [0.1, -0.11, 0], rot: [0, 0, 0.83], bevel: 0.2 }); // shin guard
        s.tube(0.026, 0.22, GUN, { at: [0.08, -0.12, 0.07], rot: [0, 0, 0.9] }); // piston
        return s;
      },
      foot: () => {
        // From the ankle (origin): its sole lies PALADIN_SOLE below it.
        const s = shape();
        s.cyl(0.06, 0.12, GUN, { rot: [Math.PI / 2, 0, 0], seg: 10 }); // ankle joint
        s.box(0.28, 0.065, 0.21, STEEL2, { at: [0.03, -0.0275, 0], bevel: 0.2 }); // foot
        s.box(0.09, 0.05, 0.22, GUN, { at: [0.17, -0.035, 0], bevel: 0.2 }); // toe
        s.box(0.07, 0.05, 0.15, GUN, { at: [-0.11, -0.035, 0], bevel: 0.2 }); // heel spur
        return s;
      },
      hull: () => {
        const s = shape();
        // A long, low armoured hull: sloped glacis, flat roof, team panels and gold trim down its length.
        s.slab([[-0.46, -0.11], [0.32, -0.11], [0.48, -0.02], [0.36, 0.13], [-0.4, 0.14], [-0.5, 0.03]], 0.54, STEEL, { bevel: 0.03 });
        s.slab([[-0.32, 0.14], [0.24, 0.14], [0.19, 0.19], [-0.27, 0.19]], 0.38, 'team', { bevel: 0.02 });
        s.box(0.22, 0.05, 0.3, STEEL2, { at: [-0.08, 0.215, 0], bevel: 0.2 }); // command cupola
        s.box(0.012, 0.025, 0.2, CYAN, { at: [0.03, 0.225, 0], glow: true, bevel: 0 }); // cupola vision slit
        for (const z of [0.275, -0.275]) s.box(0.78, 0.014, 0.012, GOLD, { at: [-0.04, 0.08, z], bevel: 0 });
        for (const z of [0.275, -0.275]) for (const x of [-0.3, -0.1, 0.1]) s.box(0.16, 0.12, 0.015, 'team', { at: [x, -0.01, z], bevel: 0.2 }); // side skirts
        s.box(0.012, 0.035, 0.34, CYAN, { at: [0.43, 0.06, 0], rot: [0, 0, -0.9], glow: true, bevel: 0 }); // visor
        s.box(0.04, 0.03, 0.05, AMBER, { at: [0.47, -0.04, 0.18], glow: true, bevel: 0 }); // searchlights
        s.box(0.04, 0.03, 0.05, AMBER, { at: [0.47, -0.04, -0.18], glow: true, bevel: 0 });
        s.box(0.16, 0.13, 0.42, STEEL2, { at: [-0.5, 0.02, 0], bevel: 0.15 }); // engine block
        for (let i = 0; i < 3; i++) s.box(0.012, 0.09, 0.38, GUN, { at: [-0.59, 0.02 + (i - 1) * 0.032, 0], bevel: 0 });
        s.cyl(0.006, 0.34, DARK, { at: [-0.36, 0.33, 0.14], seg: 4 }); // antenna with a gold pennant
        s.box(0.06, 0.035, 0.004, GOLD, { at: [-0.33, 0.48, 0.14], bevel: 0 });
        return s;
      },
      pod: () => {
        // A shoulder mortar-style missile pod: a cluster of four long launch tubes in a gold-banded frame, cocked up so
        // the mouths point skyward and forward (HERO-8); a part of its own, so it is blown off when the Paladin dies (HERO-3).
        const s = shape();
        s.box(0.34, 0.15, 0.15, GUN, { bevel: 0.15 });
        for (const x of [-0.1, 0.06]) s.box(0.03, 0.17, 0.17, GOLD, { at: [x, 0, 0], bevel: 0 });
        for (const dy of [0.034, -0.034])
          for (const dz of [0.036, -0.036]) {
            s.tube(0.03, 0.12, DARK, { at: [0.23, dy, dz], seg: 8 }); // centred: spans 0.17 to 0.29, flush with the frame
            s.cyl(0.022, 0.012, RED, { at: [0.286, dy, dz], rot: [0, 0, Math.PI / 2], seg: 6, glow: true });
          }
        return s;
      },
      cradle: () => {
        // The cannons' cradle under the hull's nose: it swivels but does not recoil, so it never slides into the hull.
        const s = shape();
        s.box(0.18, 0.11, 0.38, STEEL2, { at: [0, 0, 0], bevel: 0.15 });
        s.cyl(0.06, 0.05, GUN, { at: [0, 0.075, 0], seg: 14 }); // swivel pin up into the hull
        return s;
      },
      barrel: () => {
        // Twin heavy cannons with muzzle brakes: they recoil through the cradle.
        const s = shape();
        for (const z of [0.13, -0.13]) {
          s.tube(0.036, 0.58, GUN, { at: [0.34, 0, z], r2: 0.04, seg: 12 });
          s.tube(0.05, 0.12, GUN, { at: [0.3, 0, z], seg: 12 });
          s.box(0.08, 0.075, 0.085, DARK, { at: [0.64, 0, z], bevel: 0.2 }); // muzzle brake
          s.box(0.02, 0.08, 0.1, GUN, { at: [0.61, 0, z], bevel: 0 });
        }
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          at: [0, 0.57, 0], // high enough that the feet stand on the ground, not in it
          kids: [
            {
              // The hull rides rigidly on its legs and never twists over them (AIM-2): the whole walker turns to face its
              // target, and only the cannon cradle under the nose swivels a little to finish the aim.
              geo: 'hull',
              kids: [
                { geo: 'pod', at: [-0.12, 0.2, 0.35], rot: [0, 0, PALADIN_POD_TILT], anim: { k: 'pod', open: 0.25 } },
                { geo: 'pod', at: [-0.12, 0.2, -0.35], rot: [0, 0, PALADIN_POD_TILT], anim: { k: 'pod', open: 0.25 } },
                {
                  geo: 'cradle',
                  at: [0.24, -0.18, 0],
                  anim: { k: 'turret', max: PALADIN_SWIVEL },
                  kids: [
                    {
                      geo: 'barrel',
                      anim: { k: 'barrel', recoil: 0.12 },
                      kids: [
                        { muzzle: true, at: [0.69, 0, 0.13] },
                        { muzzle: true, at: [0.69, 0, -0.13] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        // Four legs beside the long hull's corners, their thighs just clear of its sides, splayed a little outward, stepping
        // in a smooth diagonal trot. They hang clear of the hull's sides, so the hull can rock with a shot without cutting
        // into them (AIM-2). Each foot stays planted while the hull passes over it (HERO-6).
        // The front feet stand a little ahead of their hips and the hind feet a little behind, so a hind foot swinging
        // forward never treads on the front foot on its side as that one leaves the ground.
        paladinLeg(0.38, 1, 0, 0.03),
        paladinLeg(0.38, -1, Math.PI, 0.03),
        paladinLeg(-0.42, 1, Math.PI, -0.03),
        paladinLeg(-0.42, -1, 0, -0.03),
      ],
    },
  };
}

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
function sixLegs(xs: readonly number[], y: number, z: number | readonly number[], amp: number, lift: number): RigNode[] {
  const out: RigNode[] = [];
  xs.forEach((x, i) => {
    const zi = typeof z === 'number' ? z : (z[i] as number);
    out.push({ geo: 'legR', at: [x, y, zi], anim: { k: 'gait', axis: 'y', amp, phase: i % 2 ? Math.PI : 0, lift } });
    out.push({ geo: 'legL', at: [x, y, -zi], anim: { k: 'gait', axis: 'y', amp: -amp, phase: i % 2 ? 0 : Math.PI, lift } });
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
            // Knuckles that rest on the ground rather than in it, swinging clear of the legs (AIM-2).
            { geo: 'arm', at: [0.2, 0.14, 0.36], anim: { k: 'gait', axis: 'z', amp: 0.45, phase: 0 } },
            { geo: 'arm', at: [0.2, 0.14, -0.36], anim: { k: 'gait', axis: 'z', amp: 0.45, phase: Math.PI } },
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

/** Where the gorger's head hinges on its body, and how far it nods to disgorge, radians: a small nod, the body stays level (R3D-22, R3D-31). */
export const GORGER_NECK = 0.4;
export const GORGER_BOW = 0.28;

/** Swollen chitin segments along the gorger's back, [x, radius] each, with team plates on top. */
function gorgerSegments(s: Shape, seg: readonly (readonly [number, number])[]): Shape {
  for (const [x, r] of seg) {
    s.ball(r, CHITIN, { at: [x, 0, 0], scale: [1, 0.78, 1], seg: 12 });
    s.ball(r * 0.98, 'teamDark', { at: [x, 0.02, 0], scale: [0.85, 0.76, 0.85], seg: 12, cut: 0.35 });
    s.ball(r * 0.25, 'team', { at: [x, r * 0.76, 0], scale: [1.6, 0.4, 1], seg: 8 });
  }
  return s;
}

/** Shard finish for the gorger's claw rakes: darker and glossier than the chitin, a blue-violet gunmetal that still sits in its family. */
const SHARD = 0x2e3156;
const SHARD2 = 0x3a4670;
/** The lustrous facet on a rake's upper face. */
const SHARD_LUST = 0x6a7fb0;
/** The colour between chitin and shard, worn at the wrist where the two blend. */
const SHARD_JOINT = 0x3b2b55;
/** Faint crystal-teal edge light on the rakes; deliberately dim. */
const SHARD_GLOW = 0x22918a;

/** A claw's upper limb or forearm: a thick tapered chitin link along +X, with a jointed knob at the far end (the same language as `insectLeg`). */
function clawLink(len: number, r: number, color: number, knob: number): Shape {
  const s = shape();
  s.ball(r * 1.15, color, { seg: 6 });
  s.strut([0, 0, 0], [len, 0, 0], r, color, { r2: r * 0.72 });
  s.ball(r * 0.95, knob, { at: [len, 0, 0], seg: 6 });
  return s;
}

/** The end of a claw: a broad, flat, faceted rake of three shard tines fanned sideways, in three tones, with dim teal edge lights. Points along +X. */
function clawBlade(): Shape {
  const s = shape();
  const k = CLAW_SCALE;
  s.ball(0.07 * k, SHARD_JOINT, { at: [0.03 * k, 0, 0], scale: [1.2, 0.9, 1.1], seg: 6 });
  s.ball(0.085 * k, SHARD, { at: [0.11 * k, 0, 0], scale: [1.3, 0.55, 2.0], seg: 5 });
  for (const [yaw, len0, w0] of [[0, 0.38, 0.075], [0.42, 0.3, 0.065], [-0.42, 0.3, 0.065]] as const) {
    const len = len0 * k;
    const w = w0 * k;
    const cx = (0.1 + len0 / 2 * Math.cos(yaw)) * k;
    const cz = ((len0 / 2) * Math.sin(yaw) + yaw * 0.12) * k;
    const rot: [number, number, number] = [0, -yaw, -Math.PI / 2];
    // Wide, flat, four-sided: a dark body, a lustrous plate on the upper face, and a keel below.
    s.cone(w, len, yaw === 0 ? SHARD : SHARD2, { at: [cx, 0, cz], rot, scale: [1, 1, 0.4], seg: 4 });
    s.cone(w * 0.8, len * 0.92, SHARD_LUST, { at: [cx, 0.022 * k, cz], rot, scale: [1, 1, 0.3], seg: 4 });
    s.strut([0.14 * k, 0.012 * k, cz * 0.4], [(0.1 + len0 * 0.9 * Math.cos(yaw)) * k, 0.012 * k, ((len0 * 0.9) * Math.sin(yaw) + yaw * 0.12) * k], 0.0075 * k, SHARD_GLOW, { r2: 0.004 * k, seg: 4, glow: true });
  }
  return s;
}

/** Where a claw is rooted on the body: just behind the head, on the flank. */
export const CLAW_ROOT_X = 0.44;
export const CLAW_ROOT_Z = 0.2;
const CLAW_SWEEP = -1.2;
/** Start of the scoop: the limb points out to the side and a little back (rad from forward); it swings through CLAW_ARC to end pointing forward beside the mouth. */
const CLAW_OUT = 1.55;
const CLAW_ARC = 1.58;
/** The shoulder lowers by CLAW_LOWER and the elbow opens by CLAW_OPEN over the inward stroke; the dip trails the yaw by CLAW_DIP_LEAD rad so the rake is lowest as it closes. */
const CLAW_LOWER = 0.35;
const CLAW_OPEN = 0.12;
const CLAW_DIP_LEAD = Math.PI / 4;
const CLAW_RATE = 7.4;
/** The claws are drawn at this fraction of their first size. */
const CLAW_SCALE = 0.78;
const CLAW_UPPER = 0.23 * CLAW_SCALE;
const CLAW_FORE = 0.23 * CLAW_SCALE;

/**
 * One feeding claw (R3D-31): the gorger's front limb evolved to gather shards. Local X runs along the limb, so the root's
 * yaw points it sideways (+Z for `side` +1, -Z for -1). It stays on its own side of the body: held up and folded against
 * the flank at rest; feeding, it sweeps in from the side toward the mouth, a small dip
 * putting the rake on the crystals, then swings back out. The yaw only swings the limb fore and aft, never across the centre plane.
 */
function clawNode(side: number, phase: number): RigNode {
  const feed = (axis: 'y' | 'z', amp: number, ph: number): { k: 'feed'; axis: 'y' | 'z'; amp: number; rate: number; phase: number } => ({ k: 'feed', axis, amp, rate: CLAW_RATE, phase: ph });
  return {
    at: [CLAW_ROOT_X, -0.02, side * CLAW_ROOT_Z],
    // Out to the side and a little forward at rest; the sweep turns it further forward, in toward the mouth.
    rot: [0, -side * CLAW_OUT, 0],
    anim: feed('y', side * CLAW_ARC, phase + CLAW_SWEEP),
    kids: [
      {
        // Shoulder: the limb is held up at rest and lowered onto the crystals as it reaches.
        rot: [0, 0, 1.25],
        anim: feed('z', -CLAW_LOWER, phase + CLAW_SWEEP + CLAW_DIP_LEAD),
        kids: [
          {
            geo: 'clawUpper',
            kids: [
              {
                // Elbow: folded at rest, opens to reach.
                at: [CLAW_UPPER, 0, 0],
                rot: [0, 0, -1.95],
                anim: feed('z', CLAW_OPEN, phase + CLAW_SWEEP + CLAW_DIP_LEAD + 0.3),
                kids: [{ geo: 'clawFore', kids: [{ geo: 'clawBlade', at: [CLAW_FORE, 0, 0], rot: [0, 0, 0.6] }] }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function gorger(): RigDef {
  const WAVE = 5.7;
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
      // Three swollen segments, team plates on top; each is its own part so a wave can run through them (R3D-31).
      seg2: () => gorgerSegments(shape(), [[0, 0.24]]),
      seg1: () => gorgerSegments(shape(), [[0, 0.28]]),
      seg0: () => gorgerSegments(shape(), [[0, 0.2]]),
      head: () => {
        // The maw; it nods a little into a refinery's feeding maw to disgorge (R3D-22).
        const s = shape();
        s.ring(0.12, 0.035, BONE, { at: [0.6, -0.02, 0], rot: [0, 0, Math.PI / 2], seg: 12 }); // maw
        s.cyl(0.1, 0.02, FLESH, { at: [0.62, -0.02, 0], rot: [0, 0, Math.PI / 2], seg: 10 });
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          s.cone(0.02, 0.07, BONE, { at: [0.64, -0.02 + Math.sin(a) * 0.09, Math.cos(a) * 0.09], rot: [0, 0, -Math.PI / 2], seg: 4 });
        }
        for (const z of [0.12, -0.12]) s.ball(0.022, GREEN, { at: [0.52, 0.1, z], seg: 6, glow: true });
        return s;
      },
      throat: () => {
        // A muscular collar behind the maw that pulses with each swallow.
        const s = shape();
        s.ring(0.15, 0.04, FLESH, { rot: [0, 0, Math.PI / 2], seg: 14 });
        return s;
      },
      clawUpper: () => clawLink(CLAW_UPPER, 0.056 * CLAW_SCALE, CHITIN2, CHITIN),
      clawFore: () => clawLink(CLAW_FORE, 0.052 * CLAW_SCALE, CHITIN, SHARD_JOINT),
      clawBlade,
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
          // Level, always: it only sways slowly from side to side (R3D-31).
          anim: { k: 'body', level: true, sway: 0.05 },
          at: [0, 0.3, 0],
          kids: [
            ...sixLegs([0.35, 0.02, -0.32], -0.06, 0.16, 0.3, 0.04),
            // The belly sac swells as the gorger feeds; its segments pulse in a wave front to back as it empties.
            { geo: 'cargo', anim: { k: 'cargo', pivot: [0.05, 0.2, 0], swell: true } },
            { geo: 'seg2', at: [-0.38, 0, 0], anim: { k: 'pulse', rate: WAVE, phase: 2, wave: 0.08 } },
            { geo: 'seg1', at: [0.05, 0, 0], anim: { k: 'pulse', rate: WAVE, phase: 1, wave: 0.08 } },
            { geo: 'seg0', at: [0.4, 0, 0], anim: { k: 'pulse', rate: WAVE, phase: 0, wave: 0.08, swallow: 0.05 } },
            // Unloading, the head nods a little about its neck into the maw (R3D-22); the body never bows.
            {
              geo: 'head',
              anim: { k: 'tip', pivot: [GORGER_NECK, 0, 0], max: -GORGER_BOW },
              kids: [
                { geo: 'throat', at: [0.55, -0.02, 0], anim: { k: 'pulse', rate: 7.4, phase: -0.6, swallow: 0.28 } },
              ],
            },
            // The claws are the front limb pair, rooted on the body's flanks just behind the head, so they stay put when the head nods.
            clawNode(1, 0),
            clawNode(-1, 0.18),
          ],
        },
      ],
    },
  };
}

/**
 * Dreadstrider, the Vrax hero (HERO-2): a towering six-legged bio-walker. Its armoured carapace rides high on long,
 * jointed legs that plant far out to the sides; bone plates and spines crown its back over glowing acid vents, and an
 * underslung acid cannon on a swivelling mount sweeps beneath its head.
 */
function strider(): RigDef {
  const LEG = (side: number): Shape => insectLeg(side, 0.85, 0.86, 0.38, 0.075, CHITIN);
  return {
    move: 'walker',
    organic: true,
    stride: 0.85,
    turn: 4,
    radius: 0.95,
    height: 1.25,
    scale: 1.1,
    weapon: 'heroAcid',
    shapes: {
      legR: () => LEG(1),
      legL: () => LEG(-1),
      body: () => {
        const s = shape();
        // The carapace: a broad, layered shell with a pale belly and team-coloured blazes.
        s.ball(0.42, CHITIN, { at: [0, 0, 0], scale: [1.45, 0.55, 1.05], seg: 16 });
        s.ball(0.42, 'teamDark', { at: [0, 0.03, 0], scale: [1.38, 0.52, 0.98], seg: 16, cut: 0.4 });
        s.ball(0.38, BELLY, { at: [0, -0.06, 0], scale: [1.35, 0.4, 0.9], seg: 14 });
        for (const z of [0.3, -0.3]) s.ball(0.07, 'team', { at: [0.1, 0.16, z], scale: [3, 0.45, 0.8], seg: 8 });
        // Overlapping bone plates down the spine, each with a spike, and glowing acid vents between them.
        for (let i = 0; i < 4; i++) {
          const x = 0.36 - i * 0.24;
          s.ball(0.15, BONE, { at: [x, 0.2, 0], scale: [1.1, 0.35, 1.6], seg: 10 });
          s.cone(0.05, 0.26, BONE, { at: [x - 0.03, 0.34, 0], rot: [0, 0, 0.35], seg: 6 });
          if (i < 3) for (const z of [0.12, -0.12]) s.ball(0.035, ACID, { at: [x - 0.12, 0.2, z], seg: 6, glow: true });
        }
        // The head: low and armoured, with a ring of glowing eyes and mandibles.
        s.ball(0.17, CHITIN2, { at: [0.62, -0.06, 0], scale: [1.2, 0.8, 1.1], seg: 12 });
        for (const z of [0.07, 0.03, -0.03, -0.07]) s.ball(0.022, GREEN, { at: [0.78, -0.02 + Math.abs(z) * 0.4, z], seg: 6, glow: true });
        for (const z of [0.08, -0.08]) s.cone(0.03, 0.16, BONE, { at: [0.8, -0.16, z], rot: [0, 0, -2.2], seg: 6 });
        // A sac of acid under the tail.
        s.ball(0.16, SAC, { at: [-0.6, -0.08, 0], scale: [1.2, 0.9, 1], seg: 12 });
        s.ring(0.13, 0.012, ACID, { at: [-0.6, -0.04, 0], rot: [0, 0, Math.PI / 2], seg: 14, glow: true });
        return s;
      },
      turret: () => {
        // The cannon's mount: a fleshy swivel under the chest.
        const s = shape();
        s.ball(0.12, FLESH, { scale: [1.2, 0.8, 1.2], seg: 10 });
        s.ring(0.12, 0.015, BONE, { seg: 14 });
        return s;
      },
      barrel: () => {
        const s = shape();
        s.tube(0.07, 0.42, CHITIN2, { at: [0.2, 0, 0], r2: 0.09, seg: 10 });
        for (let i = 0; i < 3; i++) s.ring(0.085 - i * 0.006, 0.014, BONE, { at: [0.08 + i * 0.12, 0, 0], rot: [0, 0, Math.PI / 2], seg: 12 });
        s.cyl(0.06, 0.02, ACID, { at: [0.415, 0, 0], rot: [0, 0, Math.PI / 2], seg: 10, glow: true });
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          geo: 'body',
          at: [0, 0.885, 0], // feet on the ground, not in it
          kids: [
            // Hips at the shell's rim, spaced so neighbouring legs never cross; a short swing and a matching stride (AIM-2).
            ...sixLegs([0.48, 0.0, -0.48], -0.02, [0.3, 0.46, 0.3], 0.22, 0.12),
            {
              // A swivel under the head: the Dreadstrider turns its whole body to its target, so the cannon only finishes
              // the aim and never swings back through its own legs (AIM-2).
              anim: { k: 'turret', max: 0.5 },
              at: [0.42, -0.22, 0],
              geo: 'turret',
              kids: [{ geo: 'barrel', at: [0.05, -0.02, 0], rot: [0, 0, -0.12], anim: { k: 'barrel', recoil: 0.08 }, kids: [{ muzzle: true, at: [0.44, 0, 0] }] }],
            },
          ],
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
  hum_paladin: paladin,
  ali_skitter: skitterer,
  ali_spitter: spitter,
  ali_stalker: stalker,
  ali_brute: brute,
  ali_lobber: lobber,
  ali_gorger: gorger,
  ali_strider: strider,
};
