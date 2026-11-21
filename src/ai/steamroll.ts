import { buildingDef, canCrush, UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import { EXPLORED, FP, type BuildingSnap, type Command, type MapDef, type Snapshot, type UnitSnap } from '../sim';
import { inReach } from './expand';
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
  /**
   * 1: tank spam (HAR-7): once its opening is over its barracks train only the anti-armour squads its Field Menders carry,
   * and its factories crushers; 0: its squads in the mix above.
   */
  tankspam: number;
  /** 1: its crushers kite (HAR-7): they keep just outside the reach of the enemy units they outrange while they shoot. */
  kite: number;
  /** 1: Field Menders in its army by the AI's count (AI-29), loaded with anti-armour squads; 0: none. */
  menders: number;
  /** How deep its unit queues may be (HAR-7), so its credits go into factories before queues; 0: its deeper calibrated queues. */
  queue: number;
}
export const STEAMROLL_TUNING: Readonly<SteamrollTuning> = { launch: 14000, crushers: 6, bonus: STEAMROLL_DIFFICULTY.bonus, antiArmour: 0.55, barracks: 5, factories: 5, fields: 3, haulers: 4, tankspam: 0, kite: 0, menders: 1, queue: 0 };

/**
 * The tank-spam opponent (HAR-7): the steamroll opponent playing the build the owner beats the Hard AI as Vrax with: one
 * barracks, five factories massing crushers (Bulwark Tanks) that kite, and no Field Menders unless `menders: 1` is added.
 * It mines its two home fields and keeps its unit queues two deep, so its credits go into factories first.
 */
export const TANKSPAM: Readonly<Partial<SteamrollTuning>> = { tankspam: 1, kite: 1, menders: 0, barracks: 1, crushers: 12, queue: 2, fields: 2 };

/** Named opponent variants a match series may ask for (STEAMROLL_VARIANT), as changes to STEAMROLL_TUNING. */
export const STEAMROLL_PRESETS: Readonly<Record<string, Readonly<Partial<SteamrollTuning>>>> = { tankspam: TANKSPAM };

/**
 * Kiting (HAR-7): a crusher backs off from an enemy unit whose gun reaches less far than its own once that unit is within
 * its reach plus KITE_GAP tiles, moving KITE_STEP tiles straight away from such units (turning up to 90 degrees round
 * rock or water); at most KITE_ORDERS of these orders a decision, out of its budget.
 */
export const KITE_GAP = 3;
export const KITE_STEP = 3;
export const KITE_ORDERS = 6;

/**
 * Kite orders (HAR-7): for each of `player`'s crushers (not heroes) that sees a ground enemy it outranges and cannot run
 * over (not an infantry squad) within that enemy's reach plus KITE_GAP tiles, a plain move KITE_STEP tiles straight away from those enemies (the nearest counting
 * most), so it keeps firing on the move (BAL-11) and stays out of their reach. Nearest threats first, at most `max`.
 * Pure: a function of what the player sees and the map.
 */
export function kiteOrders(player: number, units: readonly UnitSnap[], map: MapDef, max = KITE_ORDERS): Command[] {
  const W = map.width;
  const H = map.height;
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && !map.blocked?.[Math.floor(y) * W + Math.floor(x)];
  const foes = units.filter((u) => u.owner !== player && unitDef(u.kind).weapon && !unitDef(u.kind).air);
  const out: { d: number; id: number; c: Command }[] = [];
  for (const t of units) {
    const d = unitDef(t.kind);
    if (t.owner !== player || !d.crusher || d.hero || !d.weapon) continue;
    const reach = d.weapon.range;
    const x = t.x / FP;
    const y = t.y / FP;
    let ux = 0;
    let uy = 0;
    let nearest = Infinity;
    for (const f of foes) {
      const r = unitDef(f.kind).weapon?.range ?? 0;
      // Squads it can run over it crushes instead (BAL-5).
      if (r >= reach || canCrush(t.kind, f.kind)) continue;
      const fx = f.x / FP;
      const fy = f.y / FP;
      const dd = Math.hypot(x - fx, y - fy);
      if (dd > r + KITE_GAP) continue;
      const d2 = Math.max(0.25, dd * dd);
      ux += (x - fx) / d2;
      uy += (y - fy) / d2;
      nearest = Math.min(nearest, dd);
    }
    if (nearest === Infinity) continue;
    const l = Math.hypot(ux, uy);
    if (l < 1e-6) continue;
    ux /= l;
    uy /= l;
    const C = Math.SQRT1_2;
    const turns: [number, number][] = [
      [1, 0],
      [C, C],
      [C, -C],
      [0, 1],
      [0, -1],
    ];
    for (const [cs, sn] of turns) {
      const dx = ux * cs - uy * sn;
      const dy = ux * sn + uy * cs;
      let ok = true;
      for (let k = 1; k <= 2 * KITE_STEP && ok; k++) ok = open(x + (dx * k) / 2, y + (dy * k) / 2);
      if (!ok) continue;
      const px = Math.floor(x + dx * KITE_STEP);
      const py = Math.floor(y + dy * KITE_STEP);
      out.push({ d: nearest, id: t.id, c: { type: 'move', player, units: [t.id], x: px * FP + FP / 2, y: py * FP + FP / 2 } });
      break;
    }
  }
  return out
    .sort((a, b) => a.d - b.d || a.id - b.id)
    .slice(0, max)
    .map((o) => o.c);
}

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

