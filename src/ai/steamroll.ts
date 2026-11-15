import { buildingDef, UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { BUILD_RANGE, EXPLORED, type BuildingSnap, type Command, type MapDef, type Snapshot } from '../sim';
import { AI, DIFFICULTIES, homeFields, shardFields, type AiStats, type Difficulty, type Doctrine, type ShardField } from './ai';

/**
 * The steamroll opponent's reaction time and orders per decision: Hard's, with no shard bonus (a human player gets none)
 * unless its tuning says otherwise (HAR-5).
 */
export const STEAMROLL_DIFFICULTY: Readonly<Difficulty> = { name: 'steamroll', thinkEvery: DIFFICULTIES.hard.thinkEvery, maxCommands: DIFFICULTIES.hard.maxCommands, bonus: 0 };

/** A field of at least this many shard tiles is a big one: it takes `haulers` haulers, a smaller one one fewer (HAR-5). */
export const STEAMROLL_BIG_FIELD = 30;

/**
 * The knobs of the steamroll opponent, so a match series can calibrate it (HAR-5); the defaults are the opponent. Plain
 * data, so match options carrying it can go to a worker thread.
 */
export interface SteamrollTuning {
  /** Army value (credits, by health) at which it launches its attack with everything. */
  launch: number;
  /** Crushers the army needs as well before it launches. */
  crushers: number;
  /** Its shard bonus, percent. */
  bonus: number;
  /** Share of anti-armour squads among the squads its barracks train once it has a factory (by count). */
  antiArmour: number;
  /** Most barracks and factories it builds. */
  barracks: number;
  factories: number;
  /** Shard fields it mines: its two home fields, then the nearest others. */
  fields: number;
  /** Haulers it keeps on a big field; one fewer on a smaller one. */
  haulers: number;
}
export const STEAMROLL_TUNING: Readonly<SteamrollTuning> = { launch: 14000, crushers: 6, bonus: STEAMROLL_DIFFICULTY.bonus, antiArmour: 0.55, barracks: 5, factories: 5, fields: 3, haulers: 4 };

const find = (faction: Faction, what: string, f: (k: string) => boolean): string => {
  const k = Object.keys(UNIT_DEFS).find((u) => unitDef(u).faction === faction && f(u));
  if (!k) throw new Error(`steamroll: no ${what} for ${faction}`);
  return k;
};

/** A faction's crusher: its Bulwark Tank or Brute, the crushing unit that is not its hero (HAR-5). */
export const crusherOf = (faction: Faction): string => find(faction, 'crusher', (u) => !!unitDef(u).crusher && !unitDef(u).hero && unitDef(u).capacity === undefined);

/** A faction's rifle infantry: its Rifleman or Skitterer, the barracks squad that needs nothing else (HAR-5). */
export const rifleOf = (faction: Faction): string => find(faction, 'rifle', (u) => (unitDef(u).role === 'infantry' || unitDef(u).role === 'raider') && unitDef(u).requires.length === 0);

/** A faction's anti-armour infantry: its Rocketeer or Spitter (HAR-5). */
export const antiArmourOf = (faction: Faction): string => find(faction, 'anti-armour', (u) => unitDef(u).role === 'antiarmor' && !unitDef(u).hero);

/** Tiles between a building's footprint and a tile (0 when the tile is under it), as placement measures range. */
const gap = (b: BuildingSnap, x: number, y: number): number => {
  const d = buildingDef(b.kind);
  return Math.max(b.tx - x, x - (b.tx + d.w - 1), 0, b.ty - y, y - (b.ty + d.h - 1));
};

/**
 * The harness's steamroll opponent, for measuring the AI only (HAR-5): not a personality, never drawn by Random and not
 * offered by the menu. It plays the build its owner beats the Hard AI with. Opening: power as needed, a refinery at its
 * second home field, a barracks training rifle squads, a factory training one crusher and then two haulers. Then its
 * barracks train anti-armour and rifle squads (antiArmour of them anti-armour) and its factories crushers, while it adds
 * barracks and factories in turn up to its maxima, mines `fields` fields (crawling toward a field beyond reach with the
 * buildings it wants anyway) with 3 to 4 haulers each, and keeps its army at home until it is worth `launch` credits
 * with `crushers` crushers. Then everything attacks as one body with crush orders and never turns back; what it trains
 * meanwhile follows in groups. No scouts, artillery, aircraft, hero, lab, turrets or superweapon.
 */
export class SteamrollAI extends AI {
  protected override readonly doctrine: Doctrine;
  readonly crusher: string;
  readonly rifle: string;
  readonly antiArmour: string;
  /** Its fields in the order it takes them (home fields first, then by distance), as the AI orders them (AI-18). */
  private order: ShardField[] = [];
  private snap: Snapshot | null = null;
  private own: BuildingSnap[] = [];
  private margin = 0;
  private short = false;
  /** Rifle squads ordered before its first factory stood (its opening), or -1 until then. */
  private openingRifles = -1;
  /** The field it expands to next, and whether one of its buildings stands close enough to put a refinery there. */
  private target: ShardField | null = null;
  private reachable = false;
  private lastLaunch = { value: 0, crushers: 0 };

  constructor(player: number, faction: Faction, private readonly terrain: MapDef, seed = 0, readonly tuning: Readonly<SteamrollTuning> = STEAMROLL_TUNING) {
    super(player, faction, { ...STEAMROLL_DIFFICULTY, bonus: tuning.bonus }, terrain, seed, 'balanced');
    const crusher = (this.crusher = crusherOf(faction));
    const rifle = (this.rifle = rifleOf(faction));
    const at = (this.antiArmour = antiArmourOf(faction));
    const hauler = this.kit.hauler;
    this.stats.steamroll = { launches: [], peakRefineries: 0, peakBarracks: 0, peakFactories: 0, peakHaulers: 0, peakArmy: 0 };
    this.doctrine = {
      trains: (k) => k === crusher || k === rifle || k === at || k === hauler,
      structure: (have) => this.structure(have),
      pick: (building, allowed, haulersWanted) => this.pick(building, allowed, haulersWanted),
      haulers: (standard) => this.haulers(standard),
      place: (kind) => this.place(kind),
      launch: (value, crushers) => {
        this.lastLaunch = { value: Math.round(value), crushers };
        return value >= tuning.launch && crushers >= tuning.crushers;
      },
      scouts: false,
      retreats: false,
    };
  }

  /** Whether a field still has shards, by what it has seen of it, or by the map where it has not looked. */
  private alive(f: ShardField): boolean {
    const s = this.snap as Snapshot;
    const fog = s.fog as Uint8Array;
    return f.tiles.some((t) => ((fog[t] as number) & EXPLORED ? (s.shards[t] as number) > 0 : (this.terrain.shards?.[t] ?? 0) > 0));
  }

  /** Whether a field has shards left and a refinery of its own beside it, as the AI judges it (AI-18). */
  private mines(f: ShardField): boolean {
    const s = this.snap as Snapshot;
    return f.tiles.some((t) => (s.shards[t] as number) > 0) && this.own.some((b) => buildingDef(b.kind).refinery && Math.hypot(b.tx + 1.5 - f.cx, b.ty + 1 - f.cy) <= 9);
  }

  /** The build order: power when short, the opening, then expansion and more barracks and factories. */
  private structure(have: (kind: string) => number): string | null {
    const k = this.kit;
    if (this.short || this.margin < 15) return k.power;
    if (have(k.refinery) < 2) return k.refinery;
    if (have(k.barracks) === 0) return k.barracks;
    if (have(k.factory) === 0) return k.factory;
    if (this.margin < 35) return k.power;
    const grow = (): string | null => {
      const b = have(k.barracks);
      const f = have(k.factory);
      if (b >= this.tuning.barracks && f >= this.tuning.factories) return null;
      return b < this.tuning.barracks && (b <= f || f >= this.tuning.factories) ? k.barracks : k.factory;
    };
    // Expansion: a refinery once a building stands close to the field, else the next building it wants anyway, built
    // toward the field (a building crawl); power when it wants nothing else.
    if (this.target && have(k.refinery) < this.tuning.fields + 2) return this.reachable ? k.refinery : (grow() ?? k.power);
    return grow();
  }

  /** What a production building trains: crushers (the first before any hauler), haulers as wanted, and squads in the mix. */
  private pick(building: string, allowed: readonly string[], haulersWanted: number): string | null {
    const p = this.stats.produced;
    if (building === this.kit.factory) {
      if (p.tank > 0 && haulersWanted > 0 && allowed.includes(this.kit.hauler)) return this.kit.hauler;
      return allowed.includes(this.crusher) ? this.crusher : null;
    }
    if (building !== this.kit.barracks) return null;
    if (!allowed.includes(this.antiArmour) || this.openingRifles < 0) return allowed.includes(this.rifle) ? this.rifle : null;
    const rifles = p.inf - this.openingRifles;
    return p.at < this.tuning.antiArmour * (p.at + rifles + 1) ? this.antiArmour : this.rifle;
  }

  /** Haulers: per field it mines, `haulers` on a big field, one fewer on a smaller one; the AI's number while it mines none. */
  private haulers(standard: number): number {
    const n = this.order.filter((f) => this.mines(f)).reduce((s, f) => s + (f.tiles.length >= STEAMROLL_BIG_FIELD ? this.tuning.haulers : this.tuning.haulers - 1), 0);
    return n > 0 ? n : standard;
  }

  /** Refineries may stand anywhere in range; while it crawls, its other buildings go toward the field it expands to. */
  private place(kind: string): { reach: number; toward?: { x: number; y: number } } | undefined {
    if (buildingDef(kind).refinery) return { reach: Infinity };
    const t = this.target;
    if (t && !this.reachable) return { reach: Infinity, toward: { x: t.cx, y: t.cy } };
    return undefined;
  }

  override think(snap: Snapshot): Command[] {
    const me = this.player;
    const k = this.kit;
    const sr = this.stats.steamroll as NonNullable<AiStats['steamroll']>;
    const own = snap.buildings.filter((b) => b.owner === me);
    const hq = own.find((b) => buildingDef(b.kind).hq);
    const pl = snap.players[me];
    if (hq && pl && snap.fog) {
      this.snap = snap;
      this.own = own;
      if (this.order.length === 0) {
        const d = buildingDef(hq.kind);
        const hx = hq.tx + d.w / 2;
        const hy = hq.ty + d.h / 2;
        const homes = homeFields(this.terrain, { tx: hq.tx, ty: hq.ty });
        const rest = shardFields(this.terrain)
          .filter((f) => !homes.some((h) => h.tiles[0] === f.tiles[0]))
          .sort((a, b) => Math.hypot(a.cx - hx, a.cy - hy) - Math.hypot(b.cx - hx, b.cy - hy) || a.tiles[0]! - b.tiles[0]!);
        this.order = [...homes, ...rest];
      }
      const drain = hq.queue.reduce((s, q) => s + Math.max(0, -buildingDef(q.kind).power), 0);
      this.margin = pl.powerOut - pl.powerIn - drain;
      this.short = pl.powerIn > pl.powerOut;
      if (this.openingRifles < 0 && own.some((b) => b.kind === k.factory)) this.openingRifles = this.stats.produced.inf;
      // Once its opening is over (a factory stands), it expands while it mines fewer fields than it wants, to the first
      // field it does not mine yet.
      const served = this.order.filter((f) => this.mines(f)).length;
      this.target = this.openingRifles >= 0 && served < this.tuning.fields ? (this.order.find((f) => !this.mines(f) && this.alive(f)) ?? null) : null;
      const W = snap.mapWidth;
      const t = this.target;
      this.reachable = t !== null && t.tiles.some((i) => ((snap.fog?.[i] as number) & EXPLORED) !== 0 && own.some((b) => gap(b, i % W, Math.floor(i / W)) <= BUILD_RANGE - 1));
    }
    const waves = this.stats.waves;
    const out = super.think(snap);
    if (this.stats.waves > waves) sr.launches.push({ tick: snap.tick, ...this.lastLaunch });
    const n = (f: (kind: string) => boolean): number => own.filter((b) => f(b.kind)).length;
    sr.peakRefineries = Math.max(sr.peakRefineries, n((x) => !!buildingDef(x).refinery));
    sr.peakBarracks = Math.max(sr.peakBarracks, n((x) => x === k.barracks));
    sr.peakFactories = Math.max(sr.peakFactories, n((x) => x === k.factory));
    const units = snap.units.filter((u) => u.owner === me);
    sr.peakHaulers = Math.max(sr.peakHaulers, units.filter((u) => u.kind === k.hauler).length);
    sr.peakArmy = Math.max(sr.peakArmy, Math.round(units.reduce((s, u) => (unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined ? s + (unitDef(u.kind).cost * u.hp) / unitDef(u.kind).hp : s), 0)));
    return out;
  }
}
