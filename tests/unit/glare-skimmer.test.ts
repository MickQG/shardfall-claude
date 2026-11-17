import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AI, ARMOUR_INTEL_TICKS, DIFFICULTIES, heavyShareByCost, MOSTLY_HEAVY, INFANTRY_HEAVY, skimmerOf, skimOr, type Personality } from '../../src/ai/ai';
import { soundFor } from '../../src/audio/plan';
import { ACK_KINDS, MOVE_LOOPS, moveClass, moveLoopSamples, recipeFor } from '../../src/audio/recipes';
import { canCrush, DAMAGE_PCT, trainableAt, UNIT_DEFS, unitDef } from '../../src/data/defs';
import { skirmishConfig } from '../../src/data/maps';
import { UNIT_MODELS } from '../../src/render/voxel/models';
import { CombatFx, LANCE_BEAM_MS, LOOKS, shotDuration } from '../../src/render3d/fx3d';
import { bodyPose, HOVER_BOB, restingMotion } from '../../src/render3d/motion';
import { muzzleCount, poseRig, rigTree, turretReach, type RigPose } from '../../src/render3d/rig';
import { LANCE_MOUNT, LANCE_PITCH, SKIMMER_HOVER, UNIT_RIGS } from '../../src/render3d/units3d';
import { createGame, damageAgainst, FP, snapshot, submit, tick, type Command, type Game, type SimEvent, type UnitSpawn } from '../../src/sim';
import { open } from './battle';

const SKIM = 'ali_skimmer';
const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: open(30, 30), units });
const run = (g: Game, n: number, each?: (e: SimEvent) => void): void => {
  for (let i = 0; i < n; i++) {
    tick(g);
    if (each) for (const e of g.state.events) each(e);
  }
};
const unitAt = (g: Game, kind: string, owner = 0) => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;

describe('the Glare Skimmer in the simulation', () => {
  it('SKM-1: a tier-2 Vrax heavy unit from the Brood Pit: 400 HP, speed 40, cost 950, a lance at range 9 that cannot hit air', () => {
    const d = unitDef(SKIM);
    expect(d).toMatchObject({ faction: 'alien', name: 'Glare Skimmer', builtAt: 'ali_pit', requires: [], armor: 'heavy', hp: 400, speed: 40, cost: 950, role: 'antiarmor', firesMoving: true });
    expect(d.crusher).toBeFalsy();
    expect(d.hero).toBeFalsy();
    expect(d.air).toBeFalsy();
    expect(d.weapon).toMatchObject({ type: 'lance', range: 9, antiAir: false, antiGround: true });
    expect(d.vision).toBeGreaterThanOrEqual(d.weapon!.range);
    // Tier 2: it needs nothing beyond the Brood Pit, as the Brute.
    expect(d.requires).toEqual(unitDef('ali_brute').requires);
    expect(trainableAt('ali_pit')).toContain(SKIM);
  });

  it('SKM-2: the lance does 160% to heavy armour, 50% to light, 60% to structures and nothing to aircraft', () => {
    expect(DAMAGE_PCT.lance).toEqual({ heavy: 160, light: 50, structure: 60, air: 0 });
    const w = unitDef(SKIM).weapon!;
    expect(damageAgainst(w, 'heavy')).toBe(Math.floor((w.damage * 160) / 100));
    expect(damageAgainst(w, 'light')).toBe(Math.floor(w.damage / 2));
    expect(damageAgainst(w, 'structure')).toBe(Math.floor((w.damage * 60) / 100));
    expect(damageAgainst(w, 'air')).toBe(0);
  });

  it('SKM-2: it hits a tank 7.5 tiles away at once for its heavy damage, and nothing beyond range 8 while holding position', () => {
    const shotAt = (gap: number): { hits: number; lost: number } => {
      const g = game([
        { owner: 0, kind: SKIM, tx: 5, ty: 10 },
        { owner: 1, kind: 'hum_tank', tx: 5 + gap, ty: 10 },
      ]);
      const sk = unitAt(g, SKIM);
      const tank = unitAt(g, 'hum_tank', 1);
      const hp0 = tank.hp;
      // Hold the tank still so it neither closes in nor runs.
      let hits = 0;
      for (let i = 0; i < 30; i++) {
        tank.x = (5 + gap) * FP + FP / 2;
        tank.target = -1;
        tank.mode = 'idle';
        sk.x = 5 * FP + FP / 2;
        sk.path = [];
        tick(g);
        for (const e of g.state.events) if (e.t === 'shot' && e.src === sk.id) hits++;
      }
      return { hits, lost: hp0 - tank.hp };
    };
    const near = shotAt(8);
    expect(near.hits).toBeGreaterThan(0);
    expect(near.lost).toBe(near.hits * damageAgainst(unitDef(SKIM).weapon!, 'heavy'));
    expect(shotAt(10).hits).toBe(0);
  });

  it('SKM-3: on a plain move order it keeps firing at enemies in range without stopping; a unit without the flag holds fire', () => {
    const drive = (kind: string): { shots: number; moved: boolean } => {
      const g = game([
        { owner: 0, kind, tx: 3, ty: 4 },
        { owner: 1, kind: 'hum_tank', tx: 10, ty: 9 },
      ]);
      const u = unitAt(g, kind);
      const x0 = u.x;
      submit(g, { type: 'move', player: 0, units: [u.id], x: 24 * FP + FP / 2, y: 4 * FP + FP / 2 });
      let shots = 0;
      run(g, 80, (e) => {
        if (e.t === 'shot' && e.owner === 0) shots++;
      });
      return { shots, moved: unitAt(g, kind).x > x0 + 5 * FP };
    };
    const sk = drive(SKIM);
    expect(sk.moved).toBe(true);
    expect(sk.shots).toBeGreaterThan(0);
    expect(drive('ali_spitter')).toEqual({ shots: 0, moved: true });
    // The flag is not crushing: crushers keep their own rule (BAL-11).
    expect(Object.keys(UNIT_DEFS).filter((k) => unitDef(k).firesMoving)).toEqual([SKIM]);
  });

  it('SKM-3: it crushes nothing: driving through an enemy squad flattens no one', () => {
    for (const v of Object.keys(UNIT_DEFS)) expect(canCrush(SKIM, v), v).toBe(false);
    const g = game([
      { owner: 0, kind: SKIM, tx: 5, ty: 10 },
      { owner: 1, kind: 'hum_rifleman', tx: 9, ty: 10 },
    ]);
    submit(g, { type: 'move', player: 0, units: [unitAt(g, SKIM).id], x: 14 * FP + FP / 2, y: 10 * FP + FP / 2 });
    let crushed = 0;
    run(g, 100, (e) => {
      if (e.t === 'die' && e.crushed) crushed++;
    });
    expect(crushed).toBe(0);
  });
});

