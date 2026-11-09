/** What the browser's WebGL2 support looks like, probed once at startup. */
export interface GpuProbe {
  webgl2: boolean;
  /** The WebGL renderer string (unmasked where the browser allows), e.g. the graphics chip's name. */
  renderer: string;
}

/** Renderer strings of software rasterisers: the 3D view would crawl there, so the classic view is used instead. */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

/**
 * The world view for this session (R3D-1): `?renderer=3d` or `?renderer=classic` force one; otherwise the 3D view on
 * hardware WebGL2, and the classic view where WebGL2 is missing or only rendered in software. Pure.
 */
export function chooseRenderer(param: string | null, gpu: GpuProbe): '3d' | 'classic' {
  if (param === 'classic') return 'classic';
  if (!gpu.webgl2) return 'classic';
  if (param === '3d') return '3d';
  return SOFTWARE.test(gpu.renderer) ? 'classic' : '3d';
}

/** What this browser's WebGL2 is: missing, software-rendered, or on a graphics chip. Shared by the menu and the game. */
export function probeGpu(): GpuProbe {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, renderer: '' };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, renderer };
  } catch {
    return { webgl2: false, renderer: '' };
  }
}
