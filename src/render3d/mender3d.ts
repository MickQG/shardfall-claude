import { Shape, type V3 } from './kit';
import type { RigDef, RigNode } from './rig';

/**
 * The Field Mender (R3D-38): an Aegis utility vehicle in the grounded science-fiction style of R3D-35, an original design.
 * Six wheels in armoured hubs carry a long sealed chassis; a low wedge cab under a tinted canopy at the front, a taller
 * closed crew compartment at the back with a roof hatch whose light glows only while a squad is inside; and on a swivel at
 * the front of the compartment roof a jointed repair arm whose tool head turns toward what it mends. Sealed faceted panels,
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

/** Wheel radius and positions (R3D-38). */
const R = 0.13;
const AXLES = [0.48, 0.0, -0.48] as const;
const TRACK = 0.33;
/** Top of the crew compartment's roof, body frame. */
export const MENDER_ROOF = 0.64;
/** The arm's swivel on the compartment roof, body frame, and how far it turns either way (AIM-2): clear of nothing, it may turn all round. */
export const MENDER_SWIVEL: V3 = [-0.08, MENDER_ROOF, 0];
/** The arm's tip, where the repair stream leaves, in the swivel's frame (R3D-38). */
export const MENDER_TIP: V3 = [0.6, 0.11, 0];
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
    front ? { anim: { k: 'steer' }, at: [x, R, z], kids: [{ geo: 'wheel', anim: { k: 'wheel', r: R } }] } : { geo: 'wheel', at: [x, R, z], anim: { k: 'wheel', r: R } };
  const top = MENDER_ROOF;
  return {
    move: 'wheeled',
    turn: 5.5,
    radius: 0.78,
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
      // The repair arm on its swivel, in the swivel's frame: a turret block, two sealed arm segments meeting at a covered
      // joint, and a tool head with a green-blue emitter at the tip.
      arm: () => {
        const s = shape();
        s.cyl(0.075, 0.07, STEEL2, { at: [0, 0.05, 0], seg: 10 });
        s.box(0.12, 0.06, 0.12, 'team', { at: [0.01, 0.1, 0], bevel: 0.25 });
        const shoulder: V3 = [0.03, 0.12, 0];
        const elbow: V3 = [0.28, 0.3, 0];
        const wrist: V3 = [0.52, 0.17, 0];
        s.strut(shoulder, elbow, 0.03, STEEL, { r2: 0.026, seg: 8 });
        s.strut(elbow, wrist, 0.026, STEEL, { r2: 0.022, seg: 8 });
        s.ball(0.04, STEEL2, { at: elbow, seg: 8 });
        s.ball(0.032, STEEL2, { at: wrist, seg: 8 });
        // The tool head: a short housing pointing forward and down, its lit emitter at the tip.
        s.tube(0.035, 0.09, GUN, { at: [0.56, 0.14, 0], rot: [0, 0, -0.5], seg: 8 });
        s.cyl(0.024, 0.02, MEND_GLOW, { at: [MENDER_TIP[0] - 0.005, MENDER_TIP[1] + 0.008, 0], rot: [0, 0, 1.07], seg: 8, glow: true });
        s.box(0.06, 0.012, 0.02, CYAN, { at: [0.28, 0.33, 0], glow: true, bevel: 0 }); // a lit band on the joint cover
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
            { geo: 'arm', at: MENDER_SWIVEL, anim: { k: 'turret' } },
          ],
        },
      ],
    },
  };
}
