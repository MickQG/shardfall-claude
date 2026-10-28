import { describe, expect, it } from 'vitest';
import { AI, chooseUnitKind, DIFFICULTIES, shouldAttack, type Intel, type Role } from '../../src/ai/ai';
import { playMatch, totalViolations } from '../../src/ai/harness';
import { kitOf } from '../../src/ai/kit';
import { buildingDef, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { createGame, FP, snapshot, submit, tick, type Command, type Game, type GameConfig } from '../../src/sim';
import { Hv } from '../../src/sim/state';

const LONG = 240_000;

function setup(cfgOver: Partial<GameConfig> = {}, difficulty: keyof typeof DIFFICULTIES = 'hard', faction: 'human' | 'alien' = 'human') {
  const base = skirmishConfig(3, { factions: faction === 'human' ? ['human', 'alien'] : ['alien', 'human'] });
  const cfg: GameConfig = { ...base, ...cfgOver };
  const game = createGame(cfg);
  const ai = new AI(0, faction, DIFFICULTIES[difficulty], cfg.map, 3);
  return { cfg, game, ai };
}

/** Run `ticks`, letting the AI think on its cadence; returns every command it issued, with the tick. */
function drive(game: Game, ai: AI, ticks: number, onCmds?: (c: Command[], g: Game) => void): { tick: number; cmd: Command }[] {
  const log: { tick: number; cmd: Command }[] = [];
  for (let i = 0; i < ticks; i++) {
    if (game.state.tick % ai.diff.thinkEvery === 0) {
      const cmds = ai.think(snapshot(game, ai.player));
      onCmds?.(cmds, game);
      for (const c of cmds) {
        submit(game, c);
        log.push({ tick: game.state.tick, cmd: c });
      }
    }
    tick(game);
  }
  return log;
}

const mine = (g: Game, kind: string, owner = 0): number => g.state.buildings.filter((b) => b.owner === owner && b.kind === kind).length;

describe('economy and build order', () => {
  it('AI-1: builds a working economy and advances through the tech tree unaided', () => {
    const { game, ai } = setup();
    drive(game, ai, 6000);
    const k = kitOf('human');
    expect(mine(game, k.refinery)).toBeGreaterThanOrEqual(2);
    expect(mine(game, k.barracks)).toBeGreaterThanOrEqual(1);
    expect(mine(game, k.factory)).toBeGreaterThanOrEqual(1);
    expect(mine(game, k.turret)).toBeGreaterThanOrEqual(1);
    expect(mine(game, k.lab)).toBeGreaterThanOrEqual(1); // tier 3 reached
    expect(game.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).capacity !== undefined).length).toBeGreaterThanOrEqual(4);
    expect(game.state.units.filter((u) => u.owner === 0 && unitDef(u.kind).weapon).length).toBeGreaterThanOrEqual(8);
    const p = game.state.players[0]!;
    expect(p.powerIn).toBeLessThanOrEqual(p.powerOut);
  }, LONG);

  it('AI-3: opens with a sensible build order and never orders what it cannot afford or is not allowed', () => {
    const { game, ai } = setup();
    const structures: string[] = [];
    drive(game, ai, 3000, (cmds, g) => {
      let credits = g.state.players[0]!.credits;
      for (const c of cmds) {
        if (c.type !== 'produce') continue;
        const src = g.state.buildings.find((b) => b.id === c.source)!;
        const isStructure = buildingKind(c.kind);
        const cost = isStructure ? buildingDef(c.kind).cost : unitDef(c.kind).cost;
        expect(credits, `${c.kind} unaffordable`).toBeGreaterThanOrEqual(cost);
        credits -= cost;
        const requires = isStructure ? buildingDef(c.kind).requires : [unitDef(c.kind).builtAt, ...unitDef(c.kind).requires];
        for (const r of requires) expect(mine(g, r), `${c.kind} needs ${r}`).toBeGreaterThan(0);
        expect(src.owner).toBe(0);
        if (isStructure) structures.push(c.kind);
      }
    });
    const k = kitOf('human');
    expect(structures[0]).toBe(k.barracks); // power is ample at the start, so production first
    expect(structures.indexOf(k.refinery)).toBeGreaterThan(-1);
    expect(structures.indexOf(k.refinery)).toBeLessThan(4); // a second refinery comes early
    expect(structures.includes(k.power)).toBe(true);
    expect(game.state.players[0]!.powerIn).toBeLessThanOrEqual(game.state.players[0]!.powerOut + 0); // never left in the dark
  });

  it('AI-5: replaces lost haulers and re-tasks idle ones', () => {
    const { game, ai } = setup();
    drive(game, ai, 1500);
    const hk = kitOf('human').hauler;
    game.state.units = game.state.units.filter((u) => !(u.owner === 0 && u.kind === hk));
    const log = drive(game, ai, 900);
    const queued = game.state.buildings.filter((b) => b.owner === 0).flatMap((b) => b.queue).filter((q) => q.kind === hk).length;
    const alive = game.state.units.filter((u) => u.owner === 0 && u.kind === hk).length;
    expect(queued + alive).toBeGreaterThanOrEqual(1);
    expect(log.some((l) => l.cmd.type === 'produce' && l.cmd.kind === hk)).toBe(true);

    // An idle hauler (loop switched off) is sent back to work.
    const h = game.state.units.find((u) => u.owner === 0 && u.kind === hk);
    if (h) {
      h.auto = false;
      h.hv = Hv.Idle;
      h.path = [];
      h.goal = -1;
      const log2 = drive(game, ai, 400);
      expect(log2.some((l) => l.cmd.type === 'harvest' && l.cmd.units.includes(h.id))).toBe(true);
    }
  }, LONG);
});

