import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GROUND_AMBIENT, groundMaterial } from '../../src/render3d/lighting3d';

const patched = (mat: THREE.Material): { fragmentShader: string; uniforms: Record<string, { value: unknown }> } => {
  const shader = { fragmentShader: '#include <lights_fragment_end>\n#include <opaque_fragment>', uniforms: {} as Record<string, { value: unknown }> };
  mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
  return shader;
};

describe('ground material (PERF-7)', () => {
  const map = new THREE.Texture();
  const relief = new THREE.Texture();

  it('PERF-7: the ground uses a diffuse-only model, not the physically based one', () => {
    const mat = groundMaterial(map, relief);
    expect(mat).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(mat).not.toBeInstanceOf(THREE.MeshStandardMaterial);
  });

  it('PERF-7 R3D-11: it keeps the colour map and the tiling relief normal map', () => {
    const mat = groundMaterial(map, relief);
    expect(mat.map).toBe(map);
    expect(mat.normalMap).toBe(relief);
    expect(mat.normalScale.x).toBeCloseTo(0.7);
    expect(mat.normalScale.y).toBeCloseTo(0.7);
  });

  it('PERF-7: a constant ambient term stands in for the specular share the physically based model added', () => {
    const shader = patched(groundMaterial(map, relief));
    expect(shader.fragmentShader).toContain('reflectedLight.indirectDiffuse += uGroundAmbient');
    expect((shader.uniforms.uGroundAmbient!.value as THREE.Vector3).toArray()).toEqual([...GROUND_AMBIENT]);
  });

  it('PERF-7: the ground\'s program is not shared with other Lambert materials', () => {
    const mat = groundMaterial(map, relief);
    expect(mat.customProgramCacheKey()).not.toBe(new THREE.MeshLambertMaterial().customProgramCacheKey());
  });
});
