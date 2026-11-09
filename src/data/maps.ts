import { buildingDef, type Faction } from './defs';
import type { BuildingSpawn, GameConfig, MapDef, PlayerSetup, UnitSpawn } from '../sim';
import { generatedMap } from './mapgen';
import { buildMap, DEFAULT_START, MAP_SIZE, turnMap, type Blob, type Field, type MapPlan } from './mapPlan';

export { MAP_SIZE } from './mapPlan';
export { MAP_SEED_MAX, mapSeedOf, resolveMapSeed } from './mapgen';

/** Shard fields beside a base at DEFAULT_START, so every start has a working economy (Riverbed has its own). */
const HOME_FIELDS: Field[] = [
  { cx: 22, cy: 12, r: 2, amount: 3000 },
  { cx: 12, cy: 24, r: 2, amount: 2500 },
];

/**
 * Crossroads: rock outcrops funnel the armies through chokepoints; a pond on each base's outer flank (cover at its back,
 * clear of its exits) and lakes beside the mid-map routes that narrow them without closing them (MAP-3).
 */
const CROSSROADS: MapPlan = {
  rocks: [
    { cx: 30, cy: 18, rx: 5, ry: 2 },
    { cx: 18, cy: 32, rx: 2, ry: 5 },
    { cx: 38, cy: 34, rx: 4, ry: 3 },
    { cx: 28, cy: 50, rx: 3, ry: 6 },
    { cx: 46, cy: 22, rx: 2, ry: 3 },
    { cx: 58, cy: 40, rx: 3, ry: 2 },
  ],
  lakes: [
    { cx: 5, cy: 34, rx: 2, ry: 4 },
    { cx: 36, cy: 4, rx: 4, ry: 2 },
    { cx: 15, cy: 52, rx: 3, ry: 3 },
    { cx: 60, cy: 25, rx: 3, ry: 3 },
  ],
  fields: [...HOME_FIELDS, { cx: 34, cy: 64, r: 2, amount: 3500 }],
  centre: { r: 3.6, amount: 5000 },
};

/**
 * Riverbed (MAP-5): a river winds from corner to corner between the bases and is crossed in three places: a land bridge
 * at the centre over the richest field, and a ford toward each flank. Rich fields lie on both banks near the crossings.
 */
const RIVERBED: MapPlan = {
  // The bases sit at the middle of the north-east and south-west edges, either side of the river (MAP-5).
  start: { tx: 45, ty: 9 },
  rocks: [
    { cx: 30, cy: 18, rx: 5, ry: 2 },
    { cx: 18, cy: 32, rx: 2, ry: 5 },
    { cx: 36, cy: 40, rx: 2, ry: 2 },
    { cx: 50, cy: 22, rx: 3, ry: 2 },
  ],
  lakes: [{ cx: 4, cy: 36, rx: 2, ry: 3 }],
  // Home fields either side of the base; a field near each base's own ford on its bank, and one across the other ford.
  fields: [
    { cx: 58, cy: 11, r: 2, amount: 3000 },
    { cx: 37, cy: 11, r: 2, amount: 2500 },
    { cx: 31, cy: 54, r: 2, amount: 4000 },
    { cx: 56, cy: 30, r: 2, amount: 3500 },
  ],
  centre: { r: 3.6, amount: 6000 },
  water: (x, y) => {
    // Along the anti-diagonal x + y = 95, its own mirror image, meandering by an odd function of the position along it.
    const along = x - y;
    const across = x + y - (MAP_SIZE - 1);
    if (Math.abs(across - 7 * Math.sin(along * 0.09)) > 2.8) return false;
    // Crossings: the land bridge at the centre and a ford toward each flank.
    if (Math.abs(along) <= 6) return false;
    if (Math.abs(Math.abs(along) - 44) <= 3) return false;
    return true;
  },
};