describe('information and adaptation', () => {
  it('AI-2: has no vision cheat; hidden changes never alter its orders', () => {
    const run = (hiddenHp: number): string[] => {
      const { cfg, ai } = setup({}, 'medium');
      const g = createGame({ ...cfg, units: [...(cfg.units ?? []), { owner: 1, kind: 'ali_brute', tx: 90, ty: 20 }] });
      g.state.units[g.state.units.length - 1]!.hp = hiddenHp; // far from anything the AI can see
      return drive(g, ai, 1500).map((l) => `${l.tick}:${JSON.stringify(l.cmd)}`);
    };
    expect(run(760)).toEqual(run(100));
  });

  it('AI-4: adapts its army: anti-air against aircraft, anti-armour against armour', () => {
    const counts: Record<Role, number> = { inf: 4, at: 2, tank: 4, art: 0, air: 0, scout: 1 };
    const none: Intel = { air: 0, heavy: 0, light: 0, total: 0 };
    const cands = ['hum_rifleman', 'hum_rocketeer', 'hum_buggy', 'hum_tank'];
    const air = chooseUnitKind(['hum_tank', 'hum_rifleman', 'hum_buggy'], { ...counts, inf: 0 }, { air: 0.7, heavy: 0, light: 0.3, total: 8 });
    expect(unitDef(air!).weapon?.antiAir).toBe(true);
    const tankHeavy = chooseUnitKind(['hum_rifleman', 'hum_rocketeer', 'hum_tank'], { ...counts, at: 0, inf: 3 }, { air: 0, heavy: 0.8, light: 0.2, total: 8 });
    expect(unitDef(tankHeavy!).role).toBe('antiarmor');
    const vsInfantry = chooseUnitKind(['hum_rifleman', 'hum_rocketeer', 'hum_tank'], { ...counts, tank: 0, inf: 4, at: 4 }, { air: 0, heavy: 0, light: 0.9, total: 8 });
    expect(unitDef(vsInfantry!).role).toBe('tank');
    expect(chooseUnitKind(cands, counts, none)).not.toBeNull();
    expect(chooseUnitKind([], counts, none)).toBeNull();
  });
});

