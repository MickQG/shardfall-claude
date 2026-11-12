import * as THREE from 'three';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { describe, expect, it } from 'vitest';
import { CombatFx, LIGHT_POOL } from '../../src/render3d/fx3d';
import { canvasMsaa, configureRenderer, createComposer } from '../../src/render3d/lighting3d';
import { FinishPass, GlowPass, outputDefines } from '../../src/render3d/postChain3d';

/** Just enough of a WebGLRenderer for passes to run without a GPU: it records the targets drawn into. */
function stubRenderer(): { renderer: THREE.WebGLRenderer; targets: (THREE.WebGLRenderTarget | null)[]; draws: number } {
  const log = { targets: [] as (THREE.WebGLRenderTarget | null)[], draws: 0 };
  let current: THREE.WebGLRenderTarget | null = null;
  const r = {
    autoClear: true,
    toneMapping: THREE.NoToneMapping as THREE.ToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace as string,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap },
    getPixelRatio: () => 1,
    getClearColor: (c: THREE.Color) => c.set(0),
    getClearAlpha: () => 1,
    setClearColor: () => undefined,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      current = t;
    },
    clear: () => undefined,
    render: () => {
      log.targets.push(current);
      log.draws++;
    },
  };
  configureRenderer(r as unknown as THREE.WebGLRenderer);
  return {
    renderer: r as unknown as THREE.WebGLRenderer,
    get targets() {
      return log.targets;
    },
    get draws() {
      return log.draws;
    },
  };
}

describe('lighter post-processing chain', () => {
  it('PERF-5 R3D-12: the finishing pass tone maps exactly as three\'s OutputPass does (same defines, same shader chunks, same exposure)', () => {
    const { renderer } = stubRenderer();
    const out = new OutputPass();
    const rt = new THREE.WebGLRenderTarget(4, 4);
    out.render(renderer, rt, rt, 0, false);
    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(outputDefines(renderer.toneMapping, renderer.outputColorSpace)).toEqual(out.material.defines);
    for (const tm of [THREE.NoToneMapping, THREE.LinearToneMapping, THREE.ReinhardToneMapping, THREE.AgXToneMapping, THREE.NeutralToneMapping]) {
      renderer.toneMapping = tm;
      out.render(renderer, rt, rt, 0, false);
      expect(outputDefines(tm, renderer.outputColorSpace)).toEqual(out.material.defines);
    }
    const finish = new FinishPass(null);
    const fs = finish.finish.fragmentShader;
    expect(fs).toContain('#include <tonemapping_pars_fragment>');
    expect(fs).toContain('#include <colorspace_pars_fragment>');
    expect(fs).toContain('ACESFilmicToneMapping(gl_FragColor.rgb)');
    expect(fs).toContain('sRGBTransferOETF(gl_FragColor)');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    finish.render(renderer, rt, rt);
    expect(finish.finish.uniforms.toneMappingExposure!.value).toBe(1.2);
    expect(finish.finish.defines).toEqual({ ACES_FILMIC_TONE_MAPPING: '', SRGB_TRANSFER: '' });
  });

  it('PERF-5 R3D-12: the glow is added to the scene before tone mapping, as bloom\'s additive blend onto the scene buffer did', () => {
    const fs = new FinishPass(null).finish.fragmentShader;
    const add = fs.indexOf('texture2D(tGlow, vUv)');
    expect(add).toBeGreaterThan(0);
    expect(add).toBeLessThan(fs.indexOf('ACESFilmicToneMapping(gl_FragColor.rgb)'));
  });

  it('PERF-5: the chain is the scene, bloom and one finishing pass; the scene buffer is half-float with depth, the tone-mapped buffer 8-bit without', () => {
    const { renderer } = stubRenderer();
    const composer = createComposer(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    expect(composer.passes.map((p) => p.constructor)).toEqual([RenderPass, GlowPass, FinishPass]);
    expect(composer.passes.every((p) => !p.needsSwap)).toBe(true);
    expect(composer.readBuffer.texture.type).toBe(THREE.HalfFloatType);
    expect(composer.readBuffer.depthBuffer).toBe(true);
    expect(composer.writeBuffer.texture.type).toBe(THREE.UnsignedByteType);
    expect(composer.writeBuffer.depthBuffer).toBe(false);
    // Both buffers follow the composer's size and pixel ratio (PERF-3: the governor moves the composer alone).
    composer.setPixelRatio(0.85);
    composer.setSize(1920, 1080);
    for (const t of [composer.readBuffer, composer.writeBuffer]) expect([t.width, t.height]).toEqual([1632, 918]);
    // Bloom keeps its look: same strength, radius and threshold, blurred from half the buffer size and five levels.
    const glow = composer.passes[1] as GlowPass;
    expect([glow.strength, glow.radius, glow.threshold, glow.nMips]).toEqual([0.6, 0.5, 1.0, 5]);
    expect(glow.renderTargetBright.width).toBe(408);
  });

  it('PERF-5: bloom never draws into the scene buffer; it leaves its glow in its own small buffer, and the finish draws twice (tone map, then FXAA to the canvas)', () => {
    const stub = stubRenderer();
    const composer = createComposer(stub.renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    composer.setSize(1920, 1080);
    const glow = composer.passes[1] as GlowPass;
    const finish = composer.passes[2] as FinishPass;
    glow.render(stub.renderer, composer.writeBuffer, composer.readBuffer);
    // Bright pass, two blur draws per level, one mix of the levels.
    expect(stub.draws).toBe(1 + 2 * glow.nMips + 1);
    expect(stub.targets).not.toContain(composer.readBuffer);
    expect(stub.targets.at(-1)).toBe(glow.renderTargetsHorizontal[0]);
    expect(glow.glow).toBe(glow.renderTargetsHorizontal[0]!.texture);
    expect(finish.finish.uniforms.tGlow!.value).toBe(glow.glow);
    finish.renderToScreen = true;
    finish.render(stub.renderer, composer.writeBuffer, composer.readBuffer);
    expect(stub.targets.slice(-2)).toEqual([composer.writeBuffer, null]);
    expect(finish.fxaa.uniforms.tDiffuse!.value).toBe(composer.writeBuffer.texture);
    expect((finish.fxaa.uniforms.resolution!.value as THREE.Vector2).toArray()).toEqual([1 / 1920, 1 / 1080]);
  });

  it('PERF-5: the match canvas is multisampled only for Low, which draws straight to it; High smooths edges with FXAA', () => {
    expect(canvasMsaa(true)).toBe(true);
    expect(canvasMsaa(false)).toBe(false);
  });

  it('PERF-5 R3D-6 R3D-13: effect point lights come from a pool of two, made once, so the light count never changes mid-match', () => {
    const fx = new CombatFx();
    const lights: THREE.PointLight[] = [];
    fx.root.traverse((o) => {
      if (o instanceof THREE.PointLight) lights.push(o);
    });
    expect(LIGHT_POOL).toBe(2);
    expect(lights.length).toBe(LIGHT_POOL);
  });
});
