import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural model kit (R3D-3): models are shaped from bevelled plates, cylinders, domes, lathed shells and extruded
 * hull outlines, each painted with a colour, the owner's team colour, or a glowing colour. A shape is built once per
 * team into two merged geometries: lit (shaded, shadow-casting) and glow (unlit, bright, picked up by bloom).
 * World axes: X forward, Y up, Z to the model's right; one tile is one unit.
 */

export type V3 = readonly [number, number, number];
/** A colour, the team colour, or the team colour sunk into dark chitin (large alien shells). */
export type Paint = number | 'team' | 'teamDark';

export interface PieceOpts {
  at?: V3;
  /** Euler rotation in radians (XYZ order). */
  rot?: V3;
  scale?: V3;
  /** Drawn unlit and bright (bloom picks it up). */
  glow?: boolean;
}

interface Piece {
  geo: THREE.BufferGeometry;
  paint: Paint;
  glow: boolean;
  /** A plainer version of the same piece (square edges, fewer sides), the one a shadow is cast from (PERF-4). */
  low?: THREE.BufferGeometry;
}

export interface Built {
  lit: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Top of the shape in local units. */
  top: number;
  triangles: number;
  /** Position-only stand-in for the whole shape's shadow (PERF-4): plainer pieces, and none for the small ones. */
  shadow?: THREE.BufferGeometry | null;
  /** Triangles of the shadow stand-in. */
  shadowTriangles?: number;
}

/** A piece whose longest side is under this (tiles) casts no shadow: it is a few pixels at play zoom (PERF-4). */
export const SHADOW_MIN_LONG = 0.1;
/** A piece whose second longest side is under this (tiles) is a rod too thin for its shadow to show (PERF-4). */
export const SHADOW_MIN_MID = 0.03;

/** Whether a piece of this bounding size (tiles) casts a shadow (PERF-4): small parts cast none. */
export function castsShadow(size: V3): boolean {
  const [a, b] = [...size].sort((x, y) => y - x) as [number, number, number];
  return a >= SHADOW_MIN_LONG && b >= SHADOW_MIN_MID;
}

/** Sides of a round piece in its shadow stand-in. */
const LOW_SEG = 6;

/** Pieces smaller than this (tiles) get less geometric detail. */
const SMALL = 0.1;
/** Round segments for a piece of radius `r`: tiny pins and barrels need only five or six sides. */
const segs = (wanted: number, r: number): number => (r < 0.02 ? Math.min(wanted, 5) : r < 0.05 ? Math.min(wanted, 7) : wanted);

const tmpColor = new THREE.Color();
const SHADE = new THREE.Color(0x2e1a2a);

function paintColor(p: Paint, team: number): THREE.Color {
  if (p === 'team') return tmpColor.setHex(team);
  if (p === 'teamDark') return tmpColor.setHex(team).lerp(SHADE, 0.62);
  return tmpColor.setHex(p);
}

/** Collects pieces; `build` merges them per material. Pure apart from three.js allocations. */
export class Shape {
  readonly pieces: Piece[] = [];

