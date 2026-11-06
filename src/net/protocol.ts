import type { Command } from '../sim';

/**
 * Wire protocol for online matches (NET-1..5). Two players exchange commands, never state: the simulation is
 * deterministic, so both browsers stay identical as long as they apply the same commands on the same ticks (lockstep).
 * Everything that arrives from the network is untrusted and goes through `parseMessage` and `sanitizeCommand`.
 */

/** Bumped whenever the protocol or the simulation changes in a way that would desync older clients. */
export const NET_VERSION = 4;
/** Ticks per lockstep turn (100 ms at 20 ticks a second). */
export const TURN_TICKS = 2;
export const TURN_MS = TURN_TICKS * 50;
/**
 * How many turns ahead a player announces its turns (its input delay): DELAY_TURNS until the connection has been
 * measured, then fitted to it (NET-2), between MIN_DELAY_TURNS and MAX_DELAY_TURNS.
 */
export const DELAY_TURNS = 2;
export const MIN_DELAY_TURNS = 1;
export const MAX_DELAY_TURNS = 6;
/** Slack added to the measured one-way latency for jitter when fitting the delay (NET-2). */
export const JITTER_MS = 50;

/** The input delay, in turns, for a connection whose one-way latency is `oneWayMs` (NET-2). Pure. */
export const delayFor = (oneWayMs: number): number => Math.max(MIN_DELAY_TURNS, Math.min(MAX_DELAY_TURNS, Math.ceil((Math.max(0, oneWayMs) + JITTER_MS) / TURN_MS)));
/** Ticks between state checksums compared by both players (3 s); a multiple of TURN_TICKS. */
export const HASH_EVERY = 60;
/** Caps on what one message may carry. */
export const MAX_CMDS_PER_TURN = 32;
export const MAX_IDS = 200;
export const MAX_MESSAGE_CHARS = 24_000;

export type Faction = 'human' | 'alien';
export type MapName = 'crossroads' | 'riverbed' | 'highlands' | 'generated';
const MAPS: readonly MapName[] = ['crossroads', 'riverbed', 'highlands', 'generated'];
/** Map seeds run from 0 to 999999 (MAP-7). */
const MAP_SEED_LIMIT = 1_000_000;

/** The match both players build: the host's choices; the guest plays the other faction. */
export interface MatchSetup {
  seed: number;
  map: MapName;
  /** The host's map seed when the map is generated (NET-6): both players build the same map from it. */
  mapSeed?: number;
  /** Faction of player 0 (the host) and player 1 (the guest). */
  factions: [Faction, Faction];
}

export type NetMsg =
  /** Guest to host: asks to join, repeated until welcomed. */
  | { t: 'hello'; v: number }
  /** Host to one guest (`to` = its user id): the match, and that it starts now. */
  | { t: 'welcome'; v: number; to: string; setup: MatchSetup }
  /** Host to a would-be guest: the room is taken, or the versions differ. */
  | { t: 'refuse'; to: string; why: 'full' | 'version' }
  /** One player's commands for lockstep turn `n` (sent even when empty). */
  | { t: 'turn'; n: number; c: Command[] }
  /** State checksum after `tick` ticks. */
  | { t: 'hash'; tick: number; h: number }
  /** Round-trip probes (NET-2): `ping` is answered at once with a `pong` carrying the same id. */
  | { t: 'ping'; id: number }
  | { t: 'pong'; id: number }
  /** Leaving the match; with `end`, because the game itself ended at that tick, so the other game plays on to it (NET-4). */
  | { t: 'bye'; end?: number };

const isInt = (x: unknown, lo = -2_147_483_648, hi = 2_147_483_647): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const ids = (x: unknown): number[] | null => (Array.isArray(x) && x.length <= MAX_IDS && x.every((v) => isInt(v, 0)) ? (x as number[]) : null);
const KIND = /^[a-z][a-z_]{1,31}$/;
/** Fixed-point coordinates: maps are at most 256 tiles of 256 units. */
const coord = (x: unknown): x is number => isInt(x, -65_536, 65_536);

/**
 * One command from the network, rebuilt field by field with `player` forced to the sender's seat (NET-5), or null if it
 * is malformed. Only known command types and fields survive; the simulation then refuses orders for units, buildings or
 * kinds the player does not own or cannot use.
 */
