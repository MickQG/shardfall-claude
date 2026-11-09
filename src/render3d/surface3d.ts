import type * as THREE from 'three';

/**
 * Procedural surface detail for the model materials (R3D-23): no textures, no extra draw calls. Units and buildings are
 * instanced meshes whose vertices keep their object-space position and normal (the UVs are stripped in `Shape.build`),
 * so a few lines of shader chunk turn them into something with panels, wear and creases.
 *
 * Metal: thin dark panel grooves on a box-projected grid, edge wear (lighter, less rough) where the surface turns
 * sharply, and darker crevices (low on the model, under downward faces). Organic: chitin plates in offset rows, with
 * grooves between them and the odd pore. Every line is anti-aliased with screen-space derivatives and fades out where a
 * cell spans less than a couple of pixels, so nothing shimmers when zoomed out. The fog-of-war mask is not applied to
 * these materials, so their program keys stay distinct from the mask's.
 */

export type SurfaceKind = 'metal' | 'organic';

/** Program cache keys: distinct from each other and from the unexplored mask's ('unexplored-mask'). */
export const SURFACE_KEYS: Record<SurfaceKind, string> = { metal: 'surface-metal', organic: 'surface-organic' };

/** Size of one panel (metal) and one plate (organic) in model units: a few per tile, so they read at play zoom. */
export const PANEL = 0.3;
export const PLATE = 0.24;

const VERTEX_DECL = 'varying vec3 vSdPos;\nvarying vec3 vSdNrm;\n';
const VERTEX_SET = `#include <begin_vertex>
  vSdPos = transformed;
  vSdNrm = objectNormal;`;

/** Shared GLSL: the projection onto the dominant axis plane, and a fade for cells too small to see. */
const COMMON = `varying vec3 vSdPos;
varying vec3 vSdNrm;
vec2 sdProject( vec3 p, vec3 n ) {
  vec3 a = abs( n );
  float ax = step( a.y, a.x ) * step( a.z, a.x );
  float ay = ( 1.0 - ax ) * step( a.z, a.y );
  float az = 1.0 - ax - ay;
  return ax * ( p.zy + vec2( 3.1, 0.0 ) ) + ay * ( p.xz + vec2( 0.0, 7.3 ) ) + az * ( p.xy + vec2( 5.7, 1.9 ) );
}
float sdHash( vec2 c ) { return fract( sin( dot( c, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
`;

const METAL_COLOR = `#include <color_fragment>
  float sdWear = 0.0;
  {
    vec3 sdN = normalize( vSdNrm );
    vec2 q = sdProject( vSdPos, sdN ) / ${PANEL.toFixed(3)};
    vec2 fw = fwidth( q );
    float fade = 1.0 - smoothstep( 0.22, 0.5, max( fw.x, fw.y ) );
    vec2 d = abs( fract( q - 0.5 ) - 0.5 );
    vec2 ln = 1.0 - smoothstep( vec2( 0.035 ), vec2( 0.035 ) + fw * 1.2, d );
    float groove = max( ln.x, ln.y ) * fade;
    float cell = sdHash( floor( q ) );
    float edge = smoothstep( 0.25, 1.0, length( fwidth( sdN ) ) );
    sdWear = edge * 0.9 * fade;
    float ao = mix( 0.74, 1.0, smoothstep( -0.9, 0.35, sdN.y ) ) * mix( 0.78, 1.0, smoothstep( -0.05, 0.3, vSdPos.y ) );
    vec3 c = diffuseColor.rgb * ( 1.0 - 0.27 * groove ) * ( 1.0 + ( cell - 0.5 ) * 0.07 * fade );
    c = mix( c, c * 1.3 + 0.025, sdWear * 0.55 );
    diffuseColor.rgb = c * ao;
  }`;
const METAL_ROUGH = `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, sdWear );`;

const ORGANIC_COLOR = `#include <color_fragment>
  {
    vec3 sdN = normalize( vSdNrm );
    vec2 q0 = sdProject( vSdPos, sdN ) / ${PLATE.toFixed(3)};
    float fwq = max( fwidth( q0.x ), fwidth( q0.y ) );
    float fade = 1.0 - smoothstep( 0.22, 0.5, fwq );
    vec2 q = q0;
    q.x += floor( q.y ) * 0.5;
    vec2 f = fract( q );
    vec2 cell = floor( q );
    float border = min( min( f.x, 1.0 - f.x ), min( f.y, 1.0 - f.y ) );
    float groove = ( 1.0 - smoothstep( 0.05, 0.05 + fwq * 1.2, border ) ) * fade;
    float h = sdHash( cell );
    float plate = 1.0 + ( h - 0.5 ) * 0.14 * fade;
    float h2 = sdHash( cell + 17.0 );
    vec2 pc = vec2( 0.3 + 0.4 * h2, 0.3 + 0.4 * sdHash( cell + 41.0 ) );
    float pore = ( h < 0.2 ? 1.0 : 0.0 ) * ( 1.0 - smoothstep( 0.07, 0.07 + fwq * 0.9, length( f - pc ) ) ) * fade;
    float ao = mix( 0.78, 1.0, smoothstep( -0.9, 0.35, sdN.y ) ) * mix( 0.82, 1.0, smoothstep( -0.05, 0.3, vSdPos.y ) );
    diffuseColor.rgb *= plate * ( 1.0 - 0.3 * groove ) * ( 1.0 - 0.45 * pore ) * ao;
  }`;

/** The shader edits for a kind, as plain strings, so tests can see what is injected without a GL context. */
export function surfaceChunks(kind: SurfaceKind): { vertexDecl: string; vertexSet: string; fragmentDecl: string; color: string; rough: string | null } {
  return { vertexDecl: VERTEX_DECL, vertexSet: VERTEX_SET, fragmentDecl: COMMON, color: kind === 'metal' ? METAL_COLOR : ORGANIC_COLOR, rough: kind === 'metal' ? METAL_ROUGH : null };
}

/** Rewrites a shader's source with the surface detail of `kind` (R3D-23). */
export function patchSurface(shader: { vertexShader: string; fragmentShader: string }, kind: SurfaceKind): void {
  const c = surfaceChunks(kind);
  shader.vertexShader = VERTEX_DECL + shader.vertexShader.replace('#include <begin_vertex>', c.vertexSet);
  let frag = shader.fragmentShader.replace('#include <color_fragment>', c.color);
  if (c.rough) frag = frag.replace('#include <roughnessmap_fragment>', c.rough);
  shader.fragmentShader = c.fragmentDecl + frag;
}

/** Give `mat` the surface detail of `kind`: the shader edit and a program key of its own. */
export function applySurface(mat: THREE.Material, kind: SurfaceKind): void {
  mat.onBeforeCompile = (shader) => patchSurface(shader, kind);
  mat.customProgramCacheKey = () => SURFACE_KEYS[kind];
}