/**
 * The Highlands ridge ring (half of it: the mirror adds the rest) as chains of overlapping outcrops along the sides of a
 * square around the centre, aligned with the tile grid, so the ridges read as rounded rock rather than a staircase (in
 * the isometric view the square is a diamond). Each side waves a little and leaves a pass at its middle, and the two
 * corners facing the bases are open, so the straight road between the bases runs through the basin.
 */
function ridgeRing(): Blob[] {
  const c = Math.round((MAP_SIZE - 1) / 2); // 48: the ring sits a half tile off true centre; the mirror balances it
  const R = 20;
  const pass = 4; // tiles either side of a pass's axis
  const out: Blob[] = [];
  for (let t = -R; t <= R; t += 4) {
    if (Math.abs(t) <= pass + 1) continue;
    const wave = Math.round(1.2 * Math.sin(t * 0.35));
    // The north side runs along x and the east side along y; the mirror makes the south and west sides. The north-east
    // corner belongs to the north side alone, so no two chains pile up there; the north-west and south-east corners,
    // which face the bases, are left open.
    if (t > -R + 4) out.push({ cx: c + t, cy: c - R + wave, rx: 3, ry: 2 });
    if (t > -R && t < R - 4) out.push({ cx: c + R - wave, cy: c + t, rx: 2, ry: 3 });
  }
  return out;
}

/**
 * Highlands (MAP-6): a ring of ridges walls in a central basin with a pool at its heart, entered by a pass in the middle
 * of each side and by a wide gap at each corner facing a base; mesas guard the approaches from each base. The richest
 * fields lie in the basin, beside the pool.
 */
const HIGHLANDS: MapPlan = {
  // Laid out with the bases top and bottom, then turned so they face each other east and west (MAP-6).
  turn: true,
  rocks: [
    ...ridgeRing(),
    { cx: 34, cy: 13, rx: 5, ry: 2 },
    { cx: 13, cy: 34, rx: 2, ry: 5 },
    { cx: 9, cy: 47, rx: 3, ry: 2 },
    { cx: 47, cy: 9, rx: 2, ry: 3 },
  ],
  lakes: [{ cx: 4, cy: 30, rx: 2, ry: 3 }],
  fields: [...HOME_FIELDS, { cx: 38, cy: 46, r: 2, amount: 4500 }, { cx: 20, cy: 75, r: 2, amount: 3500 }],
  centre: { r: 0, amount: 0 },
  water: (x, y) => Math.hypot(x - (MAP_SIZE - 1) / 2, y - (MAP_SIZE - 1) / 2) <= 2.6,
};

/** The hand-made maps (MAP-4). */
export type HandMadeMapId = 'crossroads' | 'riverbed' | 'highlands';
/** A skirmish map: one of the hand-made ones, or the map generated from a map seed (MAP-7). */
export type MapId = HandMadeMapId | 'generated';

/** The skirmish maps in menu order; the first is the default (MAP-4). */
export const MAPS: readonly { id: HandMadeMapId; name: string; blurb: string; plan: MapPlan }[] = [
  { id: 'crossroads', name: 'Crossroads', blurb: 'Rock outcrops and lakes funnel the fight through chokepoints.', plan: CROSSROADS },
  { id: 'riverbed', name: 'Riverbed', blurb: 'A river between the bases: hold the bridge and the two fords.', plan: RIVERBED },
  { id: 'highlands', name: 'Highlands', blurb: 'A ring of ridges around a rich basin, entered by its passes and corner gaps.', plan: HIGHLANDS },
];

export const DEFAULT_MAP: MapId = 'crossroads';

/** A map id from untrusted input (the address bar, saved settings), or the default. */
export const mapIdOf = (v: unknown): MapId => (v === 'generated' ? 'generated' : (MAPS.find((m) => m.id === v)?.id ?? DEFAULT_MAP));

/**
 * A 96x96 point-symmetric two-player skirmish map (MAP-2, MAP-4): Crossroads unless another is named; for 'generated',
 * the map of `mapSeed` (MAP-7, MAP-9).
 */
