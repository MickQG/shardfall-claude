/**
 * GPU time of a frame (R3D-29) from EXT_disjoint_timer_query_webgl2 when the browser offers it. Results arrive a few
 * frames late; `ms` is the latest valid reading (smoothed), or null when the extension is missing or unreliable.
 */
export class GpuTimer {
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  /** Smoothed GPU time of a frame, ms; null until a reading arrives. */
  ms: number | null = null;

  constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    if (typeof WebGL2RenderingContext === 'undefined' || !(context instanceof WebGL2RenderingContext)) return;
    const ext = context.getExtension('EXT_disjoint_timer_query_webgl2');
    if (ext) {
      this.ext = ext;
      this.gl = context;
    }
  }

  get supported(): boolean {
    return this.ext !== null;
  }

  begin(): void {
    const { gl, ext } = this;
    if (!gl || !ext || this.active || this.pending.length > 6) return;
    const q = gl.createQuery();
    if (!q) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  end(): void {
    const { gl, ext } = this;
    if (!gl || !ext || !this.active) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  /** Collect finished queries; call once a frame. */
  poll(): void {
    const { gl, ext } = this;
    if (!gl || !ext) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0]!;
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this.pending.shift();
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      gl.deleteQuery(q);
      if (disjoint) continue;
      const ms = ns / 1e6;
      this.ms = this.ms === null ? ms : this.ms + (ms - this.ms) * 0.2;
    }
  }
}