/**
 * The harness's steamroll opponent, for measuring the AI only (HAR-5): not a personality, never drawn by Random and not
 * offered by the menu. It plays the build its owner beats the Hard AI with. Opening: power as needed, a refinery at its
 * second home field, a barracks training rifle squads, a factory training one crusher and then two haulers. Then its
 * barracks train anti-armour and rifle squads (antiArmour of them anti-armour) and its factories crushers, while it adds
 * barracks and factories in turn up to its maxima, mines `fields` fields (crawling toward a field beyond reach with the
 * buildings it wants anyway) with 3 to 4 haulers each, and keeps its army at home until it is worth `launch` credits
 * with `crushers` crushers. Then everything attacks as one body with crush orders and never turns back; what it trains
 * meanwhile follows in groups. No scouts, artillery, aircraft, hero, lab, turrets or superweapon. As Aegis it keeps Field
 * Menders in its army by the AI's count, loaded with anti-armour squads, though its tanks never fall back to them (AI-29).
 * Its tank-spam variant (HAR-7, TANKSPAM) trains crushers and only the squads its Menders carry, and its crushers kite.
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
    this.stats.steamroll = { launches: [], peakRefineries: 0, peakBarracks: 0, peakFactories: 0, peakHaulers: 0, peakArmy: 0, kites: 0 };
    // Field Menders in its army by the AI's own count, loaded the same way (AI-29), unless its tuning says none; the Vrax have none.
    const mender = tuning.menders ? this.menders.kind : null;
    this.doctrine = {
      trains: (k) => k === crusher || k === rifle || k === at || k === hauler || k === mender,
      structure: (have) => this.structure(have),
      pick: (building, allowed, haulersWanted) => this.pick(building, allowed, haulersWanted),
      haulers: (standard) => this.haulers(standard),
      place: (kind) => this.place(kind),
      launch: (value, crushers) => {
        this.lastLaunch = { value: Math.round(value), crushers };
        return value >= tuning.launch && crushers >= tuning.crushers;
      },
      ...(tuning.queue > 0 ? { depth: () => tuning.queue } : {}),
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
      // A Field Mender when one is wanted: the AI offers it only then (AI-29).
      if (this.menders.kind !== null && allowed.includes(this.menders.kind)) return this.menders.kind;
      return allowed.includes(this.crusher) ? this.crusher : null;
    }
    if (building !== this.kit.barracks) return null;
    if (!allowed.includes(this.antiArmour) || this.openingRifles < 0) return allowed.includes(this.rifle) ? this.rifle : null;
    // Tank spam (HAR-7): after its opening, only a squad for each Field Mender to carry.
    if (this.tuning.tankspam) return this.squadsForMenders() > 0 ? this.antiArmour : null;
    const rifles = p.inf - this.openingRifles;
    return p.at < this.tuning.antiArmour * (p.at + rifles + 1) ? this.antiArmour : this.rifle;
  }

  /** Anti-armour squads its Field Menders still want aboard (HAR-7): its Menders, less the squads it has (aboard or not) or has queued. */
  private squadsForMenders(): number {
    const s = this.snap;
    const kind = this.menders.kind;
    if (!s || !kind || !this.tuning.menders) return 0;
    const own = s.units.filter((u) => u.owner === this.player);
    const menders = own.filter((u) => u.kind === kind);
    const squads = own.filter((u) => u.kind === this.antiArmour).length + menders.filter((u) => u.cargo).length;
    const queued = this.own.reduce((n, b) => n + b.queue.filter((q) => q.kind === this.antiArmour).length, 0);
    return menders.length - squads - queued;
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
      this.reachable = t !== null && inReach(t, own, snap.fog as Uint8Array, W);
    }
    const waves = this.stats.waves;
    let out = super.think(snap);
    // Its crushers kite (HAR-7): their orders go last, so they hold over this decision's others for the same units, and
    // come out of its budget.
    if (this.tuning.kite) {
      const kite = kiteOrders(me, snap.units, this.terrain);
      if (kite.length > 0) out = [...out.slice(0, Math.max(0, this.diff.maxCommands - kite.length)), ...kite];
      sr.kites += kite.length;
    }
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
