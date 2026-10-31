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
}

export interface Built {
  lit: THREE.BufferGeometry | null;
  glow: THREE.BufferGeometry | null;
  /** Top of the shape in local units. */
  top: number;
  triangles: number;
}

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
  add(geo: THREE.BufferGeometry, paint: Paint, o: PieceOpts = {}): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...(o.at ?? [0, 0, 0])),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...(o.rot ?? [0, 0, 0]))),
      new THREE.Vector3(...(o.scale ?? [1, 1, 1])),
    );
    geo.applyMatrix4(m);
    this.pieces.push({ geo, paint, glow: !!o.glow });
    return this;
  }

  /**
   * A box with chamfered edges (bevel as a fraction of the smallest side, 0 for sharp), centred on `at`. Detail follows
   * size: pieces under a tenth of a tile are a few pixels at RTS zoom, so they stay plain boxes (12 triangles, not 108).
   */
  box(w: number, h: number, d: number, paint: Paint, o: PieceOpts & { bevel?: number } = {}): this {
    const bevel = o.bevel ?? 0.18;
    const r = Math.min(w, h, d) * Math.min(0.45, bevel);
    const geo = r > 0.0015 && Math.max(w, h, d) >= SMALL ? new RoundedBoxGeometry(w, h, d, 1, r) : new THREE.BoxGeometry(w, h, d);
    return this.add(geo, paint, o);
  }

  /** A cylinder along Y (top radius r, bottom radius r2), centred on `at`. */
  cyl(r: number, h: number, paint: Paint, o: PieceOpts & { r2?: number; seg?: number; open?: boolean } = {}): this {
    return this.add(new THREE.CylinderGeometry(r, o.r2 ?? r, h, segs(o.seg ?? 10, Math.max(r, o.r2 ?? r)), 1, !!o.open), paint, o);
  }

  /** A limb from point `a` to point `b` (a tapered cylinder, `r` at a and `r2` at b), so joints always meet. */
  strut(a: V3, b: V3, r: number, paint: Paint, o: { r2?: number; seg?: number; glow?: boolean } = {}): this {
    const from = new THREE.Vector3(...a);
    const dir = new THREE.Vector3(...b).sub(from);
    const len = dir.length();
    const geo = new THREE.CylinderGeometry(o.r2 ?? r, r, len, segs(o.seg ?? 6, Math.max(r, o.r2 ?? r)));
    geo.applyMatrix4(new THREE.Matrix4().compose(from.addScaledVector(dir, 0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1)));
    this.pieces.push({ geo, paint, glow: !!o.glow });
    return this;
  }

  /** A cylinder lying along X (barrels, axles), centred on `at`. */
  tube(r: number, len: number, paint: Paint, o: PieceOpts & { r2?: number; seg?: number } = {}): this {
    const geo = new THREE.CylinderGeometry(o.r2 ?? r, r, len, segs(o.seg ?? 8, Math.max(r, o.r2 ?? r)));
    geo.rotateZ(-Math.PI / 2);
    return this.add(geo, paint, o);
  }

  /** A sphere (use `scale` for ellipsoids), optionally cut to its upper part (`cut` 0..1 of the height kept). */
  ball(r: number, paint: Paint, o: PieceOpts & { seg?: number; cut?: number } = {}): this {
    const seg = segs(o.seg ?? 10, r * Math.max(...(o.scale ?? [1, 1, 1])));
    const theta = o.cut ? Math.PI * o.cut : Math.PI;
    return this.add(new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)), 0, Math.PI * 2, 0, theta), paint, o);
  }

  cone(r: number, h: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    return this.add(new THREE.ConeGeometry(r, h, o.seg ?? 8), paint, o);
  }

  /** A shell of revolution around Y from (radius, height) points, bottom to top. */
  lathe(points: readonly (readonly [number, number])[], paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    return this.add(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(Math.max(0.0001, r), y)), o.seg ?? 12), paint, o);
  }

  /** A ring (torus) lying flat in XZ. */
  ring(r: number, tube: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const geo = new THREE.TorusGeometry(r, tube, 5, o.seg ?? 16);
    geo.rotateX(Math.PI / 2);
    return this.add(geo, paint, o);
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
    return this.add(geo, paint, o);
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
    return this.add(geo, paint, o);
  }

  /** A half cylinder lying along X with its flat side down (hangar roofs, arches). */
  arch(r: number, len: number, paint: Paint, o: PieceOpts & { seg?: number } = {}): this {
    const geo = new THREE.CylinderGeometry(r, r, len, o.seg ?? 14, 1, false, 0, Math.PI);
    geo.rotateZ(Math.PI / 2);
    return this.add(geo, paint, o);
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
    }
    const merge = (list: THREE.BufferGeometry[]): THREE.BufferGeometry | null => {
      if (list.length === 0) return null;
      const m = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!m) throw new Error('model pieces could not be merged');
      m.computeBoundingSphere();
      return m;
    };
    return { lit: merge(lit), glow: merge(glow), top, triangles };
  }
}

/** Deterministic hash in [0, 1) of integer-ish inputs (render-side only; no Math.random). */
export function hash3(x: number, y: number, z = 0): number {
  let h = Math.imul(Math.floor(x) | 0, 374761393) ^ Math.imul(Math.floor(y) | 0, 668265263) ^ Math.imul(Math.floor(z) | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
