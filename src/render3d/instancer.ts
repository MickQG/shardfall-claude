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
}

const WHITE = new THREE.Color(1, 1, 1);

export class Instancer {
  private batches = new Map<string, Batch>();

  constructor(private readonly parent: THREE.Object3D) {}

  /** Start a frame: every batch empties. */
  begin(): void {
    for (const b of this.batches.values()) b.n = 0;
  }

  /** Queue one copy of `geo` with `mat` at `matrix`, tinted by `tint` (multiplies the vertex colours). */
  push(key: string, geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, matrix: THREE.Matrix4, tint: THREE.Color = WHITE, order = 0): void {
    let b = this.batches.get(key);
    if (!b) {
      b = this.make(geo, mat, shadow, 16, order);
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

  private make(geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, cap: number, order: number): Batch {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.renderOrder = order;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, WHITE); // creates the colour attribute up front, so the shader never changes
    mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = shadow;
    mesh.receiveShadow = shadow;
    // Copies are culled per unit before they are queued; the batch's own bounds are meaningless.
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.parent.add(mesh);
    return { mesh, n: 0, cap, geo, mat, shadow, order };
  }

  /** Double a batch's capacity in place, keeping what is already queued. */
  private grow(b: Batch): void {
    const bigger = this.make(b.geo, b.mat, b.shadow, b.cap * 2, b.order).mesh;
    (bigger.instanceMatrix.array as Float32Array).set(b.mesh.instanceMatrix.array as Float32Array);
    (bigger.instanceColor!.array as Float32Array).set(b.mesh.instanceColor!.array as Float32Array);
    this.parent.remove(b.mesh);
    b.mesh.dispose(); // frees the instance buffers only; the geometry and material are shared
    b.mesh = bigger;
    b.cap *= 2;
  }
}