export function skirmishMap(id: MapId = DEFAULT_MAP, mapSeed = 0): MapDef {
  const plan = planOf(id, mapSeed);
  const m = buildMap(plan);
  return plan.turn ? turnMap(m) : m;
}

const planOf = (id: MapId, mapSeed = 0): MapPlan => (id === 'generated' ? generatedMap(mapSeed).plan : MAPS.find((m) => m.id === id)!.plan);

/**
 * Where a footprint `w` by `h` laid out at offset (dx, dy) from player 0's start ends up for `owner` on a map: turned with
 * the map (keeping its centre; a building is never rotated, so an oblong one is re-centred on the nearest tile), and for
 * player 1 mirrored through the map centre.
 */
function footprint(plan: MapPlan, owner: number, dx: number, dy: number, w: number, h: number): { tx: number; ty: number } {
  const s = plan.start ?? DEFAULT_START;
  let tx = s.tx + dx;
  let ty = s.ty + dy;
  if (plan.turn) [tx, ty] = [MAP_SIZE - 1 - (ty + h - 1) + Math.floor((h - w) / 2), tx + Math.floor((w - h) / 2)];
  return owner === 0 ? { tx, ty } : { tx: MAP_SIZE - 1 - (tx + w - 1), ty: MAP_SIZE - 1 - (ty + h - 1) };
}

/** Each player's start on a map: the top-left tile of their HQ (MAP-5, MAP-6). */
export function mapStarts(id: MapId = DEFAULT_MAP, mapSeed = 0): [{ tx: number; ty: number }, { tx: number; ty: number }] {
  const plan = planOf(id, mapSeed);
  return [footprint(plan, 0, 0, 0, 3, 3), footprint(plan, 1, 0, 0, 3, 3)];
}

function startingForce(owner: number, faction: Faction, plan: MapPlan): { buildings: BuildingSpawn[]; units: UnitSpawn[] } {
  const human = faction === 'human';
  // Player 1 mirrors player 0 through the map centre, so footprints are reflected too.
  const b = (kind: string, dx: number, dy: number, w: number, h: number): BuildingSpawn => ({ owner, kind, ...footprint(plan, owner, dx, dy, w, h) });
  const u = (kind: string, dx: number, dy: number): UnitSpawn => ({ owner, kind, ...footprint(plan, owner, dx, dy, 1, 1) });
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
  /** Which skirmish map (MAP-4); Crossroads by default. */
  map?: MapId;
  /** The map seed of a generated map (MAP-7). */
  mapSeed?: number;
}

