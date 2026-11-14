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
/** Vehicle colour schemes (R3D-23): the tank clean green, the buggy sand with a bold dark stripe, the artillery pale; solid panels, no camouflage. */
const TANK_GREEN = 0x5d7a4a;
const TANK_GREEN2 = 0x4a6339;
const TANK_DARK = 0x33432b;
const BUGGY_SAND = 0xcdb47c;
const BUGGY_SAND2 = 0xa88e58;
const BUGGY_STRIPE = 0x262b33;
const BUGGY_WHITE = 0xece6d4;
const ARTY_SLATE = 0x4b525c;
const ARTY_PALE = 0xb4bcc2;
const ARTY_PALE2 = 0x9ba6af;
const ARTY_LIGHT = 0xcfd5d9;
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
        { geo: 'leg', at: [0, 0.182, 0.026], anim: { k: 'gait', axis: 'z', amp: 0.3, phase: 0, kneel: 0.85, drop: 0.07, carry: true } },
        { geo: 'leg', at: [0, 0.182, -0.026], anim: { k: 'gait', axis: 'z', amp: 0.3, phase: Math.PI, kneel: -0.85, drop: 0.07, carry: true } },
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
  // Seen only below the skirts, in the hull's shadow: casts none of its own (PERF-4).
  s.cyl(r, w, GUN, { rot: [Math.PI / 2, 0, 0], seg: 12, shadow: false });
  s.cyl(r * 0.45, w + 0.01, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 6, shadow: false });
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

/**
 * Bulwark Tank (R3D-36): a low, wide battle tank, an original design. Full-length armoured skirts hide the tracks but
 * for their lower run; a flat wedge-shaped turret with no hatches sits mid-hull under one heavy cannon in a ribbed
 * accelerator sleeve with a cyan-lit breech; a sensor blister and a blade antenna stand where a cupola would, and a lit
 * power vent sits at the rear. Green panels, team colour on the skirts and the turret plate.
 */
