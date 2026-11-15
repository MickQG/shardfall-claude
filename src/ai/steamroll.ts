import { UNIT_DEFS, unitDef, type Faction } from '../data/defs';
import type { Command, MapDef, Snapshot } from '../sim';
import { AI, DIFFICULTIES, type Difficulty, type Doctrine } from './ai';

/**
 * The steamroll opponent's reaction time and orders per decision: Hard's. Its shard bonus stands in for the better
 * control and spending of the human player it imitates, which a script lacks (HAR-5).
 */
export const STEAMROLL_DIFFICULTY: Readonly<Difficulty> = { name: 'steamroll', thinkEvery: DIFFICULTIES.hard.thinkEvery, maxCommands: DIFFICULTIES.hard.maxCommands, bonus: 0 };

/** It trains rifle squads for home defence until this many of its crushers have stood at once (HAR-5). */
export const STEAMROLL_OPENING_CRUSHERS = 4;
/** It adds a factory whenever it has more than this many credits, up to this many factories (HAR-5). */
export const STEAMROLL_SPARE = 1500;
export const STEAMROLL_FACTORIES = 6;
/** Every wave sets out with at least this many crushers (HAR-5). */
export const STEAMROLL_MASS = 6;

/**
 * The parts of the steamroll opponent, so a match series can measure each one's effect (HAR-5); the defaults are the
 * opponent. Plain data, so match options carrying it can go to a worker thread.
 */
export interface SteamrollTuning {
  /** Rifle squads for home defence until its first crushers stand. */
  opening: boolean;
  /** A second factory straight away, more when credits pile up, haulers from one factory only. */
  spend: boolean;
  /** Crushers a wave needs before it sets out (0: the AI's own rule). */
  mass: number;
  /** Its shard bonus, percent. */
  bonus: number;
}
export const STEAMROLL_TUNING: Readonly<SteamrollTuning> = { opening: true, spend: true, mass: STEAMROLL_MASS, bonus: STEAMROLL_DIFFICULTY.bonus };

const find = (faction: Faction, what: string, f: (k: string) => boolean): string => {
  const k = Object.keys(UNIT_DEFS).find((u) => unitDef(u).faction === faction && f(u));
  if (!k) throw new Error(`steamroll: no ${what} for ${faction}`);
  return k;
};

/** A faction's crusher: its Bulwark Tank or Brute, the crushing unit that is not its hero (HAR-5). */
export const crusherOf = (faction: Faction): string => find(faction, 'crusher', (u) => !!unitDef(u).crusher && !unitDef(u).hero && unitDef(u).capacity === undefined);

/** A faction's rifle infantry: its Rifleman or Skitterer, the barracks squad that needs nothing else (HAR-5). */
export const rifleOf = (faction: Faction): string => find(faction, 'rifle', (u) => (unitDef(u).role === 'infantry' || unitDef(u).role === 'raider') && unitDef(u).requires.length === 0);

/**
 * The harness's steamroll opponent, for measuring the AI only (HAR-5): not a personality, never drawn by Random and not
 * offered by the menu. It is the AI with its economy, base building, scouting, waves and crush orders, but it trains only
 * its crusher, its haulers and its hero (and rifle squads for home defence in the opening), builds factories where the AI
 * would add barracks, never a superweapon, waits for a mass of crushers before a wave, and never pulls a wave back.
 */
export class SteamrollAI extends AI {
  protected override readonly doctrine: Doctrine;
  readonly crusher: string;
  readonly rifle: string;
  private infantryAtMass = 0;

  constructor(player: number, faction: Faction, map: MapDef, seed = 0, readonly tuning: Readonly<SteamrollTuning> = STEAMROLL_TUNING) {
    super(player, faction, { ...STEAMROLL_DIFFICULTY, bonus: tuning.bonus }, map, seed, 'balanced');
    const crusher = (this.crusher = crusherOf(faction));
    const rifle = (this.rifle = rifleOf(faction));
    const hauler = this.kit.hauler;
    this.stats.steamroll = { massedAt: -1, infantryAfter: 0 };
    this.doctrine = {
      trains: (k) => k === crusher || k === hauler || !!unitDef(k).hero || (tuning.opening && k === rifle && !this.massed),
      attacks: (k) => k !== rifle,
      factoriesForBarracks: true,
      structure: tuning.spend ? (planned, have, credits) => this.factories(planned, have, credits) : undefined,
      oneHaulerFactory: tuning.spend,
      waveCrushers: tuning.mass,
      superweapon: false,
      retreats: false,
    };
  }

  /** Whether its opening is over: its first crushers have stood. */
  get massed(): boolean {
    return (this.stats.steamroll?.massedAt ?? -1) >= 0;
  }

  /**
   * Its second factory straight after the first, and another whenever credits pile up, up to STEAMROLL_FACTORIES;
   * power, refineries and its one barracks keep their place in the AI's build order.
   */
  private factories(planned: string | null, have: (kind: string) => number, credits: number): string | null {
    const k = this.kit;
    if (planned === k.power || planned === k.refinery || planned === k.barracks || have(k.factory) === 0) return planned;
    if (have(k.factory) < 2) return k.factory;
    if (credits > STEAMROLL_SPARE && have(k.factory) < STEAMROLL_FACTORIES) return k.factory;
    return planned;
  }

  override think(snap: Snapshot): Command[] {
    const sr = this.stats.steamroll as { massedAt: number; infantryAfter: number };
    if (!this.massed && snap.units.filter((u) => u.owner === this.player && u.kind === this.crusher).length >= STEAMROLL_OPENING_CRUSHERS) {
      sr.massedAt = snap.tick;
      this.infantryAtMass = this.stats.produced.inf;
    }
    const out = super.think(snap);
    if (this.massed) sr.infantryAfter = this.stats.produced.inf - this.infantryAtMass;
    return out;
  }
}
