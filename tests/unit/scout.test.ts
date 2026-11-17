import { describe, expect, it } from 'vitest';
import { AI, DEFAULT_RULES, DIFFICULTIES, PICKET_ALONG, PICKET_SIDE, SCOUT_FLEE, SCOUT_HOP, SCOUT_KEEP, SCOUT_REPLACE, SCOUT_STANDOFF, SCOUT_YOUNG, STANDING_SCOUTS } from '../../src/ai/ai';
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

      // One standing scout (rules.twoScouts off); the second is tested below.
      const { g, cfg } = builtBase(faction, 20000);
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6, 'balanced', { rules: { twoScouts: false } });
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

      // That one is lost young, as soon as it stands: the next waits twice as long.
      for (let i = 0; i < 150 && scoutsOf(g, scout) === 0; i++) drive(g, ai, 20);
      expect(scoutsOf(g, scout), faction).toBe(1);
      drive(g, ai, 20);
      const youngAt = g.state.tick;
      g.state.units = g.state.units.filter((u) => !(u.owner === 0 && u.kind === scout));
      log = drive(g, ai, 2 * SCOUT_REPLACE + 200);
      const late = log.filter((l) => l.cmd.type === 'produce' && l.cmd.kind === scout);
      expect(late.length, faction).toBe(1);
      expect(late[0]!.tick - youngAt, faction).toBeGreaterThanOrEqual(2 * SCOUT_REPLACE);
      expect(ai.stats.standingLives.length, faction).toBe(2);
      expect(ai.stats.standingLives[1]!, faction).toBeLessThan(SCOUT_YOUNG);
    }
  }, LONG);

  it('AI-21: with rules.twoScouts it keeps two standing scouts, one touring the enemy base and one at its post on the way between the bases, and replaces a lost one after the gap', () => {
    expect(DEFAULT_RULES.twoScouts).toBe(true);
    expect([PICKET_ALONG, PICKET_SIDE]).toEqual([0.5, 6]);
    for (const faction of FACTIONS) {
      const scout = scoutOf(faction);
      const { g, cfg } = builtBase(faction, 20000);
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
      // One a decision, ahead of other combat units, until it has two; never a third.
      drive(g, ai, 1600);
      expect(scoutsOf(g, scout), faction).toBe(2);
      expect(queuedOf(g, scout), faction).toBe(0);
      expect(ai.standingScout, faction).toBeGreaterThanOrEqual(0);
      expect(ai.pickedScout, faction).toBeGreaterThanOrEqual(0);
      expect(ai.pickedScout, faction).not.toBe(ai.standingScout);
      // The second heads for its post and waits there; it is no part of the army.
      const post = ai.picketPost();
      drive(g, ai, 1600);
      const p = g.state.units.find((u) => u.id === ai.pickedScout)!;
      expect(Math.hypot(p.x / FP - post.tx - 0.5, p.y / FP - post.ty - 0.5), faction).toBeLessThan(4);
      // Lost: replaced after the gap, like the first (once a factory or pit has room in its queue).
      const lostAt = g.state.tick;
      g.state.units = g.state.units.filter((u) => u.id !== ai.pickedScout);
      const log = drive(g, ai, SCOUT_REPLACE + 3000);
      const again = log.filter((l) => l.cmd.type === 'produce' && l.cmd.kind === scout);
      expect(again.length, faction).toBe(1);
      expect(again[0]!.tick - lostAt, faction).toBeGreaterThanOrEqual(SCOUT_REPLACE);
    }
  }, LONG);

  it('AI-21: the second standing scout flees from an armed enemy unit within scoutKeep tiles, as the first does', () => {
    for (const faction of FACTIONS) {
      const scout = scoutOf(faction);
      const { g, cfg } = builtBase(faction, 20000);
      const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
      drive(g, ai, 3200);
      const p = g.state.units.find((u) => u.id === ai.pickedScout)!;
      expect(p.kind, faction).toBe(scout);
      const foe = faction === 'human' ? 'ali_brute' : 'hum_tank';
      const at = { x: p.x + 6 * FP, y: p.y };
      const s = snapshot(g, 0);
      s.units.push({ id: 900001, owner: 1, kind: foe, x: at.x, y: at.y, hp: unitDef(foe).hp, dest: null, load: 0, rank: 0, target: -1 });
      const to = moveOf(ai.think(s), p.id);
      expect(to, faction).not.toBeNull();
      // Farther from the threat than it stands (moveOf gives tiles).
      expect(Math.hypot(to!.x - at.x / FP, to!.y - at.y / FP), faction).toBeGreaterThan(Math.hypot(p.x - at.x, p.y - at.y) / FP + 2);
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

  it('AI-21: whatever its health it flees straight away from an armed enemy unit within 10 tiles, from artillery as soon as it sees it, and from a defence within 8', () => {
    for (const faction of FACTIONS) {
      const cfg = config(faction);
      const scout = scoutOf(faction);
      const enemy = other(faction);
      const spot = open(cfg, 50, 40);
      const threats: { what: string; spawn: { units?: UnitSpawn[]; buildings?: BuildingSpawn[] }; at: { tx: number; ty: number } }[] = [];
      const u = open(cfg, spot.tx + 8, spot.ty + 4);
      threats.push({ what: 'tank at 9', spawn: { units: [{ owner: 1, kind: enemy === 'human' ? 'hum_tank' : 'ali_brute', ...u }] }, at: u });
      const a = open(cfg, spot.tx + 10, spot.ty + 3);
      threats.push({ what: 'artillery at 10.4', spawn: { units: [{ owner: 1, kind: enemy === 'human' ? 'hum_artillery' : 'ali_lobber', ...a }] }, at: a });
      const t = open(cfg, spot.tx + 7, spot.ty);
      threats.push({ what: 'defence', spawn: { buildings: [{ owner: 1, kind: kitOf(enemy).turret, ...t }] }, at: t });
      for (const th of threats) {
        for (const hp of [1, 0.3]) {
          const g = createGame({ ...cfg, units: [...(cfg.units ?? []), { owner: 0, kind: scout, ...spot }, ...(th.spawn.units ?? [])], buildings: [...(cfg.buildings ?? []), ...(th.spawn.buildings ?? [])] });
          const me = g.state.units.find((x) => x.owner === 0 && x.kind === scout)!;
          me.hp = Math.round(unitDef(scout).hp * hp);
          const before = Math.hypot(spot.tx - th.at.tx, spot.ty - th.at.ty);
          expect(before, th.what).toBeLessThanOrEqual(unitDef(scout).vision);
          const ai = new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6);
          const to = moveOf(ai.think(snapshot(g, 0)), me.id);
          const where = `${faction} ${th.what} hp ${hp}`;
          expect(to, `${where}: a move order`).not.toBeNull();
          // Straight away: SCOUT_FLEE tiles, on the far side from the threat.
          const dx = to!.x - spot.tx - 0.5;
          const dy = to!.y - spot.ty - 0.5;
          expect(Math.hypot(dx, dy), where).toBeGreaterThan(SCOUT_FLEE - 1.5);
          const ux = th.at.tx - spot.tx;
          const uy = th.at.ty - spot.ty;
          expect((dx * ux + dy * uy) / (Math.hypot(dx, dy) * Math.hypot(ux, uy)), where).toBeLessThan(-0.9);
          expect(Math.hypot(to!.x - th.at.tx - 0.5, to!.y - th.at.ty - 0.5), where).toBeGreaterThan(before + SCOUT_FLEE - 2);
        }
      }
      // A tank at 11 tiles, beyond SCOUT_KEEP: no flight, at most a short hop.
      const far = open(cfg, spot.tx + 11, spot.ty);
      const g = createGame({ ...cfg, units: [...(cfg.units ?? []), { owner: 0, kind: scout, ...spot }, { owner: 1, kind: enemy === 'human' ? 'hum_tank' : 'ali_brute', ...far }] });
      const me = g.state.units.find((x) => x.owner === 0 && x.kind === scout)!;
      expect(Math.hypot(far.tx - spot.tx, far.ty - spot.ty)).toBeGreaterThan(SCOUT_KEEP);
      const to = moveOf(new AI(0, faction, DIFFICULTIES.hard, cfg.map, 6).think(snapshot(g, 0)), me.id);
      if (to) expect(Math.hypot(to.x - spot.tx - 0.5, to.y - spot.ty - 0.5), faction).toBeLessThanOrEqual(SCOUT_HOP + 1);
    }
  });

  it('AI-21: it tours points round the enemy base but not its front, to and fro, in short hops round the ground near the enemy, about 9 tiles from the buildings it knows', () => {
    for (const faction of FACTIONS) {
      for (const level of ['hard', 'medium'] as const) {
        const cfg = config(faction, 6);
        const scout = scoutOf(faction);
        const k = kitOf(faction);
        const hq = cfg.buildings!.find((b) => b.owner === 0 && b.kind === k.hq)!;
        // A quiet enemy: its base only, no units to chase the scout.
        const g = createGame({ ...cfg, units: [...(cfg.units ?? []).filter((u) => u.owner === 0), { owner: 0, kind: scout, tx: hq.tx + 6, ty: hq.ty + 8 }] });
        const id = g.state.units.find((u) => u.owner === 0 && u.kind === scout)!.id;
        const ai = new AI(0, faction, DIFFICULTIES[level], cfg.map, 6);
        const where = `${faction} ${level}`;
        const goals: string[] = [];
        let nearest = Infinity;
        drive(g, ai, 20 * 60 * 5, (cmds) => {
          const me = g.state.units.find((u) => u.id === id);
          if (!me) return;
          const x = me.x / FP;
          const y = me.y / FP;
          // Every order is a short hop.
          const to = moveOf(cmds, id);
          if (to) expect(Math.hypot(to.x - x, to.y - y), `${where} hop`).toBeLessThanOrEqual(SCOUT_HOP + 1.5);
          const { tour, goal } = ai.scoutPlan;
          if (goal && goals[goals.length - 1] !== `${goal.tx},${goal.ty}`) goals.push(`${goal.tx},${goal.ty}`);
          // Its points stand SCOUT_STANDOFF tiles out from every enemy building it knows, and none faces us.
          const s = snapshot(g, 0);
          const known = [...s.buildings.filter((b) => b.owner === 1), ...s.ghosts];
          if (known.length > 0) {
            const cx = known.reduce((t, b) => t + b.tx + buildingDef(b.kind).w / 2, 0) / known.length;
            const cy = known.reduce((t, b) => t + b.ty + buildingDef(b.kind).h / 2, 0) / known.length;
            for (const p of tour) {
              for (const b of known) {
                const d = buildingDef(b.kind);
                expect(Math.hypot(Math.max(b.tx - p.tx - 0.5, 0, p.tx + 0.5 - b.tx - d.w), Math.max(b.ty - p.ty - 0.5, 0, p.ty + 0.5 - b.ty - d.h)), `${where} point ${p.tx},${p.ty}`).toBeGreaterThanOrEqual(SCOUT_STANDOFF);
              }
              const ux = p.tx - cx;
              const uy = p.ty - cy;
              const vx = hq.tx - cx;
              const vy = hq.ty - cy;
              expect((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)), `${where} point ${p.tx},${p.ty} faces us`).toBeLessThan(0.93);
            }
          }
          for (const b of g.state.buildings.filter((q) => q.owner === 1)) {
            const d = buildingDef(b.kind);
            nearest = Math.min(nearest, Math.hypot(Math.max(b.tx - x, 0, x - b.tx - d.w), Math.max(b.ty - y, 0, y - b.ty - d.h)));
          }
        });
        // Alive at the end; it moved on through several points, and came back to one (to and fro).
        expect(g.state.units.some((u) => u.id === id), where).toBe(true);
        expect(new Set(goals).size, where).toBeGreaterThanOrEqual(4);
        expect(goals.length, where).toBeGreaterThan(new Set(goals).size);
        // It never came near the base, and it found it.
        expect(nearest, where).toBeGreaterThan(SCOUT_STANDOFF - 2);
        expect(ai.stats.scoutedAt, where).toBeGreaterThan(0);
      }
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

  it('AI-21: for measurement the standing scout can be turned off, and its life and what it remembers can be read', () => {
    for (const faction of FACTIONS) {
      const scout = scoutOf(faction);
      const on = builtBase(faction, 20000, [{ owner: 0, kind: scout, tx: 20, ty: 26 }]);
      const ai = new AI(0, faction, DIFFICULTIES.hard, on.cfg.map, 6);
      drive(on.g, ai, 1);
      const id = on.g.state.units.find((u) => u.owner === 0 && u.kind === scout)!.id;
      expect(ai.standingScout, faction).toBe(id);
      expect(ai.stats.standingSince, faction).toBe(0);
      on.g.state.units = on.g.state.units.filter((u) => u.id !== id);
      drive(on.g, ai, 40);
      expect(ai.standingScout, faction).toBe(-1);
      expect(ai.stats.standingLives.length, faction).toBe(1);
      expect(ai.stats.standingSince, faction).toBe(-1);
      // What it remembers is only what it saw: the enemy start force by its base is not in sight.
      for (const [uid, e] of ai.sightings) expect(on.g.state.units.find((u) => u.id === uid)?.owner ?? 1, `${faction} ${e.kind}`).not.toBe(0);

      const off = builtBase(faction, 20000, [{ owner: 0, kind: scout, tx: 20, ty: 26 }]);
      const old = new AI(0, faction, DIFFICULTIES.hard, off.cfg.map, 6, 'balanced', { standingScout: false });
      drive(off.g, old, 200);
      expect(old.standingScout, faction).toBe(-1);
      expect(old.stats.standingSince, faction).toBe(-1);
    }
  });
});
