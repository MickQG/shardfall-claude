/**
 * Bakes every voxel model from every facing into a PNG contact sheet, for eyeballing art without starting the game.
 * Usage: tsx scripts/sprites.ts [outFile] [kind...]
 */
import { writeFileSync } from 'node:fs';
import { bakeModel } from '../src/render/voxel/bake';
import { BUILDING_MODELS } from '../src/render/voxel/buildings';
import { composeUnit, type Layer } from '../src/render/voxel/compose';
import { UNIT_MODELS } from '../src/render/voxel/models';
import { encodePng } from './png';

interface Flat {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

/** Flattens a unit's layers (hull, then turret) into one image, anchored layers laid over each other. */
function flatten(layers: Layer[]): Flat {
  const x0 = Math.floor(Math.min(...layers.map((l) => l.dx - l.sprite.anchorX)));
  const y0 = Math.floor(Math.min(...layers.map((l) => l.dy - l.sprite.anchorY)));
  const x1 = Math.ceil(Math.max(...layers.map((l) => l.dx - l.sprite.anchorX + l.sprite.width)));
  const y1 = Math.ceil(Math.max(...layers.map((l) => l.dy - l.sprite.anchorY + l.sprite.height)));
  const width = x1 - x0;
  const height = y1 - y0;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (const l of layers) {
    const ox = Math.round(l.dx - l.sprite.anchorX - x0);
    const oy = Math.round(l.dy - l.sprite.anchorY - y0);
    for (let y = 0; y < l.sprite.height; y++) {
      for (let x = 0; x < l.sprite.width; x++) {
        const i = (y * l.sprite.width + x) * 4;
        const a = (l.sprite.pixels[i + 3] as number) / 255;
        if (a === 0) continue;
        const p = ((oy + y) * width + ox + x) * 4;
        const da = (pixels[p + 3] as number) / 255;
        const oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) pixels[p + c] = ((l.sprite.pixels[i + c] as number) * a + (pixels[p + c] as number) * da * (1 - a)) / oa;
        pixels[p + 3] = oa * 255;
      }
    }
  }
  return { width, height, pixels };
}

const out = process.argv[2] ?? 'sprites.png';
const kinds = process.argv.slice(3).length ? process.argv.slice(3) : Object.keys(UNIT_MODELS);
/** Building kinds are laid out as one grid (one picture each); units get a row pair of 16 facings each. */
const BUILDINGS = kinds.every((k) => k in BUILDING_MODELS);
const FACINGS = BUILDINGS ? kinds.length : 16;
const COLS = BUILDINGS ? 4 : 8;
const GROUND = [0x2f, 0x4f, 0x3c];

const sheets = BUILDINGS
  ? [kinds.map((k) => flatten([{ sprite: bakeModel((BUILDING_MODELS[k] as NonNullable<(typeof BUILDING_MODELS)[string]>)(), { team: 0x3fa0ff, facing: 0, facings: 1 }), dx: 0, dy: 0 }]))]
  : kinds.map((k) => {
  const model = (UNIT_MODELS[k] as NonNullable<(typeof UNIT_MODELS)[string]>)();
  return Array.from({ length: FACINGS }, (_, f) => flatten(composeUnit(model, 0x3fa0ff, f, f, FACINGS)));
});
const cw = Math.max(...sheets.flat().map((s) => s.width));
const ch = Math.max(...sheets.flat().map((s) => s.height));
const rowsPer = Math.ceil(FACINGS / COLS);
const W = cw * COLS;
const H = ch * rowsPer * sheets.length;
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
writeFileSync(out, encodePng(W, H, img));
console.log(`wrote ${out} (${W}x${H}, ${kinds.join(', ')})`);
