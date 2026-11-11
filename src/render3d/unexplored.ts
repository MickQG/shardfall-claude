import * as THREE from 'three';

/**
 * Unexplored darkness (R3D-17): everything standing on a tile the player has never explored (cliffs, water, rocks,
 * plants, crystals) fades into the same darkness as the fog over its ground, instead of showing above it. Tiles that
 * have been explored are left as they are. The fog texture is the view's per-tile fog of war: its green channel is
 * near 1 for unexplored tiles, about one half for explored ones and 0 where the player sees.
 */
export interface UnexploredMask {
  uniforms: {
    uHideMap: { value: THREE.Texture };
    uHideSize: { value: THREE.Vector2 };
    uHideColor: { value: THREE.Color };
  };
  /** Point the mask at the map's fog texture (tiles across and down). */
  use(fog: THREE.Texture, width: number, height: number): void;
  /** Make `mat` fade into the darkness over unexplored tiles. */
  apply(mat: THREE.Material): void;
}

/** Green channel of the fog texture from which a tile counts as unexplored (explored tiles sit near 0.47). */
export const HIDE_FROM = 0.62;
export const HIDE_FULL = 0.9;

/** World x, z of each vertex (instanced or not), for the fragment shader to look up its tile. */
const VERTEX = `#include <project_vertex>
  {
    vec4 hideW = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      hideW = instanceMatrix * hideW;
    #endif
    vHideXZ = ( modelMatrix * hideW ).xz;
  }`;

const FRAGMENT = `#include <dithering_fragment>
  {
    float hidden = smoothstep( ${HIDE_FROM.toFixed(2)}, ${HIDE_FULL.toFixed(2)}, texture2D( uHideMap, vec2( vHideXZ.x / uHideSize.x, 1.0 - vHideXZ.y / uHideSize.y ) ).g );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, uHideColor, hidden );
  }`;

/** The darkness over unexplored ground in play (R3D-17). */
export const UNEXPLORED_COLOR = 0x0c0f22;
/** The same darkness at the first frame of the fly-in (CAM-4): from high up nearly the whole map is unexplored, so a near-black tone would make the opening shot black. A flat, featureless dim blue-grey: no terrain shows through it (CAM-7). */
export const UNEXPLORED_LIFTED = 0x46557a;

/** The unexplored tone for a lift of 0 (play) to 1 (opening shot), as sRGB bytes. Pure. */
export function unexploredTone(lift: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, lift));
  const ch = (shift: number): number => Math.round(((UNEXPLORED_COLOR >> shift) & 255) * (1 - k) + ((UNEXPLORED_LIFTED >> shift) & 255) * k);
  return [ch(16), ch(8), ch(0)];
}

export function unexploredMask(color = UNEXPLORED_COLOR): UnexploredMask {
  // Until a map's fog is known, nothing is hidden (a 1x1 texture with green 0).
  const none = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  none.needsUpdate = true;
  const uniforms = { uHideMap: { value: none as THREE.Texture }, uHideSize: { value: new THREE.Vector2(1, 1) }, uHideColor: { value: new THREE.Color(color) } };
  return {
    uniforms,
    use(fog, width, height) {
      uniforms.uHideMap.value = fog;
      uniforms.uHideSize.value.set(width, height);
    },
    apply(mat) {
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = `varying vec2 vHideXZ;\n${shader.vertexShader.replace('#include <project_vertex>', VERTEX)}`;
        shader.fragmentShader = `uniform sampler2D uHideMap;\nuniform vec2 uHideSize;\nuniform vec3 uHideColor;\nvarying vec2 vHideXZ;\n${shader.fragmentShader.replace('#include <dithering_fragment>', FRAGMENT)}`;
      };
      // Programs with the mask must not be shared with look-alike materials without it.
      mat.customProgramCacheKey = () => 'unexplored-mask';
    },
  };
}
