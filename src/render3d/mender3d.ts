import { Shape, type V3 } from './kit';
import type { RigDef, RigNode } from './rig';

/**
 * The Field Mender (R3D-38): an Aegis utility vehicle in the grounded science-fiction style of R3D-35, an original design.
 * Six wheels in armoured hubs carry a long sealed chassis; a low wedge cab under a tinted canopy at the front, a taller
 * closed crew compartment at the back with a roof hatch whose light glows only while a squad is inside; and on a swivel at
 * the front of the compartment roof a long crane arm (boom, stick and tool head) that rests folded on the roof and, while
 * it mends, swings toward the vehicle, unfolds and pitches its tool head down at it. Sealed faceted panels,
 * cyan-lit details, team colour on the flank belts and the arm; no exhaust stack, exposed rams, stowage or crew.
 */

const STEEL = 0x8b938d;
const STEEL2 = 0x646c68;
const GUN = 0x3b4248;
const DARK = 0x202428;
const RUBBER = 0x1a1a1c;
const CANOPY = 0x2c3a48;
const CYAN = 0x6fe2ff;
const AMBER = 0xffb347;
const RED = 0xff4a3a;
/** The Mender's own panels: a pale utility grey with a darker trim, and the green-blue of its repair light. */
const PALE = 0xa9b2ad;
const PALE2 = 0x8e9893;
export const MEND_GLOW = 0x4fffd0;

/** The Mender is drawn at four fifths of its modelled size, smaller than a Bulwark tank (R3D-38). Wheels roll by the scaled radius. */
export const MENDER_SCALE = 0.8;
/** Wheel radius and positions (R3D-38). */
const R = 0.13;
const AXLES = [0.48, 0.0, -0.48] as const;
const TRACK = 0.33;
/** Top of the crew compartment's roof, body frame. */
export const MENDER_ROOF = 0.64;
/** The arm's swivel on the compartment roof, body frame, and how far it turns either way (AIM-2): clear of nothing, it may turn all round. */
export const MENDER_SWIVEL: V3 = [-0.08, MENDER_ROOF, 0];
/** The crane arm (R3D-38): the boom's shoulder pin in the swivel's frame, and the boom's and the stick's lengths. */
export const MENDER_SHOULDER: V3 = [0, 0.16, 0];
export const MENDER_BOOM = 0.57;
export const MENDER_STICK = 0.46;
/** The stick hangs beside the boom (its own side of the elbow), so the arm folds flat on the roof. */
const STICK_SIDE = 0.068;
/**
 * The joints' turns, radians, folded and unfolded: folded, the boom lies back over the roof and the stick and tool head
 * fold forward beside it; unfolded, the boom rises forward and the stick and tool reach out and down. Unfolded, the stick
 * also pitches toward what it mends, within `lo`..`hi` (R3D-38, AIM-2).
 */
export const MENDER_JOINTS = {
  boom: { fold: Math.PI - 0.06, out: 0.8 },
  stick: { fold: -Math.PI + 0.1, out: -1.35, lo: -0.35, hi: 0.2 },
  tool: { fold: 0, out: -0.55 },
} as const;
/** The tool head's tip, where the repair stream leaves, in the tool head's frame (R3D-38). */
export const MENDER_TIP: V3 = [0.15, 0, 0];
/** The roof hatch, body frame: where the hatch light glows and where the passenger's shots leave (R3D-38). */
export const MENDER_HATCH: V3 = [-0.4, MENDER_ROOF + 0.03, 0];

const shape = (): Shape => new Shape();

/** A tyre in an armoured hub with a small lit core, like the hauler's (R3D-35). */
function hubTire(r: number, w: number): Shape {
  const s = shape();
  s.cyl(r, w, RUBBER, { rot: [Math.PI / 2, 0, 0], seg: 14 });
  s.cyl(r * 0.68, w + 0.014, STEEL2, { rot: [Math.PI / 2, 0, 0], seg: 8 });
  s.cyl(r * 0.16, w + 0.03, CYAN, { rot: [Math.PI / 2, 0, 0], seg: 6, glow: true });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    s.box(0.03, 0.022, w + 0.006, RUBBER, { at: [Math.cos(a) * r, Math.sin(a) * r, 0], rot: [0, 0, a], bevel: 0 });
  }
  return s;
}

