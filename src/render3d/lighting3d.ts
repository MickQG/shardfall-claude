import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { FinishPass, GlowPass } from './postChain3d';
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

/**
 * Whether the match canvas is multisampled: only for a match that starts on Low, which draws straight to it. High
 * finishes with FXAA on a full-screen quad, where canvas multisampling smooths nothing and only costs memory traffic
 * (PERF-5).
 */
export const canvasMsaa = (low: boolean): boolean => low;

/**
 * How a frame reaches the canvas (PERF-5): `full` is the post chain with bloom (High); `fxaa` is the same chain with bloom
 * skipped, tone mapping and FXAA only (Low on a canvas that is not multisampled, after a switch from High mid-match);
 * `direct` draws straight to a multisampled canvas (Low from the start). Every combination smooths edges.
 */
export type PostMode = 'full' | 'fxaa' | 'direct';
export const postMode = (bloom: boolean, msaa: boolean): PostMode => (bloom ? 'full' : msaa ? 'direct' : 'fxaa');

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

/** Where the sun sits relative to the point it looks at, tiles: from -X and +Z, as in the classic bake. */
export const SUN_OFFSET: readonly [number, number, number] = [-7, 24, 15];

/**
 * The point the sun looks at, moved sideways in the light's own plane to the nearest shadow-map texel (PERF-3), so the
 * map's grid stays fixed in the world while the camera pans and shadow edges do not shimmer. `texel` is the world size
 * of one texel, tiles. Returns the snapped x and z of the target (its height stays 0).
 */
export function snapShadowTarget(x: number, z: number, texel: number): { x: number; z: number } {
  const [ox, oy, oz] = SUN_OFFSET;
  // The light's view axes as three's lookAt builds them: back is from the target to the sun, right is up x back, up is back x right.
  const bl = Math.hypot(ox, oy, oz);
  const bx = ox / bl;
  const by = oy / bl;
  const bz = oz / bl;
  const rl = Math.hypot(bz, bx);
  const rx = bz / rl;
  const ry = 0;
  const rz = -bx / rl;
  const ux = by * rz - bz * ry;
  const uz = bx * ry - by * rx;
  // The ground point's coordinates along right and up, rounded to a texel; then the ground shift that lands there.
  const a = x * rx + z * rz;
  const b = x * ux + z * uz;
  const da = Math.round(a / texel) * texel - a;
  const db = Math.round(b / texel) * texel - b;
  const det = rx * uz - rz * ux;
  return { x: x + (da * uz - rz * db) / det, z: z + (rx * db - ux * da) / det };
}

/**
 * Bloom works on a half-float (HDR) buffer; edges are smoothed by FXAA after tone mapping. (A multisampled HDR buffer
 * looked the same but its resolve halved the frame rate on integrated graphics.) The glow is added to the scene in the
 * same pass that tone maps, into an 8-bit buffer that FXAA reads (PERF-5): see postChain3d.
 */
export function createComposer(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, bloom = true): EffectComposer {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, target);
  // No pass swaps buffers: the scene is drawn into the half-float buffer with depth, and the other one only ever holds
  // tone-mapped colour, so it is 8-bit and needs no depth. Both follow the composer's size.
  composer.renderTarget2.dispose();
  composer.renderTarget2 = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  composer.readBuffer = composer.renderTarget1;
  composer.writeBuffer = composer.renderTarget2;
  composer.addPass(new RenderPass(scene, camera));
  let glow: GlowPass | null = null;
  if (bloom) {
    // Bloom is soft by nature: run its blur chain from half the screen size, a quarter of the pixels (PERF-1).
    glow = new GlowPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.0);
    const setSize = glow.setSize.bind(glow);
    glow.setSize = (w: number, h: number): void => setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    composer.addPass(glow);
  }
  composer.addPass(new FinishPass(glow));
  return composer;
}