export function sanitizeCommand(raw: unknown, player: number): Command | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const r = raw;
  switch (r.type) {
    case 'noop':
      return { type: 'noop', player };
    case 'stop': {
      const u = ids(r.units);
      return u ? { type: 'stop', player, units: u } : null;
    }
    case 'move':
    case 'harvest':
    case 'attackmove': {
      const u = ids(r.units);
      return u && coord(r.x) && coord(r.y) ? { type: r.type, player, units: u, x: r.x, y: r.y } : null;
    }
    case 'produce':
      return isInt(r.source, 0) && typeof r.kind === 'string' && KIND.test(r.kind) ? { type: 'produce', player, source: r.source, kind: r.kind } : null;
    case 'cancel':
      return isInt(r.source, 0) && isInt(r.index, 0, 64) ? { type: 'cancel', player, source: r.source, index: r.index } : null;
    case 'place':
      return isInt(r.source, 0) && isInt(r.tx, 0, 1024) && isInt(r.ty, 0, 1024) ? { type: 'place', player, source: r.source, tx: r.tx, ty: r.ty } : null;
    case 'sell':
      return isInt(r.building, 0) ? { type: 'sell', player, building: r.building } : null;
    case 'repair':
      return isInt(r.building, 0) && typeof r.on === 'boolean' ? { type: 'repair', player, building: r.building, on: r.on } : null;
    case 'rally':
    case 'superweapon':
      return isInt(r.building, 0) && coord(r.x) && coord(r.y) ? { type: r.type, player, building: r.building, x: r.x, y: r.y } : null;
    case 'attack': {
      const u = ids(r.units);
      return u && isInt(r.target, 0) ? { type: 'attack', player, units: u, target: r.target } : null;
    }
    default:
      return null;
  }
}

function parseSetup(x: unknown): MatchSetup | null {
  if (!isObj(x) || !isInt(x.seed, 0, 1_000_000_000) || !MAPS.includes(x.map as MapName) || !Array.isArray(x.factions) || x.factions.length !== 2) return null;
  const [a, b] = x.factions as unknown[];
  const f = (v: unknown): v is Faction => v === 'human' || v === 'alien';
  if (!f(a) || !f(b)) return null;
  if (x.map !== 'generated') return { seed: x.seed, map: x.map as MapName, factions: [a, b] };
  // A generated map needs its seed (NET-6).
  return isInt(x.mapSeed, 0, MAP_SEED_LIMIT - 1) ? { seed: x.seed, map: 'generated', mapSeed: x.mapSeed, factions: [a, b] } : null;
}

/**
 * A message's payload from the network, validated (NET-5): unknown types, wrong field types and oversized lists are
 * rejected. Commands in a turn are kept raw here; the receiver sanitizes them for the sender's seat.
 */
export function parseMessage(data: unknown): NetMsg | null {
  if (!isObj(data)) return null;
  switch (data.t) {
    case 'hello':
      return isInt(data.v, 0) ? { t: 'hello', v: data.v } : null;
    case 'welcome': {
      const setup = parseSetup(data.setup);
      return isInt(data.v, 0) && isId(data.to) && setup ? { t: 'welcome', v: data.v, to: data.to, setup } : null;
    }
    case 'refuse':
      return isId(data.to) && (data.why === 'full' || data.why === 'version') ? { t: 'refuse', to: data.to, why: data.why } : null;
    case 'turn':
      return isInt(data.n, 0) && Array.isArray(data.c) && data.c.length <= MAX_CMDS_PER_TURN ? { t: 'turn', n: data.n, c: data.c as Command[] } : null;
    case 'hash':
      return isInt(data.tick, 0) && isInt(data.h, -4_294_967_296, 4_294_967_296) ? { t: 'hash', tick: data.tick, h: data.h } : null;
    case 'ping':
    case 'pong':
      return isInt(data.id, 0) ? { t: data.t, id: data.id } : null;
    case 'bye':
      return isInt(data.end, 0) ? { t: 'bye', end: data.end } : { t: 'bye' };
    default:
      return null;
  }
}

/** Room codes: six characters with no look-alikes (no I, L, O, 0, 1), as the server makes them (NET-1). */
export const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const ROOM_CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** A typed room code, tidied: upper case, spaces and dashes removed; null unless it is a valid code. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, '');
  return ROOM_CODE.test(c) ? c : null;
}
