import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * How a match is lit and post-processed (ADR 0005), shared by the world view and the menu's faction scene (MENU-10), so
 * the menu looks like the match it leads into. Render-only.
 */

/** Brightness of Vrax buildings' bioluminescence under bloom: a touch brighter than other glows, so a hive reads alive. */
export const HIVE_GLOW = 1.15;
/** Brightness of other glowing parts under bloom: enough to bloom softly, not to blaze. */
export const GLOW = 1;
/** Glow brightness (other parts, Vrax buildings) with and without bloom. Applied from the first frame (R3D-12). */
export const glowLevels = (bloom: boolean): { glow: number; hive: number } => (bloom ? { glow: GLOW, hive: HIVE_GLOW } : { glow: 1, hive: 0.9 });

/** The warm sun and the cool sky light of a match. */
export function matchLights(): { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight } {
  return { sun: new THREE.DirectionalLight(0xffe2b8, 3.0), hemi: new THREE.HemisphereLight(0xa8b8ff, 0x4a3e2c, 0.95) };
}

/** Renderer settings of a match: ACES tone mapping, sRGB output, PCF shadows (PCFSoftShadowMap was removed in r186). */
export function configureRenderer(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/** Soft studio reflections for painted metal and wet chitin, under the warm sun and cool sky. */
export function addEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.32;
  pmrem.dispose();
}

/** The sun's shadow: an orthographic box `half` tiles either side, drawn into a `size` px map. */
export function configureSunShadow(sun: THREE.DirectionalLight, half: number, size: number, far = 80): void {
  sun.castShadow = true;
  sun.shadow.mapSize.set(size, size);
  const sc = sun.shadow.camera;
  sc.left = -half;
  sc.right = half;
  sc.top = half;
  sc.bottom = -half;
  sc.near = 1;
  sc.far = far;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
}

/**
 * Bloom works on a half-float (HDR) buffer; edges are smoothed by FXAA after tone mapping. (A multisampled HDR buffer
 * looked the same but its resolve halved the frame rate on integrated graphics.)
 */
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bloom = true): EffectComposer {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  if (bloom) {
    // Bloom is soft by nature: run its blur chain from half the screen size, a quarter of the pixels (PERF-1).
    const pass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.0);
    const setSize = pass.setSize.bind(pass);
    pass.setSize = (w: number, h: number): void => setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    composer.addPass(pass);
  }
  composer.addPass(new OutputPass());
  composer.addPass(new FXAAPass());
  return composer;
}