export function mender(): RigDef {
  const wheel = (x: number, z: number, front: boolean): RigNode =>
    front ? { anim: { k: 'steer' }, at: [x, R, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: R * MENDER_SCALE } }] } : { geo: 'wheel', at: [x, R, z], anim: { k: 'wheel', r: R * MENDER_SCALE } };
  const top = MENDER_ROOF;
  return {
    move: 'wheeled',
    turn: 5.5,
    scale: MENDER_SCALE,
    radius: 0.62,
    height: 0.86,
    loadedOnly: ['lamp'],
    shapes: {
      wheel: () => hubTire(R, 0.11),
      body: () => {
        const s = shape();
        // The sealed chassis between the wheels.
        s.box(1.2, 0.12, 0.5, GUN, { at: [0, 0.26, 0], bevel: 0.15 });
        // An armoured belt along each flank over the wheels: team colour with a lit seam.
        for (const z of [0.31, -0.31]) {
          s.slab([[-0.7, 0.3], [0.68, 0.3], [0.74, 0.35], [0.68, 0.41], [-0.66, 0.41], [-0.72, 0.36]], 0.06, PALE2, { at: [0, 0, z], bevel: 0.01 });
          s.box(1.1, 0.032, 0.064, 'team', { at: [0, 0.37, z], bevel: 0 });
          s.box(1.1, 0.008, 0.064, CYAN, { at: [0, 0.31, z], glow: true, bevel: 0 });
        }
        // The low wedge cab at the front, under a tinted canopy, with a team roof plate.
        s.slab([[0.14, 0.33], [0.7, 0.33], [0.76, 0.38], [0.66, 0.5], [0.14, 0.52]], 0.56, PALE, { bevel: 0.02 });
        s.slab([[0.2, 0.5], [0.6, 0.5], [0.44, 0.6], [0.24, 0.61], [0.2, 0.57]], 0.44, CANOPY, { bevel: 0.015 });
        s.box(0.2, 0.014, 0.36, 'team', { at: [0.32, 0.615, 0], bevel: 0.2 });
        for (const z of [0.18, -0.18]) s.box(0.014, 0.03, 0.07, AMBER, { at: [0.765, 0.4, z], glow: true, bevel: 0 });
        // The closed crew compartment at the back: taller, with faceted shoulders and no windows.
        s.slab([[-0.72, 0.33], [0.14, 0.33], [0.14, top - 0.04], [0.1, top], [-0.64, top], [-0.72, top - 0.08]], 0.56, PALE, { bevel: 0.02 });
        for (const z of [0.285, -0.285]) s.box(0.62, 0.05, 0.02, PALE2, { at: [-0.3, top - 0.1, z], bevel: 0 }); // shoulder ridges
        // A side door outline on each flank (sealed), with a lit handle strip.
        for (const z of [0.282, -0.282]) {
          s.box(0.24, 0.2, 0.012, PALE2, { at: [-0.34, 0.5, z], bevel: 0 });
          s.box(0.06, 0.01, 0.016, CYAN, { at: [-0.28, 0.5, z], glow: true, bevel: 0 });
        }
        // The roof hatch: a raised round rim and its cover.
        s.cyl(0.11, 0.03, STEEL2, { at: [MENDER_HATCH[0], top + 0.015, 0], seg: 12 });
        s.cyl(0.085, 0.022, STEEL, { at: [MENDER_HATCH[0], top + 0.035, 0], seg: 12 });
        // The arm's swivel ring on the roof.
        s.cyl(0.1, 0.03, DARK, { at: [MENDER_SWIVEL[0], top + 0.015, 0], seg: 12 });
        // A sensor bar across the back and tail lights.
        s.box(0.04, 0.03, 0.3, DARK, { at: [-0.7, top - 0.02, 0], bevel: 0.2 });
        s.box(0.012, 0.012, 0.24, CYAN, { at: [-0.72, top - 0.02, 0], glow: true, bevel: 0 });
        for (const z of [0.2, -0.2]) s.box(0.012, 0.025, 0.05, RED, { at: [-0.725, 0.38, z], glow: true, bevel: 0 });
        return s;
      },
      // The hatch light: shown only while a squad is inside (a cargo node, R3D-38).
      lamp: () => {
        const s = shape();
        s.cyl(0.05, 0.02, AMBER, { seg: 10, glow: true });
        s.cyl(0.075, 0.006, AMBER, { at: [0, -0.008, 0], seg: 12, glow: true });
        return s;
      },
      // The arm's swivel: a turret block with one cheek plate carrying the shoulder pin.
      arm: () => {
        const s = shape();
        s.cyl(0.075, 0.07, STEEL2, { at: [0, 0.035, 0], seg: 10 });
        s.box(0.14, 0.07, 0.13, 'team', { at: [0, 0.1, 0], bevel: 0.25 });
        s.box(0.08, 0.1, 0.02, STEEL2, { at: [0, 0.15, -0.055], bevel: 0.1 });
        s.cyl(0.022, 0.1, DARK, { at: [MENDER_SHOULDER[0], MENDER_SHOULDER[1], -0.015], rot: [Math.PI / 2, 0, 0], seg: 8 });
        return s;
      },
      // The boom, along +X from the shoulder: a sealed beam with a team plate, its hydraulic ram and the elbow joint.
      boom: () => {
        const s = shape();
        const L = MENDER_BOOM;
        s.strut([0, 0, 0], [L, 0, 0], 0.034, STEEL, { r2: 0.027, seg: 8 });
        s.box(0.3, 0.016, 0.05, 'team', { at: [0.24, 0.03, 0], bevel: 0 });
        s.cyl(0.018, 0.16, GUN, { at: [0.12, -0.04, -0.02], rot: [0, 0, Math.PI / 2 - 0.05], seg: 6 }); // ram cylinder
        s.strut([0.2, -0.036, -0.02], [0.34, -0.026, -0.02], 0.01, STEEL2, { seg: 5 }); // its rod
        s.box(0.06, 0.012, 0.012, CYAN, { at: [0.4, 0.03, 0], glow: true, bevel: 0 });
        s.ball(0.042, STEEL2, { at: [L, 0, 0], seg: 8 });
        s.cyl(0.02, 0.08, DARK, { at: [L, 0, 0.035], rot: [Math.PI / 2, 0, 0], seg: 8 }); // elbow pin
        return s;
      },
      // The stick, along +X from the elbow, beside the boom.
      stick: () => {
        const s = shape();
        s.ball(0.034, STEEL2, { seg: 8 });
        s.strut([0, 0, 0], [MENDER_STICK, 0, 0], 0.026, STEEL, { r2: 0.022, seg: 8 });
        s.box(0.16, 0.012, 0.036, 'team', { at: [0.2, 0.024, 0], bevel: 0 });
        s.box(0.05, 0.01, 0.01, CYAN, { at: [0.33, 0.022, 0], glow: true, bevel: 0 });
        return s;
      },
      // The tool head at the end of the stick: a wrist, a short housing and the green-blue emitter at its tip.
      tool: () => {
        const s = shape();
        s.ball(0.03, STEEL2, { seg: 8 });
        s.tube(0.034, 0.1, GUN, { at: [0.07, 0, 0], r2: 0.026, seg: 8 });
        s.cyl(0.024, 0.02, MEND_GLOW, { at: [MENDER_TIP[0] - 0.02, 0, 0], rot: [0, 0, Math.PI / 2], seg: 8, glow: true });
        return s;
      },
    },
    root: {
      kids: [
        ...AXLES.flatMap((x, i) => [wheel(x, TRACK, i === 0), wheel(x, -TRACK, i === 0)]),
        {
          anim: { k: 'body' },
          geo: 'body',
          kids: [
            { geo: 'lamp', at: [MENDER_HATCH[0], MENDER_HATCH[1] + 0.025, 0], anim: { k: 'cargo', pivot: [0, 0, 0] } },
            {
              geo: 'arm',
              at: MENDER_SWIVEL,
              anim: { k: 'turret' },
              kids: [
                {
                  geo: 'boom',
                  at: MENDER_SHOULDER,
                  anim: { k: 'crane', ...MENDER_JOINTS.boom },
                  kids: [
                    {
                      geo: 'stick',
                      at: [MENDER_BOOM, 0, STICK_SIDE],
                      anim: { k: 'crane', ...MENDER_JOINTS.stick },
                      kids: [{ geo: 'tool', at: [MENDER_STICK, 0, 0], anim: { k: 'crane', ...MENDER_JOINTS.tool } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
