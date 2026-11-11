import * as THREE from 'three';

/**
 * Instanced batches (R3D-13): every drawn model part (one shape in one team colour and one material) is a single
 * InstancedMesh, refilled each frame with the world matrices of all its visible copies. Draw calls therefore depend on
 * the number of distinct parts on screen, not on the number of units.
 */

interface Batch {
  mesh: THREE.InstancedMesh;
  n: number;
  cap: number;
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  shadow: boolean;
  order: number;
  stand: THREE.BufferGeometry | null;
  /** Shadow-only copy of the batch drawn from the shape's stand-in (PERF-4); shares the batch's instance matrices. */
  proxy: THREE.InstancedMesh | null;
}

/** Layer the shadow stand-ins live on: the camera never sees it, the shadow pass enables it (PERF-4). */
export const SHADOW_LAYER = 1;
/** Stand-ins are never shaded: the shadow pass swaps in a depth material anyway. */
const SHADOW_MAT = new THREE.MeshBasicMaterial();

const WHITE = new THREE.Color(1, 1, 1);

export class Instancer {
  private batches = new Map<string, Batch>();

  constructor(private readonly parent: THREE.Object3D) {}

  /** Start a frame: every batch empties. */
  begin(): void {
    for (const b of this.batches.values()) b.n = 0;
  }

  /** Queue one copy of `geo` with `mat` at `matrix`, tinted by `tint` (multiplies the vertex colours). */
  push(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, matrix: THREE.Matrix4, tint: THREE.Color = WHITE, order = 0, stand: THREE.BufferGeometry | null = null): void {
    let b = this.batches.get(key);
    if (!b) {
      b = this.make(geo, mat, shadow, 16, order, stand);
      this.batches.set(key, b);
    }
    if (b.n >= b.cap) this.grow(b);
    b.mesh.setMatrixAt(b.n, matrix);
    b.mesh.setColorAt(b.n, tint);
    b.n++;
  }

  /** Finish a frame: upload what was queued. */
  end(): void {
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      if (b.proxy) {
        b.proxy.count = b.n;
        b.proxy.visible = b.n > 0;
      }
      if (b.n > 0) {
        b.mesh.instanceMatrix.needsUpdate = true;
        if (b.mesh.instanceColor) b.mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Batches with something to draw this frame (one draw call each, plus shadows). */
  get drawCalls(): number {
    let n = 0;
    for (const b of this.batches.values()) if (b.n > 0) n++;
    return n;
  }

  get instances(): number {
    let n = 0;
    for (const b of this.batches.values()) n += b.n;
    return n;
  }

  private make(geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, cap: number, order: number, stand: THREE.BufferGeometry | null): Batch {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.renderOrder = order;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, WHITE); // creates the colour attribute up front, so the shader never changes
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    // With a stand-in the batch only receives shadows; the stand-in casts them (PERF-4).
    mesh.castShadow = shadow && !stand;
    mesh.receiveShadow = shadow;
    // Copies are culled per unit before they are queued; the batch's own bounds are meaningless.
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.parent.add(mesh);
    let proxy: THREE.InstancedMesh | null = null;
    if (shadow && stand) {
      proxy = new THREE.InstancedMesh(stand, SHADOW_MAT, cap);
      proxy.instanceMatrix = mesh.instanceMatrix;
      proxy.layers.set(SHADOW_LAYER);
      proxy.castShadow = true;
      proxy.frustumCulled = false;
      proxy.count = 0;
      this.parent.add(proxy);
    }
    return { mesh, n: 0, cap, geo, mat, shadow, order, proxy, stand };
  }

  /** Double a batch's capacity in place, keeping what is already queued. */
  private grow(b: Batch): void {
    const made = this.make(b.geo, b.mat, b.shadow, b.cap * 2, b.order, b.stand);
    const bigger = made.mesh;
    (bigger.instanceMatrix.array as Float32Array).set(b.mesh.instanceMatrix.array as Float32Array);
    (bigger.instanceColor!.array as Float32Array).set(b.mesh.instanceColor!.array as Float32Array);
    this.parent.remove(b.mesh);
    b.mesh.dispose(); // frees the instance buffers only; the geometry and material are shared
    if (b.proxy) {
      this.parent.remove(b.proxy);
      b.proxy.dispose();
    }
    b.mesh = bigger;
    b.proxy = made.proxy;
    b.cap *= 2;
  }
}