const STILL: RigPose = { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: false };

describe('the Glare Skimmer model, beam and sounds', () => {
  const def = UNIT_RIGS[SKIM]!();

  /** World-space points of every drawn part of a posed skimmer, by part name. */
  const points = (turret: number, aim = 0): Map<string, THREE.Vector3[]> => {
    const t = rigTree(def);
    poseRig(t, { ...STILL, turret, aim });
    t.root.updateMatrixWorld(true);
    const out = new Map<string, THREE.Vector3[]>();
    for (const d of t.drawn) {
      const list = out.get(d.geo) ?? [];
      for (const p of def.shapes[d.geo]!().pieces) {
        const pos = p.geo.getAttribute('position');
        for (let i = 0; i < pos.count; i++) list.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(d.obj.matrixWorld));
      }
      out.set(d.geo, list);
    }
    return out;
  };

  it('SKM-4: the hull floats about 0.3 tiles above the ground, so its shadow lies apart from it (VOX-8), and it bobs gently', () => {
    expect(def.move).toBe('hover');
    expect(SKIMMER_HOVER).toBeCloseTo(0.3, 5);
    const low = Math.min(...[...points(0).values()].flat().map((v) => v.y)) * (def.scale ?? 1);
    expect(Math.abs(low - SKIMMER_HOVER)).toBeLessThan(0.02);
    // On its cushion it bobs, a little, and banks into turns.
    const bobs = [0, 400, 800, 1200, 1600].map((t) => bodyPose('hover', restingMotion(), 0, t, 0).bob);
    for (const b of bobs) expect(Math.abs(b)).toBeLessThanOrEqual(HOVER_BOB + 1e-9);
    expect(Math.max(...bobs) - Math.min(...bobs)).toBeGreaterThan(0.005);
    expect(Math.abs(bodyPose('hover', { ...restingMotion(), speed: 1, turnRate: 1 }, 0, 0, 0).roll)).toBeGreaterThan(0);
  });

  it('SKM-4: a glowing underside, a team carapace, and a long lance on its back that turns all round and pitches clear of the hull (AIM-2)', () => {
    const hull = def.shapes.hull!().pieces;
    expect(hull.some((p) => p.glow)).toBe(true);
    expect(hull.some((p) => p.paint === 'team')).toBe(true);
    expect(turretReach(def)).toBe(Infinity);
    expect(muzzleCount(def)).toBe(1);
    expect(def.weapon).toBe('lance');
    const top = Math.max(...points(0).get('hull')!.map((v) => v.y));
    const [mx, , mz] = LANCE_MOUNT;
    for (let a = -Math.PI; a < Math.PI; a += Math.PI / 8) {
      for (const aim of [-1, 0, 1]) {
        const lance = points(a, aim).get('lance')!;
        // The emitter is long: it reaches well past the mount.
        const reach = Math.max(...lance.map((v) => Math.hypot(v.x - mx, v.z - mz)));
        expect(reach).toBeGreaterThan(0.8);
        // Everything of it away from the breech rides above the hull's highest point, pitched or not.
        for (const v of lance) if (Math.hypot(v.x - mx, v.z - mz) > 0.14) expect(v.y).toBeGreaterThan(top);
      }
    }
  });

  it('SKM-4: the lance lies forward along the back like a gun barrel, past the head, and the beam leaves its tip', () => {
    const t = rigTree(def);
    poseRig(t, STILL);
    t.root.updateMatrixWorld(true);
    const lance = points(0).get('lance')!;
    const hull = points(0).get('hull')!;
    const top = Math.max(...hull.map((v) => v.y));
    // Low on the back: no part of it stands more than a barrel's width over the carapace; long: it reaches past the nose.
    expect(Math.max(...lance.map((v) => v.y)) - top).toBeLessThan(0.15);
    expect(Math.max(...lance.map((v) => v.x))).toBeGreaterThan(Math.max(...hull.filter((v) => Math.abs(v.z) < 0.1).map((v) => v.x)));
    // The muzzle is at the tip, pointing forward along it.
    const tip = t.muzzles[0]!.getWorldPosition(new THREE.Vector3());
    expect(tip.x).toBeGreaterThan(Math.max(...lance.map((v) => v.x)) - 0.05);
    expect(new THREE.Vector3().setFromMatrixColumn(t.muzzles[0]!.matrixWorld, 0).normalize().x).toBeCloseTo(1, 5);
  });

  it('SKM-4: the lance pitches a little toward its target, within its limits, and the beam leaves along it', () => {
    const pitchAt = (aim: number): number => {
      const t = rigTree(def);
      poseRig(t, { ...STILL, turret: 1, aim });
      t.root.updateMatrixWorld(true);
      const d = new THREE.Vector3().setFromMatrixColumn(t.muzzles[0]!.matrixWorld, 0).normalize();
      return Math.asin(d.y);
    };
    expect(pitchAt(0.08)).toBeCloseTo(0.08, 5);
    expect(pitchAt(-0.02)).toBeCloseTo(-0.02, 5);
    expect(pitchAt(1)).toBeCloseTo(LANCE_PITCH.hi, 5);
    expect(pitchAt(-1)).toBeCloseTo(LANCE_PITCH.lo, 5);
    expect(LANCE_PITCH.hi).toBeLessThanOrEqual(0.2);
    expect(LANCE_PITCH.lo).toBeGreaterThanOrEqual(-0.05);
  });

  it('SKM-4: the classic model hovers too: its lowest voxel is well above the ground', () => {
    const m = UNIT_MODELS[SKIM]!().hull;
    let low = Infinity;
    for (let z = 0; z < m.sz && low === Infinity; z++) for (let y = 0; y < m.sy; y++) for (let x = 0; x < m.sx; x++) if (m.cells[(z * m.sy + y) * m.sx + x]) low = Math.min(low, z);
    // Half-size voxels: 16 a tile, so four or more is a quarter tile clear.
    expect(low).toBeGreaterThanOrEqual(4);
  });

  it('SKM-4: the lance fires a held beam: the hit flashes at once, the beam lasts its time, then is gone', () => {
    expect(LOOKS.lance.beam).toBe(LANCE_BEAM_MS);
    expect(LANCE_BEAM_MS).toBeGreaterThanOrEqual(300);
    expect(shotDuration('lance', 8, 0)).toBe(LANCE_BEAM_MS);
    const from = new THREE.Vector3(2, 0.6, 2);
    const to = new THREE.Vector3(9, 0.3, 2);
    const fx = new CombatFx();
    fx.shot('lance', from, to, 0, 0);
    fx.update(16, 0.016);
    // The hit flash is there at once (a rifle round 7 tiles off has not arrived yet).
    expect(fx.particleCount).toBeGreaterThan(0);
    const rifle = new CombatFx();
    rifle.shot('rifle', from, to, 0, 0);
    rifle.update(16, 0.016);
    expect(rifle.particleCount).toBe(0);
    const live = (f: CombatFx): number => (f as unknown as { shots: unknown[] }).shots.length;
    fx.update(LANCE_BEAM_MS - 40, 0.016);
    expect(live(fx)).toBe(1);
    fx.update(LANCE_BEAM_MS + 20, 0.016);
    expect(live(fx)).toBe(0);
  });

  it('SKM-5: a hover hum while it moves and a rising beam tone when it fires, both procedural', () => {
    expect(moveClass(SKIM)).toBe('skim');
    const rate = 8000;
    const d = moveLoopSamples('skim', rate);
    expect(d.length).toBe(Math.round(MOVE_LOOPS.skim.period * rate));
    expect(Math.max(...d.map(Math.abs))).toBeGreaterThan(0.1);
    // Seamless: the loop's end meets its start.
    expect(Math.abs(d[d.length - 1]! - d[0]!)).toBeLessThan(0.05);
    expect(MOVE_LOOPS.skim.filter.f).toBeLessThanOrEqual(1000);
    expect(soundFor({ t: 'shot', x: 0, y: 0, tx: 0, ty: 0, weapon: 'lance', owner: 0, air: false, flight: 0, src: 1 }, 0).name).toBe('lance');
    for (const f of ['alien', 'human'] as const) {
      const r = recipeFor('lance', f)!;
      expect(r.layers.length).toBeGreaterThanOrEqual(2);
      expect(r.layers.some((l) => l.role === 'attack')).toBe(true);
      // The beam tone rises.
      expect(r.layers.some((l) => l.src === 'osc' && l.role !== 'attack' && (l.to ?? 0) > (l.freq ?? Infinity))).toBe(true);
    }
    expect(ACK_KINDS).toContain(SKIM);
  });
});

