import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applySurface, patchSurface, PANEL, PLATE, SURFACE_KEYS, surfaceChunks } from '../../src/render3d/surface3d';
import { unexploredMask } from '../../src/render3d/unexplored';

/** A stand-in for the standard material's shader source, with the chunk includes the detail hooks into. */
const source = (): { vertexShader: string; fragmentShader: string } => ({
  vertexShader: 'void main() {\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <project_vertex>\n}',
  fragmentShader: 'void main() {\n#include <map_fragment>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <dithering_fragment>\n}',
});

describe('procedural surface detail', () => {
  it('R3D-23: metal gets edge wear, no panel grid, that lowers roughness, and crevice darkening, from object-space position and normal', () => {
    const s = source();
    patchSurface(s, 'metal');
    expect(s.vertexShader).toContain('vSdPos = transformed');
    expect(s.vertexShader).toContain('vSdNrm = objectNormal');
    expect(s.fragmentShader).not.toContain('float groove');
    expect(s.fragmentShader).not.toContain('fract( q');
    expect(s.fragmentShader).toContain('fwidth( q )');
    expect(s.fragmentShader).toContain('fwidth( sdN )');
    expect(s.fragmentShader).toContain('roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, sdWear )');
    expect(s.fragmentShader).toContain('float ao');
    // The detail replaces nothing it needs: the original chunks it hooks into are still included.
    expect(s.fragmentShader).toContain('#include <color_fragment>');
    expect(s.fragmentShader).toContain('#include <roughnessmap_fragment>');
    expect(s.vertexShader).toContain('#include <begin_vertex>');
  });

  it('R3D-23: organic gets crevice darkening only (no plates, pores or seams), and fades by screen-space derivatives so nothing shimmers zoomed out', () => {
    const s = source();
    patchSurface(s, 'organic');
    expect(s.fragmentShader).not.toContain('float pore');
    expect(s.fragmentShader).toContain('float ao');
    expect(s.fragmentShader).not.toContain('floor( q');
    expect(s.fragmentShader).toMatch(/fade = 1\.0 - smoothstep/);
    expect(s.fragmentShader).not.toContain('sdWear');
    expect(surfaceChunks('metal').color).toMatch(/fade = 1\.0 - smoothstep/);
  });

  it('R3D-23: the details are a few per tile (not noise), and each kind has its own program key, distinct from the fog-of-war mask\'s', () => {
    expect(PANEL).toBeGreaterThan(0.15);
    expect(PANEL).toBeLessThan(0.6);
    expect(PLATE).toBeGreaterThan(0.15);
    expect(PLATE).toBeLessThan(0.6);
    const metal = new THREE.MeshStandardMaterial();
    const organic = new THREE.MeshStandardMaterial();
    const crate = new THREE.MeshStandardMaterial();
    applySurface(metal, 'metal');
    applySurface(organic, 'organic');
    unexploredMask().apply(crate);
    const keys = [metal, organic, crate].map((m) => m.customProgramCacheKey());
    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(SURFACE_KEYS.metal);
    expect(keys[1]).toBe(SURFACE_KEYS.organic);
    // Neither material takes the fog-of-war mask.
    const s = source();
    metal.onBeforeCompile!(s as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as never);
    expect(s.fragmentShader).not.toContain('uHideMap');
  });
});
