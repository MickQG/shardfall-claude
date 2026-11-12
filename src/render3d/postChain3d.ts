import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';

/**
 * The lighter post-processing chain of the High preset (R3D-12, PERF-5). The stock chain drew four full-screen passes after
 * the scene: bloom added onto the half-float scene buffer, tone mapping into another half-float buffer, then FXAA to the
 * canvas. Here bloom stops at its small blurred image, and one pass adds it to the scene, tone maps and writes 8-bit
 * colour, which FXAA then smooths onto the canvas. The maths are three's own (its tone-mapping and colour-space shader
 * chunks, the same bloom), so the picture is the same; only the in-between buffers and passes are gone. Render-only.
 */

/** The shader defines that select tone mapping and the sRGB transfer, as three's OutputPass builds them. */
export function outputDefines(toneMapping: THREE.ToneMapping, colorSpace: string): Record<string, string> {
  const d: Record<string, string> = {};
  if (THREE.ColorManagement.getTransfer(colorSpace) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
  const tm: Partial<Record<THREE.ToneMapping, string>> = {
    [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
    [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
    [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
    [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
    [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
    [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
    [THREE.CustomToneMapping]: 'CUSTOM_TONE_MAPPING',
  };
  const name = tm[toneMapping];
  if (name) d[name] = '';
  return d;
}

const BLUR_X = new THREE.Vector2(1, 0);
const BLUR_Y = new THREE.Vector2(0, 1);

/**
 * Bloom that leaves its blurred glow in `glow` instead of adding it onto the scene buffer: the bright pass, the blur
 * chain and the mix of its levels are three's UnrealBloomPass unchanged; the full-screen additive blend is skipped and
 * done by FinishPass while it tone maps.
 */
export class GlowPass extends UnrealBloomPass {
  /** The blurred glow, a quarter of the scene buffer's width and height. */
  get glow(): THREE.Texture {
    return this.renderTargetsHorizontal[0]!.texture;
  }

  override render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // Private members of UnrealBloomPass (three r186), read through a loose view of `this`.
    const self = this as unknown as { _oldClearColor: THREE.Color; _oldClearAlpha: number; _fsQuad: FullScreenQuad; separableBlurMaterials: THREE.ShaderMaterial[]; materialHighPassFilter: THREE.ShaderMaterial; highPassUniforms: Record<string, THREE.IUniform>; compositeMaterial: THREE.ShaderMaterial };
    renderer.getClearColor(self._oldClearColor);
    self._oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);
    const quad = self._fsQuad;
    // 1. The bright parts.
    self.highPassUniforms.tDiffuse!.value = readBuffer.texture;
    self.highPassUniforms.luminosityThreshold!.value = this.threshold;
    quad.material = self.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    quad.render(renderer);
    // 2. Blur them at each level.
    let input: THREE.WebGLRenderTarget = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = self.separableBlurMaterials[i]!;
      quad.material = m;
      m.uniforms.colorTexture!.value = input.texture;
      m.uniforms.direction!.value = BLUR_X;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]!);
      renderer.clear();
      quad.render(renderer);
      m.uniforms.colorTexture!.value = this.renderTargetsHorizontal[i]!.texture;
      m.uniforms.direction!.value = BLUR_Y;
      renderer.setRenderTarget(this.renderTargetsVertical[i]!);
      renderer.clear();
      quad.render(renderer);
      input = this.renderTargetsVertical[i]!;
    }
    // 3. Mix the levels into `glow`.
    const c = self.compositeMaterial;
    quad.material = c;
    c.uniforms.bloomStrength!.value = this.strength;
    c.uniforms.bloomRadius!.value = this.radius;
    c.uniforms.bloomTintColors!.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]!);
    renderer.clear();
    quad.render(renderer);
    renderer.setClearColor(self._oldClearColor, self._oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

const FINISH_VERTEX = /* glsl */ `
precision highp float;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** Scene plus glow, tone mapped and encoded exactly as three's OutputPass does it (its own shader chunks). */
const FINISH_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tGlow;
uniform float glowMix;
#include <tonemapping_pars_fragment>
#include <colorspace_pars_fragment>
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
  #ifdef USE_GLOW
    gl_FragColor.rgb += texture2D(tGlow, vUv).rgb * glowMix;
  #endif
  #ifdef LINEAR_TONE_MAPPING
    gl_FragColor.rgb = LinearToneMapping(gl_FragColor.rgb);
  #elif defined(REINHARD_TONE_MAPPING)
    gl_FragColor.rgb = ReinhardToneMapping(gl_FragColor.rgb);
  #elif defined(CINEON_TONE_MAPPING)
    gl_FragColor.rgb = CineonToneMapping(gl_FragColor.rgb);
  #elif defined(ACES_FILMIC_TONE_MAPPING)
    gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
  #elif defined(AGX_TONE_MAPPING)
    gl_FragColor.rgb = AgXToneMapping(gl_FragColor.rgb);
  #elif defined(NEUTRAL_TONE_MAPPING)
    gl_FragColor.rgb = NeutralToneMapping(gl_FragColor.rgb);
  #elif defined(CUSTOM_TONE_MAPPING)
    gl_FragColor.rgb = CustomToneMapping(gl_FragColor.rgb);
  #endif
  #ifdef SRGB_TRANSFER
    gl_FragColor = sRGBTransferOETF(gl_FragColor);
  #endif
  gl_FragColor.a = 1.0;
}`;

/**
 * The last pass: adds the glow to the scene, tone maps and writes 8-bit colour into the composer's write buffer (which
 * createComposer makes 8-bit), then smooths edges with three's FXAA onto the canvas. Tone mapped colour in 8 bits is what
 * the canvas holds anyway, so nothing is lost; FXAA reads half the bytes it did from a half-float buffer.
 */
export class FinishPass extends Pass {
  readonly finish: THREE.RawShaderMaterial;
  readonly fxaa: THREE.ShaderMaterial;
  private quad = new FullScreenQuad();
  private key = '';

  constructor(private readonly glow: GlowPass | null) {
    super();
    this.needsSwap = false;
    this.finish = new THREE.RawShaderMaterial({
      name: 'FinishShader',
      uniforms: { tDiffuse: { value: null }, tGlow: { value: glow?.glow ?? null }, glowMix: { value: 1 }, toneMappingExposure: { value: 1 } },
      vertexShader: FINISH_VERTEX,
      fragmentShader: FINISH_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.fxaa = new THREE.ShaderMaterial({ name: FXAAShader.name, uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader, depthTest: false, depthWrite: false });
  }

  /**
   * Bloom on or off without a new program (R3D-13): off, the bloom pass is skipped and the glow weighs nothing, so the
   * chain only tone maps and smooths edges (Low on a canvas that is not multisampled, PERF-5).
   */
  setGlow(on: boolean): void {
    if (this.glow) this.glow.enabled = on;
    this.finish.uniforms.glowMix!.value = on ? 1 : 0;
  }

  override setSize(width: number, height: number): void {
    (this.fxaa.uniforms.resolution!.value as THREE.Vector2).set(1 / width, 1 / height);
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const key = `${renderer.toneMapping}|${renderer.outputColorSpace}`;
    if (key !== this.key) {
      this.key = key;
      this.finish.defines = { ...outputDefines(renderer.toneMapping, renderer.outputColorSpace), ...(this.glow ? { USE_GLOW: '' } : {}) };
      this.finish.needsUpdate = true;
    }
    this.finish.uniforms.tDiffuse!.value = readBuffer.texture;
    this.finish.uniforms.toneMappingExposure!.value = renderer.toneMappingExposure;
    this.quad.material = this.finish;
    renderer.setRenderTarget(writeBuffer);
    this.quad.render(renderer);
    this.fxaa.uniforms.tDiffuse!.value = writeBuffer.texture;
    this.quad.material = this.fxaa;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.finish.dispose();
    this.fxaa.dispose();
    this.quad.dispose();
  }
}