describe('army behaviour', () => {
  it('AI-6: scouts the enemy, remembers what it saw, and keeps building', () => {
    const { game, ai } = setup({}, 'hard');
    drive(game, ai, 2600); // before its army razes the (passive) enemy base
    expect(ai.stats.scoutedAt).toBeGreaterThan(0);
    const s = snapshot(game, 0);
    expect(s.buildings.some((b) => b.owner === 1) || s.ghosts.length > 0).toBe(true); // buildings remembered as ghosts
  }, LONG);

  it('AI-7: enemy gunmen near its buildings pull its army to the threat', () => {
    const { cfg, ai } = setup({}, 'hard');
    const riflemen = Array.from({ length: 6 }, (_, i) => ({ owner: 0, kind: 'hum_rifleman', tx: 20 + (i % 3), ty: 22 + Math.floor(i / 3) }));
    const raiders = Array.from({ length: 3 }, (_, i) => ({ owner: 1, kind: 'hum_rifleman', tx: 18 + i, ty: 13 }));
    const g = createGame({ ...cfg, units: [...(cfg.units ?? []), ...riflemen, ...raiders] });
    const army = g.state.units.filter((u) => u.owner === 0 && u.kind === 'hum_rifleman').map((u) => u.id);
    const cmds = ai.think(snapshot(g, 0));
    const defend = cmds.find((c) => c.type === 'attackmove' && Math.hypot(c.x / FP - 19, c.y / FP - 13) < 6);
    expect(defend, 'army sent at the raiders').toBeDefined();
    expect(defend && defend.type === 'attackmove' && army.every((id) => defend.units.includes(id))).toBe(true);
  });

  it('AI-8: attacks only when clearly stronger, and never with a handful of units', () => {
    expect(shouldAttack(2000, 900, 8, 900, 1.25)).toBe(true);
    expect(shouldAttack(1000, 900, 8, 900, 1.25)).toBe(false); // roughly equal: not good enough
    expect(shouldAttack(5000, 900, 3, 900, 1.25)).toBe(false); // too few units
    expect(shouldAttack(800, 100, 8, 900, 1.25)).toBe(false); // below the wave threshold
  });

  it('AI-9: repairs damaged buildings, salvages doomed ones, and fires its superweapon without hitting itself', () => {
    const { cfg, ai } = setup({}, 'hard');
    // Repair.
    const g1 = createGame(cfg);
    g1.state.buildings.find((b) => b.kind === 'hum_reactor' && b.owner === 0)!.hp = 200;
    expect(ai.think(snapshot(g1, 0)).some((c) => c.type === 'repair' && c.on)).toBe(true);
    // Salvage a dying refinery with enemies at the door.
    const g2 = createGame({ ...cfg, units: [...(cfg.units ?? []), { owner: 1, kind: 'ali_skitter', tx: 17, ty: 11 }] });
    const ref = g2.state.buildings.find((b) => b.kind === 'hum_refinery' && b.owner === 0)!;
    ref.hp = 50;
    expect(new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 3).think(snapshot(g2, 0)).some((c) => c.type === 'sell' && c.building === ref.id)).toBe(true);

    // Superweapon: a visible enemy cluster far from our own units is hit; one next to our units is not.
    const withLance = (enemyAt: [number, number]): Command[] => {
      const g = createGame({
        ...cfg,
        buildings: [...(cfg.buildings ?? []), { owner: 0, kind: 'hum_lance', tx: 18, ty: 18 }, { owner: 0, kind: 'hum_reactor', tx: 14, ty: 14 }, { owner: 0, kind: 'hum_reactor', tx: 14, ty: 17 }, { owner: 1, kind: 'ali_nest', tx: enemyAt[0], ty: enemyAt[1] }, { owner: 1, kind: 'ali_pit', tx: enemyAt[0] + 3, ty: enemyAt[1] }, { owner: 1, kind: 'ali_generator', tx: enemyAt[0], ty: enemyAt[1] + 3 }],
        units: [...(cfg.units ?? []), { owner: 0, kind: 'hum_buggy', tx: 26, ty: 14 }],
      });
      g.state.buildings.find((b) => b.kind === 'hum_lance')!.charge = buildingDef('hum_lance').superweapon!.charge;
      return new AI(0, 'human', DIFFICULTIES.hard, cfg.map, 3).think(snapshot(g, 0));
    };
    const far = withLance([32, 14]);
    const shot = far.find((c) => c.type === 'superweapon');
    expect(shot, 'fires at the visible cluster').toBeDefined();
    expect(shot && shot.type === 'superweapon' && Math.hypot(shot.x / FP - 33, shot.y / FP - 15) < 5).toBe(true);
    const close = withLance([27, 12]); // our scout stands inside the blast radius
    expect(close.some((c) => c.type === 'superweapon')).toBe(false);
  });
});