export function skirmishConfig(seed = 1, o: SkirmishOptions = {}): GameConfig {
  const f = o.factions ?? ['human', 'alien'];
  const plan = planOf(o.map ?? DEFAULT_MAP, o.mapSeed);
  const a = startingForce(0, f[0], plan);
  const b = startingForce(1, f[1], plan);
  const players: PlayerSetup[] = [
    { faction: f[0], credits: o.credits ?? 1800, bonus: o.bonuses?.[0] ?? 0 },
    { faction: f[1], credits: o.credits ?? 1800, bonus: o.bonuses?.[1] ?? 0 },
  ];
  return { seed, map: skirmishMap(o.map, o.mapSeed), players, buildings: [...a.buildings, ...b.buildings], units: [...a.units, ...b.units] };
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

/** Dev/test scenario: the enemy has a single weak building next to the player's squad, so the game ends within seconds. */
export function rushConfig(seed = 1, o: SkirmishOptions = {}): GameConfig {
  const c = skirmishConfig(seed, o);
  const enemyBuilding = (o.factions?.[1] ?? 'alien') === 'human' ? 'hum_barracks' : 'ali_nest';
  const mine = (c.buildings ?? []).filter((b) => b.owner === 0);
  return { ...c, buildings: [...mine, { owner: 1, kind: enemyBuilding, tx: 20, ty: 16 }], units: (c.units ?? []).filter((u) => u.owner === 0) };
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

/**
 * Graphics showcase (NXT-2): a compact battlefield with two-level plateaus, a pond and stream (blocked, drawn as water),
 * a shard field, an Aegis base and a Vrax base, and an army each (rifle squads and Bulwark tanks against skitterer
 * squads and brutes). The game client sends both armies into each other; there is no AI. `extra` adds that many more
 * units per side (alternating squads and tanks) for frame-time stress tests.
 */
export function showcaseConfig(seed = 1, extra = 0, side: Faction = 'human'): GameConfig {
  const W = 36;
  const heights = new Array<number>(W * W).fill(0);
  const blocked = new Array<number>(W * W).fill(0);
  const shards = new Array<number>(W * W).fill(0);
  const set = (x0: number, y0: number, x1: number, y1: number, f: (i: number) => void): void => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * W + x);
  };
  const plateau = (x0: number, y0: number, x1: number, y1: number, lvl: number): void =>
    set(x0, y0, x1, y1, (i) => {
      heights[i] = Math.max(heights[i] as number, lvl);
      blocked[i] = 1;
    });
  plateau(14, 2, 21, 6, 1);
  plateau(16, 3, 19, 5, 2);
  plateau(2, 16, 7, 22, 1);
  plateau(3, 18, 5, 20, 2);
  plateau(27, 12, 33, 17, 1);
  set(10, 24, 15, 30, (i) => (blocked[i] = 1)); // pond
  set(16, 27, 19, 29, (i) => (blocked[i] = 1)); // stream
  set(22, 8, 25, 11, (i) => (shards[i] = 400));
  const b = (owner: number, kind: string, tx: number, ty: number): BuildingSpawn => ({ owner, kind, tx, ty });
  const u = (owner: number, kind: string, tx: number, ty: number): UnitSpawn => ({ owner, kind, tx, ty });
  // Stress-test crowds fill free, unblocked tiles outward from each army, one unit per tile.
  const taken = new Set<number>([[12, 11], [13, 12], [11, 13], [14, 13], [12, 14], [22, 20], [23, 21], [21, 22], [24, 20], [22, 22], [24, 22]].map(([x, y]) => (y as number) * W + (x as number)));
  for (const [kind, bx, by] of [['hum_hq', 3, 3], ['hum_reactor', 3, 8], ['hum_factory', 8, 3], ['ali_hq', 28, 28], ['ali_generator', 32, 24], ['ali_pit', 23, 30]] as const) {
    const d = buildingDef(kind);
    for (let y = by; y < by + d.h; y++) for (let x = bx; x < bx + d.w; x++) taken.add(y * W + x);
  }
  const free = (cx: number, cy: number, n: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r < W && out.length < n; r++)
      for (let y = cy - r; y <= cy + r && out.length < n; y++)
        for (let x = cx - r; x <= cx + r && out.length < n; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || x < 1 || y < 1 || x >= W - 1 || y >= W - 1) continue;
          const i = y * W + x;
          if (blocked[i] || taken.has(i)) continue;
          taken.add(i);
          out.push([x, y]);
        }
    return out;
  };
  const crowd: UnitSpawn[] = [
    ...free(12, 13, extra).map(([x, y], k) => u(0, k % 3 === 2 ? 'hum_tank' : 'hum_rifleman', x, y)),
    ...free(23, 21, extra).map(([x, y], k) => u(1, k % 3 === 2 ? 'ali_brute' : 'ali_skitter', x, y)),
  ];
  const cfg: GameConfig = {
    seed,
    map: { width: W, height: W, heights, blocked, shards },
    players: [
      { faction: 'human', credits: 0 },
      { faction: 'alien', credits: 0 },
    ],
    buildings: [b(0, 'hum_hq', 3, 3), b(0, 'hum_reactor', 3, 8), b(0, 'hum_factory', 8, 3), b(1, 'ali_hq', 28, 28), b(1, 'ali_generator', 32, 24), b(1, 'ali_pit', 23, 30)],
    units: [
      u(0, 'hum_rifleman', 12, 11), u(0, 'hum_rifleman', 13, 12), u(0, 'hum_rifleman', 11, 13), u(0, 'hum_tank', 14, 13), u(0, 'hum_tank', 12, 14),
      u(1, 'ali_skitter', 22, 20), u(1, 'ali_skitter', 23, 21), u(1, 'ali_skitter', 21, 22), u(1, 'ali_skitter', 24, 20), u(1, 'ali_brute', 22, 22), u(1, 'ali_brute', 24, 22),
      ...crowd,
    ],
  };
  if (side === 'human') return cfg;
  // Watching from the Vrax side (NXT-2): the same battlefield with the players swapped, so player 0 is the hive.
  const swap = <T extends { owner: number }>(x: T): T => ({ ...x, owner: 1 - x.owner });
  return { ...cfg, players: [cfg.players![1]!, cfg.players![0]!], buildings: cfg.buildings!.map(swap), units: cfg.units!.map(swap) };
}

