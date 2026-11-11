import * as THREE from 'three';

/**
 * Water (R3D-11): low waves that drift slowly and sparkle a little, on Low and High alike. Drift is in texture repeats
 * per ms (it was 0.000018 / 0.000011). The old surface (roughness 0.08, metalness 0.3, normal scale 0.45) glittered too
 * much; a flat one (0.5, 0.08, 0.16) showed no waves. These sit between the two.
 */
export const WATER = {
  driftX: 0.000011,
  driftY: 0.000007,
  roughness: 0.2,
  metalness: 0.22,
  normalScale: 0.34,
  /** Noise lattice frequency of the ripple normal map (it was 6) and its strength (it was 9). */
  noiseFreq: 5,
  noiseStrength: 8,
  /** Tiles per texture repeat. */
  tilesPerRepeat: 4,
} as const;

/** A seeded, seamlessly tiling value-noise height field turned into a normal map (ground relief, water ripples). */
export function noiseNormalMap(size: number, freq: number, strength: number, seed: number): THREE.DataTexture {
  const h = new Float32Array(size * size);
  // Lattice values wrap with each octave's period, so the texture tiles without seams.
  const lattice = (x: number, y: number, period: number, octave: number): number => {
    let v = Math.imul((x % period) + octave * 1009 + seed * 7919, 374761393) ^ Math.imul((y % period) + octave * 613, 668265263);
    v = Math.imul(v ^ (v >>> 13), 1103515245);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 1;
      for (let o = 0; o < 3; o++) {
        const f = freq * (1 << o);
        const fx = (x / size) * f;
        const fy = (y / size) * f;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const L = (a: number, b: number): number => lattice(a, b, f, o);
        const top = L(ix, iy) + (L(ix + 1, iy) - L(ix, iy)) * sx;
        const bot = L(ix, iy + 1) + (L(ix + 1, iy + 1) - L(ix, iy + 1)) * sx;
        v += (top + (bot - top) * sy) * amp;
        amp *= 0.5;
      }
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (xx: number, yy: number): number => h[((yy + size) % size) * size + ((xx + size) % size)] as number;
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const k = (y * size + x) * 4;
      data[k] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      data[k + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      data[k + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      data[k + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