function tank(): RigDef {
  return {
    move: 'tracked',
    turn: 6,
    radius: 0.72,
    height: 0.52,
    weapon: 'cannon',
    shapes: {
      // Only the lower run of the track shows under the skirt: a plain dark bed.
      track: () => {
        const s = shape();
        s.box(1.16, 0.15, 0.17, TREAD, { bevel: 0.45 });
        return s;
      },
      roadwheel: () => {
        const s = shape();
        // Seen only below the skirt, in the shadow of the hull: it casts none of its own (PERF-4).
        s.cyl(0.07, 0.04, GUN, { rot: [Math.PI / 2, 0, 0], seg: 8, shadow: false });
        s.cyl(0.032, 0.05, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 5, shadow: false });
        return s;
      },
      hull: () => {
        const s = shape();
        // A low faceted wedge: sloped glacis, flat deck, angled tail.
        s.slab([[-0.56, 0.1], [0.5, 0.1], [0.64, 0.17], [0.46, 0.27], [-0.5, 0.29], [-0.6, 0.2]], 0.6, TANK_GREEN, { bevel: 0.025 });
        // A lighter deck plate over the middle and a dark lower glacis.
        s.hull([[-0.4, -0.25], [0.36, -0.25], [0.44, -0.12], [0.44, 0.12], [0.36, 0.25], [-0.4, 0.25], [-0.46, 0.14], [-0.46, -0.14]], 0.02, TANK_GREEN2, { at: [0, 0.28, 0], bevel: 0.006 });
        s.slab([[0.5, 0.1], [0.64, 0.17], [0.58, 0.2], [0.5, 0.2]], 0.56, TANK_DARK, { bevel: 0 });
        // Full-length armoured skirts over the tracks, in team colour, with a faceted nose and tail and a dark lower edge.
        for (const z of [0.375, -0.375]) {
          s.slab([[-0.58, 0.1], [0.5, 0.1], [0.6, 0.17], [0.52, 0.27], [-0.5, 0.27], [-0.6, 0.2]], 0.04, 'team', { at: [0, 0, z], bevel: 0.008 });
          s.box(1.0, 0.014, 0.046, TANK_DARK, { at: [-0.02, 0.108, z], bevel: 0 });
          s.box(0.014, 0.05, 0.048, CYAN, { at: [0.58, 0.19, z], glow: true, bevel: 0 }); // running lights
        }
        // The rear power vent: a dark louvred housing with a lit core.
        s.box(0.14, 0.04, 0.3, DARK, { at: [-0.4, 0.3, 0], bevel: 0.2 });
        s.box(0.012, 0.022, 0.24, CYAN, { at: [-0.472, 0.3, 0], glow: true, bevel: 0 });
        for (let i = 0; i < 3; i++) s.box(0.012, 0.012, 0.28, GUN, { at: [-0.445 + i * 0.045, 0.325, 0], bevel: 0 });
        s.box(0.12, 0.004, 0.25, CYAN, { at: [-0.4, 0.3215, 0], glow: true, bevel: 0 }); // the lit core, seen between the louvres from above
        // Panel seams on the deck: across it ahead of the turret, and along it either side of the vent.
        s.box(0.01, 0.004, 0.44, TANK_DARK, { at: [0.38, 0.301, 0], bevel: 0 });
        for (const z of [0.17, -0.17]) s.box(0.3, 0.004, 0.01, TANK_DARK, { at: [-0.3, 0.301, z], bevel: 0 });
        return s;
      },
      turret: () => {
        const s = shape();
        // A flat wedge: a broad low base, then a roof that rises from the gun to the tail. No hatches.
        s.hull([[0.3, -0.13], [0.3, 0.13], [0.18, 0.23], [-0.22, 0.23], [-0.32, 0.15], [-0.32, -0.15], [-0.22, -0.23], [0.18, -0.23]], 0.09, TANK_GREEN, { bevel: 0.02 });
        s.hull([[0.27, -0.1], [0.27, 0.1], [0.16, 0.2], [-0.2, 0.2], [-0.29, 0.13], [-0.29, -0.13], [-0.2, -0.2], [0.16, -0.2]], 0.014, 'team', { at: [0, 0.09, 0], bevel: 0 });
        s.slab([[-0.28, 0], [0.26, 0], [0.12, 0.06], [-0.22, 0.1]], 0.3, TANK_GREEN2, { at: [0, 0.104, 0], bevel: 0.015 });
        // A sensor blister on the roof, a short blade antenna, and a small lit vent at the tail.
        s.ball(0.045, CANOPY, { at: [0.02, 0.17, -0.1], scale: [1.3, 0.8, 1], cut: 0.55, seg: 8 });
        s.box(0.012, 0.014, 0.05, CYAN, { at: [0.068, 0.178, -0.1], glow: true, bevel: 0 });
        s.box(0.02, 0.16, 0.012, DARK, { at: [-0.2, 0.26, 0.1], rot: [0, 0, 0.12], bevel: 0 });
        s.box(0.012, 0.02, 0.14, CYAN, { at: [-0.322, 0.13, 0], glow: true, bevel: 0 });
        return s;
      },
      barrel: () => {
        const s = shape();
        s.box(0.1, 0.1, 0.16, TANK_DARK, { at: [0.02, 0, 0], bevel: 0.3 }); // mantlet
        s.box(0.05, 0.018, 0.1, CYAN, { at: [0.0, 0.058, 0], glow: true, bevel: 0 }); // lit breech
        s.tube(0.036, 0.52, GUN, { at: [0.31, 0, 0], r2: 0.04 });
        // The ribbed accelerator sleeve: collars along the thick barrel with thin lit gaps.
        for (let i = 0; i < 4; i++) s.tube(0.052, 0.03, STEEL2, { at: [0.18 + i * 0.1, 0, 0], seg: 8, shadow: false });
        for (const x of [0.23, 0.33, 0.43]) s.tube(0.043, 0.012, CYAN, { at: [x, 0, 0], seg: 8, glow: true });
        s.tube(0.048, 0.06, DARK, { at: [0.585, 0, 0], seg: 8, shadow: false }); // muzzle collar
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          kids: [
            ...runningGear(1.16, 0.29, 0.07, 5, 0.085),
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
 * Hammer Artillery (R3D-32): a long-barrelled coil-gun artillery piece, an original design. A long, low tracked hull on
 * seven road wheels under armoured skirts carries a large, enclosed, faceted turret set toward the rear; the long, round
 * barrel, out of a rounded breech housing with a few cyan-lit coil rings along it, reaches out over the hull front and
 * rests in a travel lock on the glacis until the gun has a target. Sealed pale shells, no open deck, no outriggers, no crew. The barrel rides an
 * elevating cradle, so shots leave the muzzle at its current angle.
 */
/** Barrel elevation in the travel lock (nearly level) and fully raised, radians (R3D-32). */
export const HAMMER_LOCK = 0.035;
export const HAMMER_RAISED = 0.68;
/** Where the barrel hinges in the turret, and the muzzle's distance along the barrel from that hinge (R3D-32). */
export const HAMMER_TRUNNION: V3 = [0.44, 0.2, 0];
export const HAMMER_MUZZLE = 1.14;
/** Where along the barrel its lit coil rings stand: few and wide-spaced, unlike the tank's close-ribbed sleeve (R3D-32). */
const COILS = [0.54, 0.76, 0.98] as const;

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
        // The faceted hull: a low pale wedge with a shallow glacis, wide enough to roof the tracks.
        s.slab([[-0.74, 0.15], [0.7, 0.15], [0.8, 0.2], [0.46, 0.3], [-0.7, 0.3], [-0.76, 0.24]], 0.74, ARTY_PALE2, { bevel: 0.03 });
        // A lighter, chamfered deck plate, and the dark lower glacis.
        s.hull([[-0.68, -0.3], [0.4, -0.3], [0.48, -0.2], [0.48, 0.2], [0.4, 0.3], [-0.68, 0.3], [-0.73, 0.2], [-0.73, -0.2]], 0.02, ARTY_LIGHT, { at: [0, 0.3, 0], bevel: 0.005 });
        s.slab([[0.7, 0.15], [0.8, 0.2], [0.74, 0.23], [0.7, 0.23]], 0.7, ARTY_SLATE, { bevel: 0 });
        // Armoured skirts over the tracks with a team stripe; the road wheels show below them.
        for (const z of [0.385, -0.385]) {
          s.slab([[-0.74, 0.1], [0.72, 0.1], [0.78, 0.17], [0.7, 0.28], [-0.72, 0.28], [-0.78, 0.2]], 0.04, ARTY_PALE, { at: [0, 0, z], bevel: 0.008 });
          s.box(1.0, 0.03, 0.046, 'team', { at: [-0.04, 0.2, z], bevel: 0 });
          s.box(1.0, 0.012, 0.046, ARTY_SLATE, { at: [-0.04, 0.108, z], bevel: 0 });
          s.box(0.014, 0.04, 0.046, CYAN, { at: [0.775, 0.19, z], glow: true, bevel: 0 }); // running lights
        }
        // The travel lock on the glacis: two posts and a saddle the barrel rests on.
        for (const z of [0.07, -0.07]) s.box(0.07, 0.15, 0.035, GUN, { at: [0.52, 0.375, z], bevel: 0.2 });
        s.box(0.1, 0.025, 0.2, DARK, { at: [0.52, 0.4625, 0], bevel: 0.2 });
        // A driver's sensor blister on the glacis and a sealed, lit power vent at the stern.
        s.ball(0.05, CANOPY, { at: [0.36, 0.31, 0.2], scale: [1.4, 0.7, 1.2], cut: 0.55, seg: 8 });
        s.box(0.012, 0.016, 0.07, CYAN, { at: [0.41, 0.322, 0.2], glow: true, bevel: 0 });
        s.box(0.3, 0.025, 0.34, DARK, { at: [-0.5, 0.32, 0], bevel: 0.2 });
        s.box(0.012, 0.016, 0.28, CYAN, { at: [-0.652, 0.32, 0], glow: true, bevel: 0 });
        for (const x of [-0.6, -0.5, -0.4]) s.box(0.03, 0.006, 0.26, CYAN, { at: [x, 0.334, 0], glow: true, bevel: 0 }); // its lit slots, seen from above
        // Faceting: raised wedge plates on the glacis either side of the lock, and dark seams where deck and glacis meet
        // and along the deck.
        for (const z of [0.2, -0.2]) s.slab([[0.44, 0.3], [0.5, 0.3], [0.76, 0.212], [0.76, 0.228], [0.58, 0.322], [0.44, 0.322]], 0.16, ARTY_PALE, { at: [0, 0, z], bevel: 0.01 });
        s.box(0.012, 0.006, 0.6, ARTY_SLATE, { at: [0.48, 0.322, 0], bevel: 0 });
        for (const z of [0.12, -0.12]) s.box(0.5, 0.005, 0.01, ARTY_SLATE, { at: [0.1, 0.322, z], bevel: 0 });
        for (const z of [0.18, -0.18]) s.box(0.016, 0.02, 0.04, CYAN, { at: [0.8, 0.2, z], glow: true, bevel: 0 });
        s.box(0.012, 0.03, 0.1, RED, { at: [-0.762, 0.22, 0.14], glow: true, bevel: 0 });
        s.box(0.012, 0.03, 0.1, RED, { at: [-0.762, 0.22, -0.14], glow: true, bevel: 0 });
        return s;
      },
      turret: () => {
        // Large, enclosed and angular: a chamfered plan block with a sloped roof wedge, a sensor array and a capacitor housing.
        const s = shape();
        s.cyl(0.3, 0.04, STEEL2, { at: [0, 0.02, 0], seg: 16 });
        s.hull([[-0.38, -0.18], [-0.3, -0.26], [0.26, -0.26], [0.36, -0.14], [0.36, 0.14], [0.26, 0.26], [-0.3, 0.26], [-0.38, 0.18]], 0.26, ARTY_PALE, { at: [0, 0.04, 0], bevel: 0.02 });
        s.slab([[-0.32, 0], [0.3, 0], [0.12, 0.09], [-0.26, 0.09]], 0.36, ARTY_PALE2, { at: [0, 0.29, 0], bevel: 0.015 });
        s.box(0.4, 0.012, 0.08, 'team', { at: [-0.04, 0.385, 0], bevel: 0 });
        // The capacitor housing at the rear: a boxed bank of three cells with lit faces at the back and lit tops, seen from above.
        s.box(0.1, 0.26, 0.38, ARTY_SLATE, { at: [-0.42, 0.2, 0], bevel: 0.15 });
        for (const z of [-0.11, 0, 0.11]) {
          s.box(0.012, 0.13, 0.05, CYAN, { at: [-0.472, 0.18, z], glow: true, bevel: 0 });
          s.box(0.06, 0.006, 0.07, CYAN, { at: [-0.43, 0.333, z], glow: true, bevel: 0 });
        }
        s.box(0.012, 0.016, 0.32, CYAN, { at: [-0.472, 0.3, 0], glow: true, bevel: 0 });
        // A dark seam across the roof wedge where its sloped front meets the top.
        s.box(0.01, 0.006, 0.34, ARTY_SLATE, { at: [0.11, 0.384, 0], bevel: 0 });
        // The sensor array on the roof: a dark mount carrying a tilted panel with three lenses, and a small lit dome beside it.
        s.box(0.12, 0.03, 0.2, ARTY_SLATE, { at: [0.0, 0.395, 0.08], bevel: 0.2 });
        s.box(0.13, 0.018, 0.22, GUN, { at: [0.06, 0.42, 0.08], rot: [0, 0, -0.4], bevel: 0.3 });
        for (const z of [0.0, 0.08, 0.16]) s.box(0.014, 0.024, 0.05, CYAN, { at: [0.122, 0.425, z], rot: [0, 0, -0.4], glow: true, bevel: 0 });
        s.ball(0.04, CANOPY, { at: [-0.14, 0.39, -0.12], scale: [1.2, 0.8, 1.2], cut: 0.55, seg: 8 });
        s.box(0.01, 0.014, 0.05, CYAN, { at: [-0.1, 0.396, -0.12], glow: true, bevel: 0 });
        s.box(0.02, 0.16, 0.012, DARK, { at: [-0.3, 0.46, 0.2], rot: [0, 0, 0.1], bevel: 0 }); // short blade antenna
        // Faceted cheek plates on the flanks, each with a light strip.
        for (const z of [0.272, -0.272]) {
          s.slab([[-0.26, 0.07], [0.2, 0.07], [0.28, 0.15], [0.2, 0.26], [-0.26, 0.26]], 0.03, ARTY_PALE2, { at: [0, 0, z], bevel: 0.008 });
          s.box(0.3, 0.012, 0.006, CYAN, { at: [-0.04, 0.2, z + Math.sign(z) * 0.016], glow: true, bevel: 0 });
        }
        return s;
      },
      cradle: () => {
        const s = shape();
        s.box(0.22, 0.12, 0.14, STEEL2, { at: [0.01, 0, 0], bevel: 0.25 });
        for (const z of [0.07, -0.07]) s.box(0.1, 0.09, 0.015, GUN, { at: [0.01, 0, z] }); // trunnion cheeks
        return s;
      },
      barrel: () => {
        // The coil gun: a long, round barrel of moderate thickness, slimmer and longer than the tank's cannon, out of a rounded
        // breech housing; three wide-spaced collars carry its lit coil rings, and a plain collar defines the muzzle.
        const s = shape();
        s.tube(0.038, 0.88, GUN, { at: [0.71, 0, 0], r2: 0.033, seg: 12 });
        s.tube(0.068, 0.26, ARTY_SLATE, { at: [0.15, 0, 0], r2: 0.064, seg: 14 }); // the breech housing
        s.ball(0.064, ARTY_SLATE, { at: [0.28, 0, 0], scale: [0.7, 1, 1], seg: 12 }); // its rounded nose
        s.tube(0.07, 0.016, CYAN, { at: [0.1, 0, 0], seg: 14, glow: true }); // a lit band round it
        for (const x of COILS) {
          s.tube(0.054, 0.08, ARTY_SLATE, { at: [x, 0, 0], seg: 12 });
          s.tube(0.057, 0.024, CYAN, { at: [x, 0, 0], seg: 12, glow: true });
        }
        s.tube(0.042, 0.065, DARK, { at: [1.112, 0, 0], r2: 0.046, seg: 12 }); // the muzzle collar
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

/**
 * Where the hauler's hopper hinges to tip and how far it tips up at the front to unload, radians: about 45 degrees, the
 * hinge at the hopper's rear floor edge (R3D-30). The hopper's back is raked forward, so as it tips the top of that back
 * comes up over the hinge rather than swinging out behind the hauler into the refinery (R3D-22).
 */
export const HAULER_HOPPER: [number, number, number] = [-0.42, 0.33, 0];
export const HAULER_TIP = 0.785;
/** Where the rear hatch hinges (the top of the raked back) and how far it folds up and forward over the open bed; the head's arms pivot at HAULER_ARM: body-frame points (R3D-30). */
export const HAULER_HATCH: [number, number, number] = [-0.155, 0.675, 0];
/** The top of the hopper's walls, body frame: above the cab roof, so the bin and its glowing load read as the hauler's biggest part. */
const HOPPER_TOP = 0.675;
/** The raked back: its length from the hinge to the hatch's hinge, and how much of it at the bottom is fixed (the rest is the hatch). */
const RAKE_DIR: [number, number] = [HAULER_HATCH[0] - HAULER_HOPPER[0], HAULER_HATCH[1] - HAULER_HOPPER[1]];
const RAKE_LEN = Math.hypot(...RAKE_DIR);
const BACK_LOW = 0.15;
/** A body-frame point on the raked back, `along` it from the hinge and `out` from its middle toward its outer (rear) face. */
const rakeAt = (along: number, out = 0): V3 => {
  const [dx, dy] = [RAKE_DIR[0] / RAKE_LEN, RAKE_DIR[1] / RAKE_LEN];
  return [HAULER_HOPPER[0] + dx * along - dy * out, HAULER_HOPPER[1] + dy * along + dx * out, 0];
};
export const HAULER_HATCH_SWING = 1.5;
export const HAULER_ARM: V3 = [0.84, 0.27, 0];
/** Where the cooling vent breathes its vapour on throttle (R3D-30): a body-frame point on the cab's rear deck. */
export const HAULER_VENT: V3 = [0.27, 0.56, 0.165];
/** How far a lowered head's arms turn down from level, and how far the arms rise to clear the ground, radians (R3D-30). */
const HEAD_DOWN = -0.445;
const HEAD_UP = 0.645;
/** The shard colours of the load and the lit rims: the same glowing colours the crystals themselves wear. */
const LOAD = 0x47e8c4;
const LOAD2 = 0x7ff0dc;

/** A tyre in an armoured hub: a guard ring and cap over the rim with a small lit core (R3D-30). */
function hubTire(r: number, w: number): Shape {
  const s = shape();
  s.cyl(r, w, RUBBER, { rot: [Math.PI / 2, 0, 0], seg: 14 });
  s.cyl(r * 0.68, w + 0.014, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 8 });
  s.cyl(r * 0.46, w + 0.03, STEEL, { rot: [Math.PI / 2, 0, 0], seg: 8 });
  s.cyl(r * 0.16, w + 0.04, CYAN, { rot: [Math.PI / 2, 0, 0], seg: 6, glow: true });
  // Tread blocks so the spin reads.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.box(0.03, 0.022, w + 0.006, RUBBER, { at: [Math.cos(a) * r, Math.sin(a) * r, 0], rot: [0, 0, a], bevel: 0 });
  }
  return s;
}

/**
 * Shard Hauler (R3D-30): a heavy, sealed mining machine, an original design. Six large wheels in armoured hubs carry a
 * long sealed chassis; a wedge cab under a tinted canopy sits at the front-left like the Scout Buggy's, behind it a
 * smooth-sided hopper with a lit rim. Across the front, an enclosed drum housing hangs on two sealed arms: raised clear
 * while driving, lowered onto the ground to mine, feeding a covered conveyor with an open window strip that carries the
 * crystals up into the hopper. To unload the whole hopper tips up at the front about its rear hinge and the hatch folds
 * clear. No exhaust stack, no exposed hydraulics.
 */
function hauler(): RigDef {
  const R = 0.14;
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, R, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: R } }] } : { geo: 'wheel', at: [x, R, z], anim: { k: 'wheel', r: R } };
  const BELT = -0.4636;
  const CZ = -0.13;
  /** A point on the conveyor in its own frame (u along the belt, v up from it), as a body-frame position. */
  const bp = (u: number, v: number, w: number): V3 => [0.62 + u * Math.cos(BELT) - v * Math.sin(BELT), 0.5 + u * Math.sin(BELT) + v * Math.cos(BELT), w];
  // The raked back of the hopper runs from the hinge up and forward to the hatch's hinge.
  const RAKE = -Math.atan2(HAULER_HATCH[0] - HAULER_HOPPER[0], HAULER_HATCH[1] - HAULER_HOPPER[1]);
  return {
    move: 'wheeled',
    turn: 5,
    radius: 0.85,
    height: 0.78,
    shapes: {
      wheel: () => hubTire(R, 0.12),
      body: () => {
        const s = shape();
        s.box(1.26, 0.12, 0.54, GUN, { at: [0.2, 0.27, 0], bevel: 0.15 }); // the sealed chassis between the wheels
        s.box(0.1, 0.12, 0.6, GUN, { at: [0.88, 0.27, 0], bevel: 0.2 }); // nose and arm mounts
        // A continuous armoured belt along each flank, over the wheels, with a team stripe and a lit seam.
        for (const z of [0.32, -0.32]) {
          s.slab([[-0.43, 0.315], [0.82, 0.315], [0.88, 0.36], [0.82, 0.415], [-0.4, 0.415], [-0.43, 0.38]], 0.07, STEEL, { at: [0, 0, z], bevel: 0.01 });
          s.box(1.0, 0.03, 0.074, 'team', { at: [0.18, 0.375, z], bevel: 0 });
          s.box(1.0, 0.008, 0.074, CYAN, { at: [0.18, 0.324, z], glow: true, bevel: 0 });
        }
        // The fixed bulkhead in front of the hopper.
        s.box(0.04, 0.3, 0.6, STEEL, { at: [0.2, 0.47, 0], bevel: 0.2 });
        // The wedge cab, front-left: a faceted nose under a tinted canopy, a team roof plate and a lit strip.
        s.slab([[0.24, 0.33], [0.8, 0.33], [0.86, 0.38], [0.78, 0.5], [0.24, 0.5]], 0.27, STEEL, { at: [0, 0, 0.165], bevel: 0.02 });
        s.slab([[0.32, 0.5], [0.7, 0.5], [0.54, 0.66], [0.36, 0.67], [0.32, 0.62]], 0.25, CANOPY, { at: [0, 0, 0.165], bevel: 0.015 });
        s.box(0.24, 0.015, 0.25, 'team', { at: [0.43, 0.675, 0.165], bevel: 0.2 });
        s.box(0.2, 0.01, 0.02, CYAN, { at: [0.43, 0.684, 0.165], glow: true, bevel: 0 });
        for (const z of [0.09, 0.24]) s.box(0.014, 0.03, 0.05, AMBER, { at: [0.86, 0.4, z], glow: true, bevel: 0 });
        // The cooling vent on the cab's rear deck: a louvred housing with a lit slot.
        s.box(0.06, 0.05, 0.2, DARK, { at: [HAULER_VENT[0], 0.525, 0.165], bevel: 0.2 });
        s.box(0.012, 0.012, 0.16, CYAN, { at: [0.3, 0.55, 0.165], glow: true, bevel: 0 });
        // The covered conveyor from the head up into the hopper: a slim closed duct on the far side of the cab, its roof split
        // along the middle by an open window strip, lit at its edges, through which the crystals are seen riding up from
        // above. Its cleats are a separate scrolling part.
        const belt = (len: number, h: number, d: number, paint: number | 'team', u: number, v: number, w: number, glow = false): void => {
          s.box(len, h, d, paint, { at: bp(u, v, w), rot: [0, 0, BELT], bevel: glow ? 0 : 0.15, glow });
        };
        belt(1.0, 0.025, 0.14, DARK, 0, 0, CZ); // the bed
        for (const w of [0.062, -0.062]) belt(1.0, 0.1, 0.016, STEEL2, 0, 0.055, CZ + w); // the closed sides
        for (const w of [0.047, -0.047]) {
          belt(1.0, 0.016, 0.045, STEEL, 0, 0.11, CZ + w); // the roof either side of the window
          belt(0.96, 0.006, 0.006, LOAD, 0, 0.12, CZ + Math.sign(w) * 0.027, true); // a lit sill along each edge of the window
        }
        belt(0.06, 0.13, 0.17, STEEL2, -0.47, 0.055, CZ); // the hood over its top end, spilling into the hopper
        for (const x of [0.46, 0.8]) {
          const top = 0.5 - (x - 0.62) * 0.5 - 0.03; // up to just under the bed
          s.box(0.03, top - 0.33, 0.03, GUN, { at: [x, (top + 0.33) / 2, CZ], bevel: 0.2 });
        }
        for (const z of [0.14, -0.14]) s.box(0.012, 0.025, 0.05, RED, { at: [-0.435, 0.27, z], glow: true, bevel: 0 }); // tail lights
        return s;
      },
      hopper: () => {
        // The hopper: a smooth-sided bin with a floor, team bands and a lit rim. It tips up at the front about a hinge at its
        // rear to unload; its back is raked forward and the lower part of it is fixed, the upper part being the hatch.
        // It is the biggest thing on the chassis: as wide as the hull belts, standing above the cab roof at the front.
        const s = shape();
        const top = HOPPER_TOP;
        s.box(0.58, 0.03, 0.62, STEEL, { at: [-0.13, 0.335, 0], bevel: 0.2 });
        for (const z of [0.31, -0.31]) {
          s.slab([[-0.42, 0.32], [0.16, 0.32], [0.16, top], [HAULER_HATCH[0], top], [HAULER_HATCH[0] - 0.02, top - 0.03]], 0.04, STEEL, { at: [0, 0, z], bevel: 0.01 });
          s.box(0.5, 0.08, 0.046, 'team', { at: [-0.1, 0.45, z], bevel: 0.2 });
          s.box(0.34, 0.016, 0.052, LOAD, { at: [0.0, top - 0.004, z], glow: true, bevel: 0 }); // the lit rim
        }
        s.box(0.04, top - 0.32, 0.62, STEEL, { at: [0.14, (top + 0.32) / 2, 0], bevel: 0.1 }); // the hopper's front wall
        s.box(0.012, 0.014, 0.64, LOAD, { at: [0.16, top - 0.012, 0], glow: true, bevel: 0 });
        // The fixed lower part of the raked back, from the hinge up along the rake.
        s.box(0.03, BACK_LOW, 0.62, STEEL, { at: rakeAt(BACK_LOW / 2), rot: [0, 0, RAKE], bevel: 0.15 });
        return s;
      },
      hatch: () => {
        // The rear hatch: the upper part of the raked back, hinged along its top edge; it folds up and forward over the open bed.
        const s = shape();
        s.box(0.03, RAKE_LEN - BACK_LOW - 0.005, 0.6, STEEL2, { at: rakeAt((RAKE_LEN + BACK_LOW) / 2), rot: [0, 0, RAKE], bevel: 0.15 });
        s.box(0.012, 0.012, 0.54, LOAD, { at: rakeAt(RAKE_LEN - 0.035, 0.018), rot: [0, 0, RAKE], glow: true, bevel: 0 });
        return s;
      },
      head: () => {
        // The harvesting head, in the arms' own frame (X along the arms, pivot at the origin): two sealed arms and an
        // enclosed housing over the back and sides of the drum at the far end.
        const s = shape();
        for (const z of [0.27, -0.27]) {
          s.box(0.36, 0.08, 0.06, STEEL2, { at: [0.18, 0, z], bevel: 0.3 });
          s.cyl(0.052, 0.07, STEEL, { at: [0, 0, z], rot: [Math.PI / 2, 0, 0], seg: 8 });
          s.cyl(0.15, 0.025, STEEL2, { at: [0.36, 0.04, z * 1.1], rot: [Math.PI / 2, 0, 0], seg: 10 }); // the housing's side plate
          s.cyl(0.04, 0.03, CYAN, { at: [0.36, 0.04, z * 1.1 + Math.sign(z) * 0.012], rot: [Math.PI / 2, 0, 0], seg: 6, glow: true });
        }
        s.box(0.2, 0.03, 0.56, 'team', { at: [0.27, 0.17, 0], bevel: 0.2 }); // the roof of the housing
        s.box(0.16, 0.025, 0.56, STEEL2, { at: [0.43, 0.14, 0], rot: [0, 0, -0.55], bevel: 0.2 }); // its sloped front visor
        s.box(0.025, 0.3, 0.56, STEEL2, { at: [0.2, 0.03, 0], bevel: 0.2 }); // its closed back
        s.box(0.03, 0.04, 0.56, GUN, { at: [0.54, -0.07, 0], bevel: 0.2 }); // a low lip at the front
        s.box(0.06, 0.14, 0.24, DARK, { at: [0.22, 0.1, -0.13], bevel: 0.2 }); // the throat toward the conveyor
        return s;
      },
      drum: () => {
        // A toothed cutter drum across the front that chews crystals off the ground.
        const s = shape();
        s.cyl(0.085, 0.5, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 10 });
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          s.box(0.05, 0.045, 0.46, i % 2 ? STEEL : GUN, { at: [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], rot: [0, 0, a], bevel: 0 });
        }
        return s;
      },
      cleats: () => {
        // The conveyor's cleats, with crystals riding on them; the node slides them along the bed. The crystals glow.
        const s = shape();
        for (let i = 0; i < 10; i++) {
          const x = -0.45 + i * 0.1;
          s.box(0.02, 0.035, 0.1, GUN, { at: [x, 0.03, 0], bevel: 0 });
          // Each crystal rides up the middle, its tip in the roof's open window.
          s.cone(0.026, 0.07, i % 2 ? LOAD : LOAD2, { at: [x + 0.05, 0.055, ((i % 3) - 1) * 0.008], seg: 5, glow: true });
        }
        return s;
      },
      cargo: () => {
        const s = shape();
        // A heap of glowing crystals mounded well above the hopper's rim when full, filling its open top (it rises from the
        // floor with the load).
        for (let i = 0; i < 12; i++) {
          const cx = i % 4;
          const cz = Math.floor(i / 4);
          const x = -0.13 + cx * 0.075 + (cz % 2) * 0.03;
          const z = (cz - 1) * 0.19;
          const h = 0.3 + 0.17 * (1 - Math.abs(cx - 1.5) / 1.5) * (1 - Math.abs(cz - 1) * 0.5);
          const tilt: [number, number, number] = [0.3 * (i % 2 ? 1 : -1), 0, 0.22 * ((i % 3) - 1)];
          s.cyl(0.058, h, LOAD, { at: [x, 0.35 + h / 2, z], rot: tilt, seg: 6, glow: true });
          s.cone(0.058, 0.1, LOAD2, { at: [x, 0.35 + h + 0.035, z], rot: tilt, seg: 6, glow: true });
        }
        return s;
      },
    },
    root: {
      kids: [
        wheel(0.7, 0.34, true),
        wheel(0.7, -0.34, true),
        wheel(0.2, 0.34, false),
        wheel(0.2, -0.34, false),
        wheel(-0.3, 0.34, false),
        wheel(-0.3, -0.34, false),
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            // The head hangs lowered at rest and lifts clear on its arms while driving; the drum turns at its far end.
            { geo: 'head', at: HAULER_ARM, rot: [0, 0, HEAD_DOWN], anim: { k: 'arm', up: HEAD_UP, bob: 0.025 }, kids: [{ geo: 'drum', at: [0.36, 0, 0], anim: { k: 'drum' } }] },
            { geo: 'cleats', at: bp(0, 0.025, CZ), rot: [0, 0, BELT], anim: { k: 'scroll', pitch: 0.1, per: -0.045 } },
            // Unloading, the hopper tips up at the front about its rear hinge and its hatch folds up and forward, so the load
            // slides out of the back; the crystal heap sits in the hopper, rises as it fills, slides rearward as it empties and tips with it.
            {
              geo: 'hopper',
              anim: { k: 'tip', pivot: HAULER_HOPPER, max: HAULER_TIP },
              kids: [
                { geo: 'hatch', anim: { k: 'tip', pivot: HAULER_HATCH, max: HAULER_HATCH_SWING } },
                { geo: 'cargo', anim: { k: 'cargo', pivot: [-0.15, 0.35, 0], slide: 0.3 } },
              ],
            },
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
    anim: { k: 'step', carry: true, phase, fore, reach: PALADIN_STRIDE / (4 * PALADIN_SCALE), lift: 0.06, knee: PALADIN_KNEE, ankle: PALADIN_ANKLE, sole: PALADIN_SOLE },
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
        // A hip pin through the joint, reaching in to the hull's side so the leg stays joined to it (AIM-4) and out to a cap.
        s.cyl(0.055, 0.25, GUN, { rot: [Math.PI / 2, 0, 0], seg: 10 });
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
        { geo: 'leg', at: [-0.01, 0.2, 0.04], anim: { k: 'gait', axis: 'z', amp: 0.5, phase: 0, carry: true } },
        { geo: 'leg', at: [-0.01, 0.2, -0.04], anim: { k: 'gait', axis: 'z', amp: 0.5, phase: Math.PI, carry: true } },
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
        { geo: 'leg', at: [0.18, 0.31, 0.1], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: 0, carry: true } },
        { geo: 'leg', at: [0.18, 0.31, -0.1], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: Math.PI, carry: true } },
        { geo: 'leg', at: [-0.22, 0.31, 0.11], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: Math.PI, carry: true } },
        { geo: 'leg', at: [-0.22, 0.31, -0.11], anim: { k: 'gait', axis: 'z', amp: 0.75, phase: 0, carry: true } },
      ],
    },
  };
}

