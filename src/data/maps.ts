import type { Faction } from './defs';
import type { BuildingSpawn, GameConfig, MapDef, PlayerSetup, UnitSpawn } from '../sim';

export const MAP_SIZE = 96;

/** Start positions: top-left corner for player 0, bottom-right for player 1. */
export const STARTS = [
  { tx: 10, ty: 10 },
  { tx: 82, ty: 82 },
] as const;

interface Blob {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

/** Rock outcrops for half of the map; the other half is the 180-degree mirror. */
const ROCKS: Blob[] = [
  { cx: 30, cy: 18, rx: 5, ry: 2 },
  { cx: 18, cy: 32, rx: 2, ry: 5 },
  { cx: 38, cy: 34, rx: 4, ry: 3 },
  { cx: 28, cy: 50, rx: 3, ry: 6 },
  { cx: 46, cy: 22, rx: 2, ry: 3 },
  { cx: 58, cy: 40, rx: 3, ry: 2 },
];

interface Field {
  cx: number;
  cy: number;
  r: number;
  amount: number;
}

const FIELDS: Field[] = [
  { cx: 22, cy: 12, r: 2, amount: 3000 },
  { cx: 12, cy: 24, r: 2, amount: 2500 },
  { cx: 34, cy: 64, r: 2, amount: 3500 },
];
const CENTRE_AMOUNT = 5000;

/** A symmetric 96x96 two-player map with chokepoints, rock outcrops and contested shard fields. */
export function skirmishMap(): MapDef {
  const W = MAP_SIZE;
  const heights = new Array<number>(W * W).fill(0);
  const blocked = new Array<number>(W * W).fill(0);
  const shards = new Array<number>(W * W).fill(0);
  const set = (x: number, y: number, rock: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    const i = y * W + x;
    heights[i] = Math.max(heights[i] as number, rock);
    blocked[i] = 1;
  };
  for (const b of ROCKS) {
    for (let y = b.cy - b.ry; y <= b.cy + b.ry; y++) {
      for (let x = b.cx - b.rx; x <= b.cx + b.rx; x++) {
        const d = ((x - b.cx) / (b.rx + 0.5)) ** 2 + ((y - b.cy) / (b.ry + 0.5)) ** 2;
        if (d > 1) continue;
        const h = d < 0.45 ? 2 : 1;
        set(x, y, h);
        set(W - 1 - x, W - 1 - y, h);
      }
    }
  }
  const field = (f: Field, mirror: boolean): void => {
    for (let y = f.cy - f.r; y <= f.cy + f.r; y++) {
      for (let x = f.cx - f.r; x <= f.cx + f.r; x++) {
        if ((x - f.cx) ** 2 + (y - f.cy) ** 2 > f.r * f.r + 1) continue;
        shards[y * W + x] = f.amount;
        if (mirror) shards[(W - 1 - y) * W + (W - 1 - x)] = f.amount;
      }
    }
  };
  for (const f of FIELDS) field(f, true);
  // The centre field is a disc around the map's exact centre (47.5, 47.5), so it is point-symmetric.
  for (let y = 43; y <= 52; y++) for (let x = 43; x <= 52; x++) if ((x - 47.5) ** 2 + (y - 47.5) ** 2 <= 3.6 ** 2) shards[y * W + x] = CENTRE_AMOUNT;
  return { width: W, height: W, heights, blocked, shards };
}

function startingForce(owner: number, faction: Faction): { buildings: BuildingSpawn[]; units: UnitSpawn[] } {
  const human = faction === 'human';
  // Player 1 mirrors player 0 through the map centre, so footprints are reflected too.
  const b = (kind: string, dx: number, dy: number, w: number, h: number): BuildingSpawn => ({
    owner,
    kind,
    tx: owner === 0 ? STARTS[0].tx + dx : MAP_SIZE - 1 - (STARTS[0].tx + dx + w - 1),
    ty: owner === 0 ? STARTS[0].ty + dy : MAP_SIZE - 1 - (STARTS[0].ty + dy + h - 1),
  });
  const u = (kind: string, dx: number, dy: number): UnitSpawn => ({
    owner,
    kind,
    tx: owner === 0 ? STARTS[0].tx + dx : MAP_SIZE - 1 - (STARTS[0].tx + dx),
    ty: owner === 0 ? STARTS[0].ty + dy : MAP_SIZE - 1 - (STARTS[0].ty + dy),
  });
  const hq = human ? 'hum_hq' : 'ali_hq';
  const power = human ? 'hum_reactor' : 'ali_generator';
  const ref = human ? 'hum_refinery' : 'ali_extractor';
  const hauler = human ? 'hum_hauler' : 'ali_gorger';
  const inf = human ? 'hum_rifleman' : 'ali_skitter';
  return {
    buildings: [b(hq, 0, 0, 3, 3), b(power, 0, 4, 2, 2), b(ref, 4, 0, 3, 2)],
    units: [u(hauler, 5, 4), u(inf, 4, 6), u(inf, 5, 6), u(inf, 6, 6)],
  };
}

export interface SkirmishOptions {
  factions?: [Faction, Faction];
  /** Percent shard-income bonus per player. */
  bonuses?: [number, number];
  credits?: number;
}

export function skirmishConfig(seed = 1, o: SkirmishOptions = {}): GameConfig {
  const f = o.factions ?? ['human', 'alien'];
  const a = startingForce(0, f[0]);
  const b = startingForce(1, f[1]);
  const players: PlayerSetup[] = [
    { faction: f[0], credits: o.credits ?? 1800, bonus: o.bonuses?.[0] ?? 0 },
    { faction: f[1], credits: o.credits ?? 1800, bonus: o.bonuses?.[1] ?? 0 },
  ];
  return { seed, map: skirmishMap(), players, buildings: [...a.buildings, ...b.buildings], units: [...a.units, ...b.units] };
}

/** Small deterministic test terrain: a ridge ring with gaps around the centre. */
export function demoMap(width = 96, height = 96): MapDef {
  const heights: number[] = [];
  const blocked: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2;
      const dy = y - height / 2;
      const d = Math.sqrt(dx * dx + dy * dy);
      const ridge = d > 8 && d < 14;
      heights.push(ridge ? 1 + (((x + y) >> 3) & 1) : 0);
      const gap = (x + y) % 12 < 3;
      blocked.push(ridge && !gap ? 1 : 0);
    }
  }
  return { width, height, heights, blocked };
}

/** Dev/test scenario: an enemy squad starts next to the player's base so a fight begins immediately. */
export function duelConfig(seed = 1, o: SkirmishOptions = {}): GameConfig {
  const c = skirmishConfig(seed, o);
  const enemyHuman = (o.factions?.[1] ?? 'alien') === 'human';
  const raiders: UnitSpawn[] = enemyHuman
    ? [
        { owner: 1, kind: 'hum_rifleman', tx: 19, ty: 17 },
        { owner: 1, kind: 'hum_rifleman', tx: 20, ty: 17 },
        { owner: 1, kind: 'hum_rocketeer', tx: 21, ty: 18 },
      ]
    : [
        { owner: 1, kind: 'ali_skitter', tx: 19, ty: 17 },
        { owner: 1, kind: 'ali_skitter', tx: 20, ty: 17 },
        { owner: 1, kind: 'ali_spitter', tx: 21, ty: 18 },
      ];
  return { ...c, units: [...(c.units ?? []), ...raiders] };
}