/** The unit mix of each side of the brawl: infantry squads, anti-armour, scouts, tanks and artillery (R3D-29). */
const BRAWL_MIX: Record<Faction, readonly string[]> = {
  human: ['hum_rifleman', 'hum_rifleman', 'hum_tank', 'hum_rocketeer', 'hum_buggy', 'hum_tank', 'hum_artillery', 'hum_rifleman', 'hum_tank', 'hum_rocketeer'],
  alien: ['ali_skitter', 'ali_skitter', 'ali_brute', 'ali_spitter', 'ali_stalker', 'ali_brute', 'ali_lobber', 'ali_skitter', 'ali_brute', 'ali_spitter'],
};

/**
 * A 200-unit brawl for measuring the renderer (R3D-29): the showcase battlefield with `perSide` units of mixed kinds on
 * each side, packed on open ground in the middle of the map so they are in contact at once. The game client sends both
 * armies at each other's base; there is no AI. Unit stats and rules are the game's own.
 */
export function brawlConfig(seed = 1, perSide = 100, side: Faction = 'human'): GameConfig {
  const base = showcaseConfig(seed, 0, 'human');
  const W = base.map.width;
  const blocked = base.map.blocked;
  const taken = new Set<number>();
  for (const b of base.buildings ?? []) {
    const d = buildingDef(b.kind);
    for (let y = b.ty; y < b.ty + d.h; y++) for (let x = b.tx; x < b.tx + d.w; x++) taken.add(y * W + x);
  }
  // Fill the free tiles outward from each army's centre, one unit per tile, the two blocks a few tiles apart.
  const spiral = (cx: number, cy: number, n: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let r = 0; r < W && out.length < n; r++)
      for (let y = cy - r; y <= cy + r && out.length < n; y++)
        for (let x = cx - r; x <= cx + r && out.length < n; x++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || x < 1 || y < 1 || x >= W - 1 || y >= W - 1) continue;
          const i = y * W + x;
          if (blocked?.[i] || taken.has(i)) continue;
          taken.add(i);
          out.push([x, y]);
        }
    return out;
  };
  const army = (owner: number, faction: Faction, cx: number, cy: number): UnitSpawn[] =>
    spiral(cx, cy, perSide).map(([x, y], k) => ({ owner, kind: BRAWL_MIX[faction][k % BRAWL_MIX[faction].length]!, tx: x, ty: y }));
  const units = [...army(0, 'human', 14, 18), ...army(1, 'alien', 21, 19)];
  const cfg: GameConfig = { ...base, units };
  if (side === 'human') return cfg;
  const swap = <T extends { owner: number }>(x: T): T => ({ ...x, owner: 1 - x.owner });
  return { ...cfg, players: [cfg.players![1]!, cfg.players![0]!], buildings: cfg.buildings!.map(swap), units: cfg.units!.map(swap) };
}