  /** Add any geometry (it is owned by the shape afterwards). */
  add(geo: THREE.BufferGeometry, paint: Paint, o: PieceOpts = {}, low?: THREE.BufferGeometry): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(o.at ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(o.scale ?? [1, 1, 1])),
    );
    geo.applyMatrix4(m);
    low?.applyMatrix4(m);
    this.pieces.push({ geo, paint, glow: !!o.glow, low });
    return this;
  }

  /**
   * A box with chamfered edges (bevel as a fraction of the smallest side, 0 for sharp), centred on `at`. Detail follows
   * size: pieces under a tenth of a tile are a few pixels at RTS zoom, so they stay plain boxes (12 triangles, not 108).
   */
  box(w: number, h: number, d: number, paint: Paint, o: PieceOpts & { bevel?: number } = {}): this {
    const bevel = o.bevel ?? 0.18;
    const r = Math.min(w, h, d) * Math.min(0.45, bevel);
    const rounded = r > 0.0015 && Math.max(w, h, d) >= SMALL;
    const geo = rounded ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, paint, o, rounded ? new THREE.BoxGeometry(w, h, d) : undefined);
  }

  /** A cylinder along Y (top radius r, bottom radius r2), centred on `at`. */
  cyl(r: number, h: number, paint: Paint, o: PieceOpts & { r2?: number; seg?: number; open?: boolean } = {}): this {
    const seg = segs(o.seg ?? 10, Math.max(r, o.r2 ?? r));
    return this.add(new THREE.CylinderGeometry(r, o.r2 ?? r, h, seg, 1, !!o.open), paint, o, seg > LOW_SEG ? new THREE.CylinderGeometry(r, o.r2 ?? r, h, LOW_SEG, 1, !!o.open) : undefined);
  }

  /** A limb from point `a` to point `b` (a tapered cylinder, `r` at a and `r2` at b), so joints always meet. */
  strut(a: V3, b: V3, r: number, paint: Paint, o: { r2?: number; seg?: number; glow?: boolean } = {}): this {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const len = dir.length();
    const seg = segs(o.seg ?? 6, Math.max(r, o.r2 ?? r));
    const geo = new THREE.CylinderGeometry(o.r2 ?? r, r, len, seg);
    const low = seg > 4 ? new THREE.CylinderGeometry(o.r2 ?? r, r, len, 4) : undefined;
    const m = new THREE.Matrix4().compose(from.addScaledVector(dir, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    low?.applyMatrix4(m);
    this.pieces.push({ geo, paint, glow: !!o.glow, low });
    return this;
  }

  /** A cylinder lying along X (barrels, axles), centred on `at`. */
  tube(r: number, len: number, paint: Paint, o: PieceOpts & { r2?: number; seg?: number } = {}): this {
    const seg = segs(o.seg ?? 8, Math.max(r, o.r2 ?? r));
    const geo = new THREE.CylinderGeometry(o.r2 ?? r, r, len, seg);
    geo.rotateZ(-Math.PI / 2);
    const low = seg > LOW_SEG ? new THREE.CylinderGeometry(o.r2 ?? r, r, len, LOW_SEG) : undefined;
    low?.rotateZ(-Math.PI / 2);
    return this.add(geo, paint, o, low);
  }

  /** A sphere (use `scale` for ellipsoids), optionally cut to its upper part (`cut` 0..1 of the height kept). */
  ball(r: number, paint: Paint, o: PieceOpts & { seg?: number; cut?: number } = {}): this {
    const seg = segs(o.seg ?? 10, r * Math.max(...(o.scale ?? [1, 1, 1])));
    const theta = o.cut ? Math.PI * o.cut : Math.PI;
    const low = seg > LOW_SEG ? new THREE.SphereGeometry(r, LOW_SEG, 4, 0, Math.PI * 2, 0, theta) : undefined;
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)), 0, Math.PI * 2, 0, theta), paint, o, low);
  }

  cone(r: number, h: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const seg = o.seg ?? 8;
    return this.add(new THREE.ConeGeometry(r, h, seg), paint, o, seg > LOW_SEG ? new THREE.ConeGeometry(r, h, LOW_SEG) : undefined);
  }

  /** A shell of revolution around Y from (radius, height) points, bottom to top. */
  lathe(points: readonly (readonly [number, number])[], paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const pts = points.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y));
    const seg = o.seg ?? 12;
    return this.add(new THREE.LatheGeometry(pts, seg), paint, o, seg > LOW_SEG + 2 ? new THREE.LatheGeometry(pts, LOW_SEG + 2) : undefined);
  }

  /** A ring (torus) lying flat in XZ. */
  ring(r: number, tube: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const geo = new THREE.TorusGeometry(r, tube, 5, o.seg ?? 16);
    geo.rotateX(Math.PI / 2);
    const low = new THREE.TorusGeometry(r, tube, 3, Math.min(o.seg ?? 16, 10));
    low.rotateX(Math.PI / 2);
    return this.add(geo, paint, o, low);
  }

  /**
   * An outline in the ground plane (x forward, z right) extruded up by `h`, with bevelled edges, standing on `at`.
   * The workhorse for hulls, turrets and armour plates.
   */
  hull(outline: readonly (readonly [number, number])[], h: number, paint: Paint, o: PieceOpts & { bevel?: number } = {}): this {
    const bevel = Math.min(o.bevel ?? 0.02, h / 3);
    const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    // Extrusion runs along +Z from the XY shape; turn it to run up +Y with the outline's z kept.
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, bevel, 0);
    // The shadow's version is the same outline without the bevel (square edges, a third of the triangles).
    const low = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, h), bevelEnabled: false, curveSegments: 1 });
    low.rotateX(-Math.PI / 2);
    return this.add(geo, paint, o, low);
  }

  /**
   * A side profile (x forward, y up) extruded across the model's width (z), with bevelled edges, centred on `at`.
   * Used for sloped hulls, roofs and wedges.
   */
  slab(profile: readonly (readonly [number, number])[], width: number, paint: Paint, o: PieceOpts & { bevel?: number } = {}): this {
    const bevel = Math.min(o.bevel ?? 0.02, width / 3);
    const shape = new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
    geo.translate(0, 0, -width / 2 + bevel);
    const low = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.001, width), bevelEnabled: false, curveSegments: 1 });
    low.translate(0, 0, -width / 2);
    return this.add(geo, paint, o, low);
  }

  /** A half cylinder lying along X with its flat side down (hangar roofs, arches). */
  arch(r: number, len: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const geo = new THREE.CylinderGeometry(r, r, len, o.seg ?? 14, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    const seg = o.seg ?? 14;
    const low = seg > 8 ? new THREE.CylinderGeometry(r, r, len, 8, 1, false, 0, Math.PI) : undefined;
    low?.rotateZ(Math.PI / 2);
    return this.add(geo, paint, o, low);
  }

  /** A faceted rock: an icosahedron with its corners pushed in and out by a deterministic hash of `seed`. */
  rock(r: number, paint: Paint, seed: number, o: PieceOpts & { detail?: number; rough?: number } = {}): this {
    const geo = new THREE.IcosahedronGeometry(r, o.detail ?? 0);
    const pos = geo.attributes.position!;
    const rough = o.rough ?? 0.35;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Copies of one corner share a position, so they move together and the rock stays closed.
      const k = 1 - rough / 2 + rough * hash3(Math.round(x * 1000) + seed * 7919, Math.round(y * 1000), Math.round(z * 1000));
      pos.setXYZ(i, x * k, y * k * 0.8, z * k);
    }
    geo.computeVertexNormals();
    return this.add(geo, paint, o);
  }

  /** Build merged lit and glow geometry in a team colour. */
  build(team: number): Built {
    const lit: THREE.BufferGeometry[] = [];
    const glow: THREE.BufferGeometry[] = [];
    const shade: THREE.BufferGeometry[] = [];
    let top = 0;
    let triangles = 0;
    for (const p of this.pieces) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
      if (!g.attributes.normal) g.computeVertexNormals();
      const n = g.attributes.position!.count;
      const c = paintColor(p.paint, team);
      const cols = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        cols[i * 3] = c.r;
        cols[i * 3 + 1] = c.g;
        cols[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      g.computeBoundingBox();
      top = Math.max(top, g.boundingBox!.max.y);
      triangles += n / 3;
      (p.glow ? glow : lit).push(g);
      if (!p.glow) {
        const size = g.boundingBox!.getSize(new THREE.Vector3());
        if (castsShadow([size.x, size.y, size.z])) {
          const sg = (p.low ?? p.geo).toNonIndexed();
          for (const name of Object.keys(sg.attributes)) if (name !== 'position') sg.deleteAttribute(name);
          shade.push(sg);
        }
      }
    }
    const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
      if (list.length === 0) return null;
      const m = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!m) throw new Error('model pieces could not be merged');
      m.computeBoundingSphere();
      return m;
    };
    const shadow = merge(shade);
    return { lit: merge(lit), glow: merge(glow), top, triangles, shadow, shadowTriangles: shadow ? shadow.attributes.position!.count / 3 : 0 };
  }
}

/** Deterministic hash in [0, 1) of integer-ish inputs (render-side only; no Math.random). */
export function hash3(x: number, y: number, z = 0): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) ^ Math.imul(Math.floor(y) | 0, 668265263) ^ Math.imul(Math.floor(z) | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
