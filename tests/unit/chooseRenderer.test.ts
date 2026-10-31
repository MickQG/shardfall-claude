import { describe, expect, it } from 'vitest';
import { chooseRenderer } from '../../src/render/chooseRenderer';

describe('renderer choice', () => {
  const gpu = { webgl2: true, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' };
  const soft = { webgl2: true, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)' };
  const none = { webgl2: false, renderer: '' };

  it('R3D-1: 3D by default on a graphics chip, classic without WebGL2 or on a software renderer, and the switches win', () => {
    expect(chooseRenderer(null, gpu)).toBe('3d');
    expect(chooseRenderer(null, soft)).toBe('classic');
    expect(chooseRenderer(null, { webgl2: true, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe('classic');
    expect(chooseRenderer(null, none)).toBe('classic');
    expect(chooseRenderer('classic', gpu)).toBe('classic');
    expect(chooseRenderer('3d', soft)).toBe('3d');
    expect(chooseRenderer('3d', none)).toBe('classic'); // no WebGL2, no 3D
    expect(chooseRenderer('anything', gpu)).toBe('3d');
  });
});
