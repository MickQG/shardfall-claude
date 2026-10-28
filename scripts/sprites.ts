/**
 * Bakes every voxel model from every facing into a PNG contact sheet, for eyeballing art without starting the game.
 * Usage: tsx scripts/sprites.ts [outFile] [kind...]
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { bakeModel } from '../src/render/voxel/bake';
import { SPRITE_MODELS } from '../src/render/voxel/models';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = (crcTable[(c ^ b) & 255] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(w: number, h: number, rgba: Uint8ClampedArray): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = process.argv[2] ?? 'sprites.png';
const kinds = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(SPRITE_MODELS);
const FACINGS = 16;
const COLS = 8;
const GROUND = [0x2f, 0x4f, 0x3c];

const sheets = kinds.map((k) => {
  const model = (SPRITE_MODELS[k] as () => ReturnType<(typeof SPRITE_MODELS)[string]>)();
  return Array.from({ length: FACINGS }, (_, f) => bakeModel(model, { team: 0x3fa0ff, facing: f, facings: FACINGS }));
});
const cw = Math.max(...sheets.flat().map((s) => s.width));
const ch = Math.max(...sheets.flat().map((s) => s.height));
const rowsPer = FACINGS / COLS;
const W = cw * COLS;
const H = ch * rowsPer * kinds.length;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  img[i * 4] = GROUND[0] as number;
  img[i * 4 + 1] = GROUND[1] as number;
  img[i * 4 + 2] = GROUND[2] as number;
  img[i * 4 + 3] = 255;
}
sheets.forEach((sprites, ki) => {
  sprites.forEach((s, f) => {
    const ox = (f % COLS) * cw + Math.floor((cw - s.width) / 2);
    const oy = (ki * rowsPer + Math.floor(f / COLS)) * ch + Math.floor((ch - s.height) / 2);
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const a = (s.pixels[(y * s.width + x) * 4 + 3] as number) / 255;
        if (a === 0) continue;
        const p = ((oy + y) * W + ox + x) * 4;
        for (let c = 0; c < 3; c++) img[p + c] = Math.round((s.pixels[(y * s.width + x) * 4 + c] as number) * a + (img[p + c] as number) * (1 - a));
      }
    }
  });
});
writeFileSync(out, png(W, H, img));
console.log(`wrote ${out} (${W}x${H}, ${kinds.join(', ')})`);
