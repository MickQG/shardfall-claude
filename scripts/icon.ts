/**
 * Draws the desktop app icon from the game's own art: a voxel crystal cluster on a dark teal tile.
 * Usage: tsx scripts/icon.ts [outFile]   (default desktop/icon.png, 512x512)
 */
import { writeFileSync } from 'node:fs';
import { bakeModel } from '../src/render/voxel/bake';
import { crystalModel } from '../src/render/voxel/props';
import { encodePng } from './png';

const SIZE = 512;
const out = process.argv[2] ?? 'desktop/icon.png';
const px = new Uint8ClampedArray(SIZE * SIZE * 4);

// Rounded-square background with a soft radial glow.
const R = 96;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = Math.max(R - x, 0, x - (SIZE - 1 - R));
    const dy = Math.max(R - y, 0, y - (SIZE - 1 - R));
    if (dx * dx + dy * dy > R * R) continue;
    const d = Math.hypot(x - SIZE / 2, y - SIZE * 0.62) / (SIZE * 0.6);
    const g = Math.max(0, 1 - d);
    const i = (y * SIZE + x) * 4;
    px[i] = 11 + g * 20;
    px[i + 1] = 21 + g * 70;
    px[i + 2] = 28 + g * 55;
    px[i + 3] = 255;
  }
}

// The crystal cluster, enlarged with nearest-neighbour so the voxels stay crisp.
const s = bakeModel(crystalModel(4), { team: 0xffffff, facing: 0, facings: 1 });
let minX = s.width;
let maxX = 0;
let minY = s.height;
let maxY = 0;
for (let y = 0; y < s.height; y++) {
  for (let x = 0; x < s.width; x++) {
    if ((s.pixels[(y * s.width + x) * 4 + 3] as number) > 8) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
}
const w = maxX - minX + 1;
const h = maxY - minY + 1;
const scale = Math.floor((SIZE * 0.78) / Math.max(w, h));
const ox = Math.floor((SIZE - w * scale) / 2);
const oy = Math.floor((SIZE - h * scale) / 2) + 6;
for (let y = 0; y < h * scale; y++) {
  for (let x = 0; x < w * scale; x++) {
    const si = ((minY + Math.floor(y / scale)) * s.width + minX + Math.floor(x / scale)) * 4;
    const a = (s.pixels[si + 3] as number) / 255;
    if (a === 0) continue;
    const di = ((oy + y) * SIZE + ox + x) * 4;
    for (let c = 0; c < 3; c++) px[di + c] = (s.pixels[si + c] as number) * a + (px[di + c] as number) * (1 - a);
    px[di + 3] = Math.max(px[di + 3] as number, a * 255);
  }
}

writeFileSync(out, encodePng(SIZE, SIZE, px));
console.log(`wrote ${out} (${SIZE}x${SIZE})`);