/**
 * The Brute (R3D-37): a hulking, hunched Vrax bruiser, an original design. A heavy torso under a team-coloured armoured
 * back with a hump of bone spikes, a low tusked head between massive shoulders and two long, heavy arms; it walks upright
 * on two thick legs. Every limb is a chain of rig nodes (shoulder, elbow, wrist; hip, knee, ankle) with a rounded knuckle at
 * each joint that the segments sink into, so it bends without ever coming apart (AIM-4). The legs hang from a hips node and
 * the torso sits on it, so the claw blow twists the torso over legs that stay planted and attached.
 */
/** Brute joints, each in the frame of the limb above it: elbow and wrist from the shoulder, knee and ankle from the hip. */
const BRUTE_SHOULDER: V3 = [0.2, 0.14, 0.31];
const BRUTE_ELBOW: V3 = [0.07, -0.26, 0];
const BRUTE_WRIST: V3 = [0.06, -0.25, 0];
const BRUTE_HIP: V3 = [-0.22, -0.04, 0.17];
const BRUTE_KNEE: V3 = [0.05, -0.17, 0];
const BRUTE_ANKLE: V3 = [-0.05, -0.12, 0];

function brute(): RigDef {
  /** One arm: shoulder, elbow and wrist nodes, with the blow's key angles on the striking side. */
  const arm = (side: 1 | -1, phase: number): RigNode => ({
    geo: 'uarm',
    at: [BRUTE_SHOULDER[0], BRUTE_SHOULDER[1], BRUTE_SHOULDER[2] * side],
    anim: { k: 'limb', axis: 'z', swing: 0.4, phase, side, wind: 1.9, hit: 0.75 },
    kids: [
      {
        geo: 'farm',
        at: BRUTE_ELBOW,
        anim: { k: 'limb', axis: 'z', swing: 0, phase, flex: 0.5, lag: Math.PI / 2, side, wind: 1.5, hit: 0.15 },
        kids: [{ geo: 'paw', at: [BRUTE_WRIST[0], BRUTE_WRIST[1] - 0.04, 0], anim: { k: 'limb', axis: 'z', swing: 0, phase, flex: 0.25, lag: Math.PI / 2, side, wind: 0.2, hit: -0.3 } }],
      },
    ],
  });
  /** One leg: hip, knee and ankle nodes; the knee folds back and the foot tips up as the leg swings forward. */
  const leg = (side: 1 | -1, phase: number): RigNode => ({
    geo: 'thigh',
    at: [BRUTE_HIP[0], BRUTE_HIP[1], BRUTE_HIP[2] * side],
    anim: { k: 'limb', axis: 'z', swing: 0.32, phase },
    kids: [
      {
        geo: 'shin',
        at: BRUTE_KNEE,
        anim: { k: 'limb', axis: 'z', swing: 0, phase, flex: -0.8, lag: Math.PI / 2 },
        kids: [{ geo: 'paw', at: BRUTE_ANKLE, anim: { k: 'limb', axis: 'z', swing: -0.15, phase, flex: 0.35, lag: Math.PI / 2 } }],
      },
    ],
  });
  return {
    move: 'walker',
    organic: true,
    stride: 0.75,
    turn: 5,
    radius: 0.8,
    height: 0.95,
    weapon: 'claw',
    shapes: {
      // Upper arm: a heavy strut from the shoulder sinking into the elbow knuckle, under a team-coloured shoulder plate.
      uarm: () => {
        const s = shape();
        s.strut([0, 0, 0], [BRUTE_ELBOW[0] * 0.9, BRUTE_ELBOW[1] * 0.9, 0], 0.1, CHITIN, { r2: 0.085, seg: 6 });
        s.ball(0.088, CHITIN2, { at: BRUTE_ELBOW, seg: 7, shadow: false });
        s.ball(0.15, CHITIN2, { seg: 8 }); // shoulder knuckle, concentric with the arm's turning point
        s.cyl(0.152, 0.1, 'team', { rot: [Math.PI / 2, 0, 0], seg: 10, shadow: false }); // a team-coloured shoulder plate, turning with the arm about its own axis // pauldron
        return s;
      },
      farm: () => {
        const s = shape();
        s.strut([BRUTE_WRIST[0] * 0.1, BRUTE_WRIST[1] * 0.1, 0], [BRUTE_WRIST[0] * 0.9, BRUTE_WRIST[1] * 0.9, 0], 0.082, CHITIN2, { r2: 0.07, seg: 6 });
        s.ball(0.076, CHITIN, { at: BRUTE_WRIST, seg: 7, shadow: false });
        return s;
      },
      thigh: () => {
        const s = shape();
        s.ball(0.09, CHITIN2, { seg: 8, shadow: false }); // the hip knuckle, turning about its own centre
        s.strut([0, 0, 0], BRUTE_KNEE, 0.085, CHITIN, { r2: 0.077, seg: 6 });
        s.ball(0.085, CHITIN2, { at: BRUTE_KNEE, seg: 7, shadow: false });
        return s;
      },
      shin: () => {
        const s = shape();
        s.strut([0, 0, 0], BRUTE_ANKLE, 0.07, CHITIN2, { r2: 0.056, seg: 6 });
        s.ball(0.058, CHITIN, { at: BRUTE_ANKLE, seg: 7, shadow: false });
        return s;
      },
      // A broad, three-clawed paw: the fist on each arm and the foot on each leg are this one shape (one draw call, R3D-13).
      paw: () => {
        const s = shape();
        s.ball(0.075, BELLY, { at: [0.06, -0.0085, 0], scale: [1.7, 0.65, 1.2], seg: 8 });
        for (const z of [-0.05, 0, 0.05]) s.cone(0.018, 0.08, BONE, { at: [0.17, -0.04, z], rot: [0, 0, -Math.PI / 2], seg: 5, shadow: false });
        return s;
      },
      body: () => {
        const s = shape();
        // A belly ball centred on the torso's own turning point, so the torso can turn and lean over the hips without ever
        // cutting into them, and reaching down to the hip knuckles of the thighs.
        s.ball(0.26, BELLY, { seg: 10 });
        s.ball(0.32, CHITIN, { at: [0, 0, 0], scale: [1.05, 0.8, 0.95], seg: 12, cut: 0.525 }); // torso, its underside left to the belly ball
        s.ball(0.32, 'teamDark', { at: [-0.04, 0.03, 0], scale: [1.0, 0.8, 0.82], seg: 10, cut: 0.38, shadow: false }); // back armour
        for (let i = 0; i < 4; i++) s.cone(0.05, 0.2 - i * 0.025, BONE, { at: [0.08 - i * 0.12, 0.28 - i * 0.02, 0], rot: [0, 0, 0.5], seg: 6, shadow: false }); // hump spikes
        for (const z of [0.18, -0.18]) s.cone(0.04, 0.16, BONE, { at: [0.06, 0.2, z], rot: [z > 0 ? 0.7 : -0.7, 0, 0.2], seg: 6, shadow: false });
                s.ball(0.12, CHITIN2, { at: [0.3, -0.06, 0], scale: [1.2, 0.85, 1], seg: 10 }); // head, low between the shoulders
        for (const z of [0.07, -0.07]) {
          s.cone(0.03, 0.18, BONE, { at: [0.42, -0.08, z], rot: [z > 0 ? 0.6 : -0.6, 0, -1.4], seg: 6, shadow: false }); // tusks
          s.ball(0.02, GREEN, { at: [0.42, -0.0, z * 0.6], seg: 6, glow: true });
        }
        // Glowing veins along the flanks.
        for (const z of [0.29, -0.29]) for (let i = 0; i < 3; i++) s.tube(0.012, 0.22, GREEN, { at: [-0.1 + i * 0.1, -0.05 + i * 0.03, z * (0.95 - i * 0.05)], rot: [0, 0, 0.5 - i * 0.3], glow: true, seg: 5 });
        return s;
      },
    },
    root: {
      kids: [
        {
          // The hips carry the legs and the torso; they ignore the lunge, so the legs stay put in a blow.
          anim: { k: 'body', still: true },
          at: [0, 0.38, 0],
          kids: [
            leg(1, Math.PI),
            leg(-1, 0),
            {
              // The torso twists and leans into each claw blow; the arms hang from it, swinging against the legs.
              anim: { k: 'torso', twist: 0.2, lean: 0.11, windTwist: -0.1, windLean: 0 },
              geo: 'body',
              at: [0, 0.12, 0],
              kids: [arm(1, 0), arm(-1, Math.PI), { muzzle: true, at: [0.5, -0.4, 0] }],
            },
          ],
        },
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
