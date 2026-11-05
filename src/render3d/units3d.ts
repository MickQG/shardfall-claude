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
/** Rocketeers' heavier gunmetal fatigues. */
const HEAVY_CLOTH = 0x4a4f58;
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

/**
 * Hammer Artillery: a self-propelled gun, unmistakably not a tank. A big armoured crew cab sits up front; the gun stands
 * on an open turntable deck at the back behind side shields, its long barrel raised steeply over the cab; recoil
 * outriggers and ammunition racks flank the deck.
 */
function artillery(): RigDef {
  return {
    move: 'tracked',
    turn: 5,
    radius: 0.76,
    height: 0.62,
    weapon: 'howitzer',
    shapes: {
      track: () => trackShape(1.3, 0.14, 0.16),
      roadwheel: () => roadWheel(0.058, 0.04),
      hull: () => {
        const s = shape();
        s.slab([[-0.64, 0.08], [0.52, 0.08], [0.66, 0.15], [0.56, 0.22], [-0.64, 0.22]], 0.6, STEEL, { bevel: 0.022 });
        for (const z of [0.35, -0.35]) s.slab([[-0.62, 0.11], [0.54, 0.11], [0.6, 0.19], [-0.62, 0.2]], 0.03, 'team', { at: [0, 0, z], bevel: 0.01 });
        // The crew cab: tall, armoured, with a wraparound visor and a team-coloured roof.
        s.slab([[0.12, 0.22], [0.58, 0.22], [0.62, 0.3], [0.5, 0.44], [0.14, 0.44]], 0.56, STEEL2, { bevel: 0.02 });
        s.box(0.012, 0.05, 0.46, CYAN, { at: [0.565, 0.36, 0], glow: true, bevel: 0 });
        for (const z of [0.285, -0.285]) s.box(0.24, 0.04, 0.008, CYAN, { at: [0.36, 0.38, z], glow: true, bevel: 0 });
        s.box(0.34, 0.02, 0.5, 'team', { at: [0.33, 0.45, 0], bevel: 0.3 });
        s.cyl(0.006, 0.36, DARK, { at: [0.2, 0.62, 0.22], seg: 4 }); // antenna
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.64, 0.18, 0.2], glow: true, bevel: 0 });
        s.box(0.02, 0.03, 0.05, AMBER, { at: [0.64, 0.18, -0.2], glow: true, bevel: 0 });
        // The open gun deck at the back: grated floor, ammunition racks along both sides.
        s.box(0.7, 0.025, 0.62, DARK, { at: [-0.3, 0.235, 0], bevel: 0.1 });
        for (const z of [0.27, -0.27]) for (let i = 0; i < 4; i++) s.cyl(0.028, 0.12, HAZARD, { at: [-0.56 + i * 0.07, 0.3, z], seg: 6 });
        // Recoil outriggers folded down at the rear corners, and the spade between them.
        for (const z of [0.3, -0.3]) {
          s.box(0.3, 0.04, 0.05, GUN, { at: [-0.74, 0.14, z], rot: [0, z > 0 ? -0.45 : 0.45, 0.35] });
          s.box(0.1, 0.02, 0.1, DARK, { at: [-0.87, 0.04, z * 1.3] });
        }
        s.box(0.2, 0.05, 0.42, DARK, { at: [-0.7, 0.1, 0], rot: [0, 0, 0.6] });
        return s;
      },
      turret: () => {
        // The gun mount: a turntable with a low ring and shields on both sides of the breech.
        const s = shape();
        s.cyl(0.24, 0.06, STEEL2, { at: [0, 0.03, 0], seg: 16 });
        s.cyl(0.25, 0.02, 'team', { at: [0, 0.07, 0], seg: 16 });
        for (const z of [0.15, -0.15]) s.slab([[-0.22, 0.06], [0.2, 0.06], [0.14, 0.28], [-0.16, 0.24]], 0.03, STEEL, { at: [0, 0, z], bevel: 0.01 });
        s.box(0.14, 0.1, 0.12, GUN, { at: [-0.18, 0.12, 0] }); // breech and loader
        s.box(0.012, 0.03, 0.05, AMBER, { at: [-0.25, 0.14, 0.1], glow: true, bevel: 0 });
        return s;
      },
      barrel: () => {
        const s = shape();
        s.box(0.16, 0.14, 0.18, STEEL2, { at: [0.02, 0, 0] }); // cradle
        s.tube(0.036, 0.9, GUN, { at: [0.5, 0, 0], r2: 0.042, seg: 10 });
        s.tube(0.024, 0.55, STEEL2, { at: [0.32, -0.06, 0], seg: 6 }); // recoil cylinder
        s.tube(0.05, 0.12, GUN, { at: [0.6, 0, 0], seg: 10 }); // fume extractor
        s.box(0.1, 0.075, 0.1, DARK, { at: [0.96, 0, 0], bevel: 0.2 }); // muzzle brake
        return s;
      },
    },
    root: {
      kids: [
        {
          anim: { k: 'body' },
          kids: [
            ...runningGear(1.3, 0.29, 0.058, 6, 0.08),
            { geo: 'hull' },
            {
              anim: { k: 'turret' },
              at: [-0.34, 0.25, 0],
              geo: 'turret',
              // Trunnions high on the mount; the barrel rises steeply over the cab.
              kids: [{ geo: 'barrel', at: [0.02, 0.2, 0], rot: [0, 0, 0.62], anim: { k: 'barrel', recoil: 0.16 }, kids: [{ muzzle: true, at: [1.02, 0, 0] }] }],
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
        s.box(1.36, 0.18, 0.4, GUN, { at: [0, 0.2, 0], bevel: 0.15 }); // frame, between the wheels and up to the cab and bed
        s.slab([[0.36, 0.29], [0.66, 0.29], [0.7, 0.34], [0.6, 0.48], [0.36, 0.5]], 0.56, 'team', { bevel: 0.02 }); // cab, clear of the wheel tops
        s.slab([[0.58, 0.36], [0.66, 0.36], [0.61, 0.46], [0.55, 0.46]], 0.48, GLASS, { at: [0.012, 0, 0], bevel: 0.005 }); // windscreen
        s.box(0.06, 0.03, 0.1, AMBER, { at: [0.5, 0.5, 0], glow: true, bevel: 0.3 }); // beacon
        s.box(0.02, 0.04, 0.08, AMBER, { at: [0.7, 0.22, 0.18], glow: true, bevel: 0 });
        s.box(0.02, 0.04, 0.08, AMBER, { at: [0.7, 0.22, -0.18], glow: true, bevel: 0 });
        s.cyl(0.025, 0.3, GUN, { at: [0.33, 0.42, 0.22], seg: 8 }); // exhaust stack
        s.box(0.12, 0.03, 0.56, STEEL2, { at: [0.74, 0.12, 0], bevel: 0.2 }); // cutter arms
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.785, 0.2, 0.12], glow: true, bevel: 0 }); // tail lights
        s.box(0.015, 0.025, 0.05, RED, { at: [-0.785, 0.2, -0.12], glow: true, bevel: 0 });
        s.cyl(0.03, 0.14, GUN, { at: [-0.62, 0.26, 0.2], rot: [0, 0, 0.5], seg: 8 }); // tipping rams
        s.cyl(0.03, 0.14, GUN, { at: [-0.62, 0.26, -0.2], rot: [0, 0, 0.5], seg: 8 });
        return s;
      },
      bed: () => {
        // The ore bed: a sloped steel bin with team bands and hazard stripes, hinged at the back to tip.
        const s = shape();
        s.slab([[-0.66, 0.3], [0.3, 0.3], [0.34, 0.54], [-0.7, 0.54]], 0.6, STEEL, { bevel: 0.025 }); // floor clear of the wheel tops
        s.box(1.0, 0.04, 0.62, 'team', { at: [-0.18, 0.52, 0], bevel: 0.25 });
        for (let i = 0; i < 5; i++) s.box(0.06, 0.02, 0.625, i % 2 ? DARK : HAZARD, { at: [-0.6 + i * 0.07, 0.33, 0], bevel: 0 });
        s.box(0.9, 0.02, 0.5, DARK, { at: [-0.18, 0.545, 0], bevel: 0 }); // hopper mouth
        s.box(0.06, 0.24, 0.56, STEEL2, { at: [-0.72, 0.42, 0], bevel: 0.2 }); // tail gate
        return s;
      },
      drum: () => {
        // A toothed cutter drum across the front that chews crystals off the ground.
        const s = shape();
        s.cyl(0.07, 0.5, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 10 });
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          s.box(0.03, 0.03, 0.46, i % 2 ? HAZARD : GUN, { at: [Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0], rot: [0, 0, a], bevel: 0 });
        }
        return s;
      },
      cargo: () => {
        const s = shape();
        // A heap of crystals standing proud of the hopper when full (it rises from the floor with the load).
        for (let i = 0; i < 9; i++) {
          const x = -0.58 + (i % 3) * 0.25 + (i % 2) * 0.04;
          const z = (Math.floor(i / 3) - 1) * 0.16;
          const tilt: [number, number, number] = [0.35 * (i % 2 ? 1 : -1), 0, 0.25 * ((i % 3) - 1)];
          s.cyl(0.05, 0.2, 0x47e8c4, { at: [x, 0.6, z], rot: tilt, seg: 6 });
          s.cone(0.05, 0.09, 0x7ff0dc, { at: [x, 0.74, z], rot: tilt, seg: 6 });
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
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            { geo: 'drum', at: [0.8, 0.1, 0], anim: { k: 'drum' } },
            // The bed tips back about its rear hinge to unload; the crystal pile rides in it and rises as it fills.
            { geo: 'bed', anim: { k: 'tip', pivot: [-0.72, 0.3, 0], max: 0.7 }, kids: [{ geo: 'cargo', anim: { k: 'cargo', pivot: [-0.25, 0.52, 0] } }] },
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
/** How far out the Paladin's hips sit from the hull's centre line: beside the hull, not under it (AIM-2). */
const PALADIN_HIP = 0.38;

function paladin(): RigDef {
  const GOLD = 0xd8b24a;
  return {
    move: 'walker',
    // A long, unhurried stride: the legs swing less per step and the cycle is slower, so the walk reads heavy and smooth.
    stride: 2.0,
    turn: 4,
    radius: 0.72,
    height: 0.86,
    scale: 2.2,
    weapon: 'heroCannon',
    shapes: {
      leg: () => {
        // Hip joint at the origin; a thick thigh back and down to a reverse knee, a stout shin forward and down to a broad
        // armoured foot. Shorter than before, so the hull rides low.
        const s = shape();
        s.cyl(0.1, 0.15, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 14 });
        s.strut([0, 0, 0], [-0.17, -0.24, 0], 0.095, STEEL, { r2: 0.082 });
        s.box(0.2, 0.2, 0.13, 'team', { at: [-0.085, -0.12, 0], rot: [0, 0, 0.62], bevel: 0.2 });
        s.cyl(0.082, 0.14, GUN, { at: [-0.17, -0.24, 0], rot: [Math.PI / 2, 0, 0], seg: 12 });
        s.strut([-0.17, -0.24, 0], [0.03, -0.46, 0], 0.075, STEEL, { r2: 0.062 });
        s.box(0.11, 0.16, 0.1, STEEL2, { at: [-0.07, -0.35, 0], rot: [0, 0, 0.83], bevel: 0.2 }); // shin guard
        s.tube(0.026, 0.22, GUN, { at: [-0.09, -0.36, 0.07], rot: [0, 0, 0.9] }); // piston
        s.box(0.32, 0.065, 0.21, STEEL2, { at: [0.06, -0.48, 0], bevel: 0.2 }); // foot
        s.box(0.09, 0.05, 0.22, GUN, { at: [0.23, -0.495, 0], bevel: 0.2 }); // toe
        s.box(0.08, 0.05, 0.15, GUN, { at: [-0.1, -0.495, 0], bevel: 0.2 }); // heel spur
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
        // A shoulder missile pod for aircraft, with glowing tube mouths; a part of its own, so it is blown off when the
        // Paladin dies (HERO-3).
        const s = shape();
        s.box(0.3, 0.14, 0.13, GUN, { bevel: 0.15 });
        s.box(0.3, 0.012, 0.135, GOLD, { at: [0, 0.075, 0], bevel: 0 });
        for (const dy of [0.033, -0.033]) for (const dz of [0.032, -0.032]) s.cyl(0.02, 0.012, RED, { at: [0.155, dy, dz], rot: [0, 0, Math.PI / 2], seg: 6, glow: true });
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
                { geo: 'pod', at: [-0.04, 0.17, 0.35] },
                { geo: 'pod', at: [-0.04, 0.17, -0.35] },
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
        // Four legs beside the long hull's corners, their thighs just clear of its sides, splayed a little outward, stepping in a smooth diagonal
        // trot. They hang clear of the hull's sides, so the hull can rock with a shot without cutting into them (AIM-2).
        { geo: 'leg', at: [0.34, 0.53, PALADIN_HIP], rot: [-0.16, 0, 0], anim: { k: 'gait', axis: 'z', amp: 0.24, phase: 0, lift: 0.045, ease: true } },
        { geo: 'leg', at: [0.34, 0.53, -PALADIN_HIP], rot: [0.16, 0, 0], anim: { k: 'gait', axis: 'z', amp: 0.24, phase: Math.PI, lift: 0.045, ease: true } },
        { geo: 'leg', at: [-0.38, 0.53, PALADIN_HIP], rot: [-0.16, 0, 0], anim: { k: 'gait', axis: 'z', amp: 0.24, phase: Math.PI, lift: 0.045, ease: true } },
        { geo: 'leg', at: [-0.38, 0.53, -PALADIN_HIP], rot: [0.16, 0, 0], anim: { k: 'gait', axis: 'z', amp: 0.24, phase: 0, lift: 0.045, ease: true } },
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
          // The glowing belly sac swells as the gorger feeds.
          kids: [...sixLegs([0.35, 0.02, -0.32], -0.06, 0.16, 0.3, 0.04), { geo: 'cargo', anim: { k: 'cargo', pivot: [0.05, 0.2, 0], swell: true } }],
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
