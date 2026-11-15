import { describe, expect, it } from 'vitest';
import { AI, DIFFICULTIES, SCOUT_DANGER, SCOUT_REPLACE, SCOUT_STANDOFF, STANDING_SCOUTS } from '../../src/ai/ai';
import { kitOf } from '../../src/ai/kit';
import { SteamrollAI } from '../../src/ai/steamroll';
import { buildingDef, UNIT_DEFS, unitDef, type Faction } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type BuildingSpawn, type Command, type Game, type GameConfig, type UnitSpawn } from '../../src/sim';

const LONG = 600_000;
const FACTIONS = ['human', 'alien'] as const;
const other = (f: Faction): Faction => (f === 'human' ? 'alien' : 'human');
/** A faction's scout unit: Scout Buggy or Stalker. */
const scoutOf = (f: Faction): string => Object.keys(UNIT_DEFS).find((k) => unitDef(k).faction === f && unitDef(k).role === 'scout')!;
const config = (faction: Faction, seed = 6, credits?: number): GameConfig => skirmishConfig(seed, { factions: [faction, other(faction)], credits });

/** Player 0's base with a barracks, two factories, a lab, three refineries and power to spare, plus extra units and buildings. */
function builtBase(faction: Faction, credits: number, units: UnitSpawn[] = [], buildings: BuildingSpawn[] = []): { g: Game; cfg: GameConfig } {
  const cfg = config(faction);
  const k = kitOf(faction);
  const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === k.hq)!;
  const at = (kind: string, dx: number, dy: number): BuildingSpawn => ({ owner: 0, kind, tx: hq.tx + dx, ty: hq.ty + dy });
  const power = [[4, 0], [6, 0], [4, 2], [6, 2], [8, 0], [8, 2]].map(([x, y]) => at(k.power, x!, y!));
  // Eight haulers, so the factories train combat units.
  const haulers = [...Array(8)].map((_, i): UnitSpawn => ({ owner: 0, kind: k.hauler, tx: hq.tx + 10 + i, ty: hq.ty + 15 }));
  const g = createGame({
    ...cfg,
    players: [{ faction, credits }, cfg.players![1]!],
    buildings: [...cfg.buildings!, ...power, at(k.barracks, 0, 4), at(k.factory, 3, 4), at(k.factory, 3, 8), at(k.lab, 7, 4), at(k.refinery, 7, 8), at(k.refinery, 11, 8), ...buildings],
    units: [...(cfg.units ?? []), ...haulers, ...units],
  });
  return { g, cfg };
}

/** Let one AI play on its cadence for `ticks` (its opponent idles); returns what it ordered, with the tick. */
function drive(g: Game, ai: AI, ticks: number, each?: (cmds: Command[]) => void): { tick: number; cmd: Command }[] {
  const log: { tick: number; cmd: Command }[] = [];
  for (let i = 0; i < ticks; i++) {
    if (g.state.tick % ai.diff.thinkEvery === 0) {
      const cmds = ai.think(snapshot(g, ai.player));
      for (const c of cmds) {
        submit(g, c);
        log.push({ tick: g.state.tick, cmd: c });
      }
      each?.(cmds);
    }
    tick(g);
  }
  return log;
}

const produced = (log: readonly { cmd: Command }[], kind: string): number => log.filter((l) => l.cmd.type === 'produce' && l.cmd.kind === kind).length;
const scoutsOf = (g: Game, kind: string): number => g.state.units.filter((u) => u.owner === 0 && u.kind === kind).length;
const queuedOf = (g: Game, kind: string): number => g.state.buildings.filter((b) => b.owner === 0).flatMap((b) => b.queue).filter((q) => q.kind === kind).length;

/** The nearest open tile to (tx, ty) on the map. */
function open(cfg: GameConfig, tx: number, ty: number): { tx: number; ty: number } {
  const W = cfg.map.width;
  for (let r = 0; r < 10; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!cfg.map.blocked?.[y * W + x] && !(cfg.map.shards?.[y * W + x] ?? 0)) return { tx: x, ty: y };
      }
  return { tx, ty };
}