describe('difficulty', () => {
  it('AI-10: levels differ only in reaction time, orders per decision and shard bonus', () => {
    for (const d of Object.values(DIFFICULTIES)) expect(Object.keys(d).sort()).toEqual(['bonus', 'maxCommands', 'name', 'thinkEvery']);
    expect(DIFFICULTIES.easy.thinkEvery).toBeGreaterThan(DIFFICULTIES.medium.thinkEvery);
    expect(DIFFICULTIES.medium.thinkEvery).toBeGreaterThan(DIFFICULTIES.hard.thinkEvery);
    expect(DIFFICULTIES.easy.maxCommands).toBeLessThan(DIFFICULTIES.medium.maxCommands);
    expect(DIFFICULTIES.medium.maxCommands).toBeLessThan(DIFFICULTIES.hard.maxCommands);
    expect(DIFFICULTIES.hard.bonus).toBeGreaterThan(DIFFICULTIES.easy.bonus);

    // Orders per decision are capped.
    const { game, ai } = setup({}, 'easy');
    drive(game, ai, 600, (cmds) => expect(cmds.length).toBeLessThanOrEqual(DIFFICULTIES.easy.maxCommands));

    // The bonus is a plain income multiplier on delivered shards.
    const income = (bonus: number): number => {
      const cfg = skirmishConfig(1, { bonuses: [bonus, 0] });
      const g = createGame(cfg);
      const before = g.state.players[0]!.credits;
      for (let i = 0; i < 900; i++) tick(g);
      return g.state.players[0]!.credits - before;
    };
    const base = income(0);
    const boosted = income(50);
    expect(base).toBeGreaterThan(0);
    expect(boosted).toBeGreaterThan(base * 1.3);
  });
});

describe('headless harness', () => {
  const opts = { seed: 4, factions: ['human', 'alien'] as ['human', 'alien'], difficulties: [DIFFICULTIES.medium, DIFFICULTIES.medium] as [typeof DIFFICULTIES.medium, typeof DIFFICULTIES.medium], maxTicks: 3500 };

  it('HAR-1: complete AI-vs-AI matches are deterministic', () => {
    const a = playMatch(opts);
    const b = playMatch(opts);
    expect(a.hash).toBe(b.hash);
    expect(a.orders).toEqual(b.orders);
    expect(a.ai).toEqual(b.ai);
    expect(playMatch({ ...opts, seed: 5 }).hash).not.toBe(a.hash);
  }, LONG);

  it('HAR-2: detects bad behaviour, and a healthy AI stays under the thresholds', () => {
    const r = playMatch({ ...opts, maxTicks: 9000 });
    for (const v of r.violations) {
      expect(v.idleHauler).toBe(0);
      expect(v.powerOutage).toBe(0);
      expect(v.suicide).toBe(0);
      expect(v.lone).toBe(0);
      expect(v.stuck).toBeLessThanOrEqual(3);
      expect(v.hoard).toBeLessThanOrEqual(1);
      expect(v.undefended).toBeLessThanOrEqual(1);
      expect(totalViolations(v)).toBeLessThanOrEqual(5);
    }
    expect(r.peak.haulers[0]).toBeGreaterThanOrEqual(4);

    // The detector itself: a crippled AI (never thinks) leaves haulers idle in the harness' eyes.
    const lazy = { ...DIFFICULTIES.easy, thinkEvery: 1_000_000, maxCommands: 0 };
    const bad = playMatch({ ...opts, difficulties: [lazy, lazy], maxTicks: 12000 });
    expect(bad.violations[0].hoard + bad.violations[1].hoard).toBeGreaterThanOrEqual(1); // shards pile up unspent
    expect(bad.ai[0].waves + bad.ai[1].waves).toBe(0);
  }, LONG);

  it('HAR-3: across seeds and sides, Hard beats Easy, and Hard beats Medium more often than not', () => {
    const series = (a: keyof typeof DIFFICULTIES, b: keyof typeof DIFFICULTIES, seeds: number[]): { a: number; b: number } => {
      let wa = 0;
      let wb = 0;
      // Every pairing is played from both sides of the map and with both factions, so difficulty is not confused with faction or position.
      for (const seed of seeds) {
        for (const factions of [['human', 'alien'], ['alien', 'human']] as const) {
          for (const swap of [false, true]) {
            const d = swap ? [DIFFICULTIES[b], DIFFICULTIES[a]] : [DIFFICULTIES[a], DIFFICULTIES[b]];
            const r = playMatch({ seed, factions: [factions[0], factions[1]], difficulties: [d[0]!, d[1]!], maxTicks: 12000 });
            if (r.winner === null) continue;
            if ((r.winner === 0) !== swap) wa++;
            else wb++;
          }
        }
      }
      return { a: wa, b: wb };
    };
    const hardEasy = series('hard', 'easy', [1]);
    expect(hardEasy.a).toBeGreaterThanOrEqual(3); // of 4
    expect(hardEasy.a).toBeGreaterThan(hardEasy.b);
    const hardMedium = series('hard', 'medium', [1, 2, 3]);
    expect(hardMedium.a).toBeGreaterThan(hardMedium.b);
  }, 600_000);
});

function buildingKind(kind: string): boolean {
  try {
    buildingDef(kind);
    return true;
  } catch {
    return false;
  }
}