describe('the AI trains Skimmers against armour', () => {
  it('SKM-6: the heavy share is by cost, over armed enemies seen in the last two minutes', () => {
    expect(ARMOUR_INTEL_TICKS).toBe(2400);
    expect(MOSTLY_HEAVY).toBe(0.5);
    // Two tanks (1600) against six rifle squads (600): mostly armour by cost, though not by count.
    const seen = [...Array(2)].map(() => ({ kind: 'hum_tank', t: 1000 })).concat([...Array(6)].map(() => ({ kind: 'hum_rifleman', t: 1000 })));
    expect(heavyShareByCost(seen, 1000)).toBeCloseTo(1600 / 2200);
    // Unarmed haulers do not count; nor does what was seen over two minutes ago.
    expect(heavyShareByCost([...seen, { kind: 'hum_hauler', t: 1000 }], 1000)).toBeCloseTo(1600 / 2200);
    expect(heavyShareByCost(seen, 1000 + ARMOUR_INTEL_TICKS + 1)).toBe(0);
    expect(heavyShareByCost([], 0)).toBe(0);
    expect(skimmerOf(trainableAt('ali_pit'))).toBe(SKIM);
    expect(skimmerOf(trainableAt('hum_factory'))).toBeNull();
  });

  /** A built-up Vrax base (player 0) on seed 6 with enemies `foes` in sight of it. */
  function vraxBase(foes: string[]): Game {
    const cfg = skirmishConfig(6, { factions: ['alien', 'human'] });
    const spots = [...Array(24)].map((_, i) => ({ tx: 16 + (i % 6) * 4, ty: 4 + Math.floor(i / 6) * 4 }));
    let next = 0;
    const put = (kind: string, n: number) => [...Array(n)].map(() => ({ owner: 0, kind, ...spots[next++]! }));
    const buildings = [
      ...cfg.buildings!.filter((b) => b.owner !== 0),
      { owner: 0, kind: 'ali_hq', tx: 10, ty: 10 },
      ...put('ali_generator', 8),
      ...put('ali_extractor', 3),
      ...put('ali_nest', 2),
      ...put('ali_pit', 2),
    ];
    const units = [
      ...(cfg.units ?? []).filter((u) => u.owner !== 0),
      ...[...Array(8)].map((_, i) => ({ owner: 0, kind: 'ali_gorger', tx: 12 + i, ty: 16 })),
      ...['ali_stalker', 'ali_brute', 'ali_brute', 'ali_skitter', 'ali_spitter'].map((kind, i) => ({ owner: 0, kind, tx: 22 + i, ty: 20 })),
      ...foes.map((kind, i) => ({ owner: 1, kind, tx: 22 + (i % 5), ty: 24 + Math.floor(i / 5) })),
    ];
    const g = createGame({ ...cfg, players: [{ faction: 'alien', credits: 20000 }, cfg.players![1]!], buildings, units });
    g.state.tick = 7000;
    return g;
  }

  /** Every unit kind its Brood Pits order, and every one it orders anywhere, over some decisions, with the bank refilled each time. */
  function orders(foes: string[], difficulty: keyof typeof DIFFICULTIES, personality: Personality): { pit: string[]; all: string[] } {
    const g = vraxBase(foes);
    const ai = new AI(0, 'alien', DIFFICULTIES[difficulty], g.state.cfg.map, 6, personality);
    const pits = new Set(g.state.buildings.filter((b) => b.owner === 0 && b.kind === 'ali_pit').map((b) => b.id));
    const out = { pit: [] as string[], all: [] as string[] };
    for (let i = 0; i < 40; i++) {
      g.state.players[0]!.credits = 20000;
      for (const c of ai.think(snapshot(g, 0))) {
        if (c.type === 'produce' && UNIT_DEFS[c.kind]) {
          out.all.push(c.kind);
          if (pits.has(c.source)) out.pit.push(c.kind);
        }
        submit(g, c as Command);
      }
      // Hold the enemies in place, in sight, so the picture does not change.
      for (const u of g.state.units) if (u.owner === 1) u.path = [];
      tick(g);
    }
    return out;
  }
  const pitOrders = (foes: string[], difficulty: keyof typeof DIFFICULTIES, personality: Personality): string[] => orders(foes, difficulty, personality).pit;

  it('SKM-6: against mostly heavy armour it trains Skimmers as its main anti-armour unit, within the Brood Pit mix, at every difficulty and personality', () => {
    const armour = ['hum_tank', 'hum_tank', 'hum_tank', 'hum_tank', 'hum_rifleman', 'hum_rifleman'];
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (const personality of ['balanced', 'raider', 'doomsday'] as const) {
        const o = orders(armour, difficulty, personality);
        const what = `${difficulty} ${personality}: ${o.all.join(',')}`;
        // Its Brood Pits train Skimmers ahead of their usual mix, and of the anti-armour it orders, Skimmers are most by value.
        const mixed = o.pit.filter((k) => k !== 'ali_gorger' && k !== 'ali_stalker');
        expect(mixed.filter((k) => k === SKIM).length, what).toBeGreaterThan(mixed.length / 2);
        const value = (k: string): number => o.all.filter((x) => x === k).length * unitDef(k).cost;
        expect(value(SKIM), what).toBeGreaterThan(value('ali_spitter'));
      }
    }
  });
  it('SKM-6, BAL-6: against armour that comes with an infantry-heavy army (by count) the Skimmer only joins the mix, beside the crushers', () => {
    expect(INFANTRY_HEAVY).toBe(0.45);
    // It takes the place of a building's usual choice, but never of artillery (AI-19).
    expect(skimOr(SKIM, 'ali_brute')).toBe(SKIM);
    expect(skimOr(SKIM, null)).toBe(SKIM);
    expect(skimOr(SKIM, 'ali_lobber')).toBe('ali_lobber');
    expect(skimOr(null, 'ali_brute')).toBe('ali_brute');
    // Four tanks (3200) and six rifle squads (600): mostly armour by cost, but 60% squads by count.
    const mixed = ['hum_tank', 'hum_tank', 'hum_tank', 'hum_tank', ...Array<string>(6).fill('hum_rifleman')];
    const pit = pitOrders(mixed, 'hard', 'balanced').filter((k) => k !== 'ali_gorger' && k !== 'ali_stalker');
    expect(pit).toContain('ali_brute');
    expect(pit.filter((k) => k === SKIM).length).toBeLessThan(pit.length / 2 + 1e-9);
  });

  it('SKM-6: against an army that is not mostly armour it trains no Skimmers', () => {
    const infantry = ['hum_rifleman', 'hum_rifleman', 'hum_rifleman', 'hum_rocketeer', 'hum_rocketeer', 'hum_rocketeer', 'hum_buggy', 'hum_tank'];
    for (const difficulty of ['easy', 'hard'] as const) expect(pitOrders(infantry, difficulty, 'balanced')).not.toContain(SKIM);
  });
});