const moveOf = (cmds: readonly Command[], id: number): { x: number; y: number } | null => {
  const m = cmds.find((c) => c.type === 'move' && c.units.length === 1 && c.units[0] === id);
  return m && m.type === 'move' ? { x: m.x / FP, y: m.y / FP } : null;
};

describe('the standing scout (AI-21)', () => {
  it('AI-21: once its factory or pit stands it trains one scout unit first, never a second while it lives, and a replacement only after the gap', () => {
    expect(STANDING_SCOUTS).toBe(1);
    expect(SCOUT_REPLACE).toBe(20 * 30);
    for (const faction of FACTIONS) {
      const k = kitOf(faction);
      const scout = scoutOf(faction);
      expect(unitDef(scout).builtAt, faction).toBe(k.factory);
      // Before the factory stands nothing trains it.
      const earlyCfg = config(faction, 6, 5000);
      expect(produced(drive(createGame(earlyCfg), new AI(0, faction, DIFFICULTIES.hard, earlyCfg.map, 6), 1), scout), faction).toBe(0);

      const { g, cfg } = builtBase(faction, 20000);
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
      const first = drive(g, ai, 1).map((l) => l.cmd);
      // Exactly one scout, and it is what one factory trains this turn, ahead of its other combat units.
      const scouts = first.filter((c) => c.type === 'produce' && c.kind === scout);
      expect(scouts.length, faction).toBe(1);
      const factory = (scouts[0] as { source: number }).source;
      expect(first.filter((c) => c.type === 'produce' && c.source === factory).length, faction).toBe(1);

      // While it is queued and while it lives, no second one.
      let log = drive(g, ai, 1600);
      expect(produced(log, scout), faction).toBe(0);
      expect(scoutsOf(g, scout), faction).toBe(1);
      expect(queuedOf(g, scout), faction).toBe(0);

      // Lost: no replacement within SCOUT_REPLACE ticks, then one.
      const lostAt = g.state.tick;
      g.state.units = g.state.units.filter((u) => !(u.owner === 0 && u.kind === scout));
      log = drive(g, ai, SCOUT_REPLACE + 200);
      const again = log.filter((l) => l.cmd.type === 'produce' && l.cmd.kind === scout);
      expect(again.length, faction).toBe(1);
      expect(again[0]!.tick - lostAt, faction).toBeGreaterThanOrEqual(SCOUT_REPLACE);
    }
  }, LONG);

  it('AI-21: the standing scout joins no wave, gathering or base defence', () => {
    for (const faction of FACTIONS) {
      const cfg = config(faction, 3);
      const scout = scoutOf(faction);
      const rifle = faction === 'human' ? 'hum_rifleman' : 'ali_skitter';
      const foe = faction === 'human' ? 'ali_skitter' : 'hum_rifleman';
      const army = Array.from({ length: 6 }, (_, i): UnitSpawn => ({ owner: 0, kind: rifle, tx: 20 + (i % 3), ty: 22 + Math.floor(i / 3) }));
      const raiders = Array.from({ length: 3 }, (_, i): UnitSpawn => ({ owner: 1, kind: foe, tx: 18 + i, ty: 13 }));
      const g = createGame({ ...cfg, units: [...(cfg.units ?? []), ...army, ...raiders, { owner: 0, kind: scout, tx: 24, ty: 24 }] });
      const id = g.state.units.find((u) => u.owner === 0 && u.kind === scout)!.id;
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 3);
      const cmds = ai.think(snapshot(g, 0));
      const defend = cmds.find((c) => c.type === 'attackmove' && c.units.length >= 3);
      expect(defend, `${faction}: army sent at the raiders`).toBeDefined();
      expect((defend as { units: number[] }).units, faction).not.toContain(id);
    }
    // A long, rich game with waves: the scout only ever gets its own plain move orders.
    for (const faction of FACTIONS) {
      const cfg = config(faction, 5, 8000);
      const g = createGame(cfg);
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 5);
      const scout = scoutOf(faction);
      const scoutIds = new Set<number>();
      const log = drive(g, ai, 6000, () => {
        for (const u of g.state.units) if (u.owner === 0 && u.kind === scout) scoutIds.add(u.id);
      });
      expect(ai.stats.waves, faction).toBeGreaterThan(0);
      expect(scoutIds.size, faction).toBeGreaterThan(0);
      for (const l of log) {
        if (!('units' in l.cmd) || !l.cmd.units.some((u) => scoutIds.has(u))) continue;
        expect({ type: l.cmd.type, n: l.cmd.units.length }, `${faction} @${l.tick}`).toEqual({ type: 'move', n: 1 });
      }
    }
  }, LONG);

  it('AI-21: at full health it backs away from an armed enemy unit within 8 tiles, and from a defence', () => {
    for (const faction of FACTIONS) {
      const cfg = config(faction);
      const scout = scoutOf(faction);
      const spot = open(cfg, 50, 40);
      const threats: { what: string; spawn: { units?: UnitSpawn[]; buildings?: BuildingSpawn[] }; at: { tx: number; ty: number } }[] = [];
      const u = open(cfg, spot.tx + 5, spot.ty + 3);
      threats.push({ what: 'unit', spawn: { units: [{ owner: 1, kind: other(faction) === 'human' ? 'hum_tank' : 'ali_brute', ...u }] }, at: u });
      const t = open(cfg, spot.tx + 6, spot.ty);
      threats.push({ what: 'defence', spawn: { buildings: [{ owner: 1, kind: kitOf(other(faction)).turret, ...t }] }, at: t });
      for (const th of threats) {
        const g = createGame({ ...cfg, units: [...(cfg.units ?? []), { owner: 0, kind: scout, ...spot }, ...(th.spawn.units ?? [])], buildings: [...(cfg.buildings ?? []), ...(th.spawn.buildings ?? [])] });
        const me = g.state.units.find((x) => x.owner === 0 && x.kind === scout)!;
        expect(me.hp).toBe(unitDef(scout).hp);
        const before = Math.hypot(spot.tx - th.at.tx, spot.ty - th.at.ty);
        expect(before).toBeLessThanOrEqual(SCOUT_DANGER);
        const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
        const to = moveOf(ai.think(snapshot(g, 0)), me.id);
        expect(to, `${faction} ${th.what}: a move order`).not.toBeNull();
        const after = Math.hypot(to!.x - th.at.tx - 0.5, to!.y - th.at.ty - 0.5);
        expect(after, `${faction} ${th.what}`).toBeGreaterThan(SCOUT_DANGER);
        expect(after, `${faction} ${th.what}`).toBeGreaterThan(before);
      }
    }
  });

  it('AI-21: it tours its observation points, moving on as it reaches each, and keeps about 9 tiles from the enemy buildings it knows', () => {
    for (const faction of FACTIONS) {
      const cfg = config(faction, 6);
      const scout = scoutOf(faction);
      const k = kitOf(faction);
      const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === k.hq)!;
      // A quiet enemy: its base only, no units to chase the scout.
      const g = createGame({ ...cfg, units: [...(cfg.units ?? []).filter((u) => u.owner === 0), { owner: 0, kind: scout, tx: hq.tx + 6, ty: hq.ty + 8 }] });
      const id = g.state.units.find((u) => u.owner === 0 && u.kind === scout)!.id;
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
      const goals: { x: number; y: number; known: { tx: number; ty: number; kind: string }[] }[] = [];
      let reached = 0;
      let nearest = Infinity;
      drive(g, ai, 20 * 60 * 3, (cmds) => {
        const s = snapshot(g, 0);
        const known = [...s.buildings.filter((b) => b.owner === 1), ...s.ghosts];
        const me = g.state.units.find((u) => u.id === id);
        const to = moveOf(cmds, id);
        const last = goals[goals.length - 1];
        // A new point once it has reached the last one: it moves on.
        if (to && me && last && Math.hypot(me.x / FP - last.x, me.y / FP - last.y) < 2.5) reached++;
        if (to) goals.push({ ...to, known: known.map((b) => ({ tx: b.tx, ty: b.ty, kind: b.kind })) });
        if (!me) return;
        for (const b of g.state.buildings.filter((x) => x.owner === 1)) {
          const d = buildingDef(b.kind);
          nearest = Math.min(nearest, Math.hypot(Math.max(b.tx - me.x / FP, 0, me.x / FP - b.tx - d.w), Math.max(b.ty - me.y / FP, 0, me.y / FP - b.ty - d.h)));
        }
      });
      // Alive at the end, several points visited.
      expect(g.state.units.some((u) => u.id === id), faction).toBe(true);
      const distinct = new Set(goals.map((p) => `${Math.floor(p.x)},${Math.floor(p.y)}`));
      expect(distinct.size, faction).toBeGreaterThanOrEqual(4);
      expect(reached, faction).toBeGreaterThanOrEqual(4);
      // Its points around the enemy base stand SCOUT_STANDOFF tiles out from every enemy building it knew of then.
      for (const p of goals) {
        for (const b of p.known) {
          const d = buildingDef(b.kind);
          const edge = Math.hypot(Math.max(b.tx - p.x, 0, p.x - b.tx - d.w), Math.max(b.ty - p.y, 0, p.y - b.ty - d.h));
          expect(edge, `${faction} goal ${p.x},${p.y}`).toBeGreaterThanOrEqual(SCOUT_STANDOFF - 1);
        }
      }
      // It never came within gun range of the base, and it found it.
      expect(nearest, faction).toBeGreaterThan(5);
      expect(ai.stats.scoutedAt, faction).toBeGreaterThan(0);
    }
  }, LONG);

  it('AI-21: before it has a scout unit it scouts as before with its fastest unit (AI-17)', () => {
    for (const faction of FACTIONS) {
      const cfg = config(faction, 3);
      const g = createGame(cfg);
      g.state.tick = 1600;
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 3);
      const cmds = ai.think(snapshot(g, 0));
      const rifles = g.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon && unitDef(u.kind).capacity === undefined).map((u) => u.id);
      const sent = cmds.find((c) => c.type === 'move' && c.units.length === 1 && rifles.includes(c.units[0]!));
      expect(sent, faction).toBeDefined();
      expect(cmds.some((c) => c.type === 'produce' && c.kind === scoutOf(faction)), faction).toBe(false);
    }
  });

  it('AI-21: the steamroll opponent trains no scout unit', () => {
    for (const faction of FACTIONS) {
      const scout = scoutOf(faction);
      const { g, cfg } = builtBase(faction, 20000);
      const ai = new SteamrollAI(0, faction, cfg.map, 6);
      const log = drive(g, ai, 1200);
      expect(produced(log, scout), faction).toBe(0);
      expect(ai.stats.produced.scout, faction).toBe(0);
      // The ordinary AI on the same base does.
      const plain = builtBase(faction, 20000);
      expect(produced(drive(plain.g, new AI(0, faction, DIFFICULTIES.hard, plain.cfg.map, 6), 1), scout), faction).toBe(1);
    }
  }, LONG);

  it('AI-21: no vision cheat: with a standing scout out, hidden changes never alter its orders (AI-2)', () => {
    const run = (hiddenHp: number, hiddenAt: { tx: number; ty: number }): string[] => {
      const { g, cfg } = builtBase('human', 5000, [
        { owner: 0, kind: scoutOf('human'), tx: 20, ty: 26 },
        { owner: 1, kind: 'ali_brute', ...hiddenAt },
      ]);
      g.state.units[g.state.units.length - 1]!.hp = hiddenHp; // far from anything the AI can see
      const ai = new AI(0, 'human', DIFFICULTIES.medium, cfg.map, 3);
      return drive(g, ai, 1500).map((l) => `${l.tick}:${JSON.stringify(l.cmd)}`);
    };
    const a = run(620, { tx: 90, ty: 20 });
    expect(a.some((l) => l.includes('"move"'))).toBe(true);
    expect(run(100, { tx: 90, ty: 20 })).toEqual(a);
    expect(run(620, { tx: 88, ty: 24 })).toEqual(a);
  }, LONG);
});
