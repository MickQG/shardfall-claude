import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unitDef } from '../../src/data/defs';
import { acknowledge } from '../../src/ui/acknowledge';
import { createGame, FP, submit, tick, type Game, type UnitSpawn } from '../../src/sim';
import { DIRS } from '../../src/sim/facing';
import { sanitizeCommand } from '../../src/net/protocol';
import { poseRig, rigTree } from '../../src/render3d/rig';
import { PALADIN_POD_TILT, UNIT_RIGS } from '../../src/render3d/units3d';
import { MISSILE_ARC } from '../../src/render3d/motion';

const W = 40;
const game = (units: UnitSpawn[]): Game => createGame({ seed: 1, map: { width: W, height: W, heights: new Array<number>(W * W).fill(0) }, units });
const at = (t: number): number => t * FP + FP / 2;
const missiles = (g: Game, n: number): number => {
  let out = 0;
  for (let i = 0; i < n; i++) {
    g.state.units.find((u) => u.kind === 'hum_paladin')!.cooldown = 1000; // only the pods act
    tick(g);
    out += g.state.events.filter((e) => e.t === 'shot' && e.weapon === 'missile').length;
  }
  return out;
};

describe('Paladin pods in a wide arc (HERO-8)', () => {
  it('HERO-8: the pods fire at a target 50 degrees off the facing, which the cannon could not, but not one beside or behind', () => {
    const off = (deg: number): number => {
      const rad = (deg * Math.PI) / 180;
      const g = game([
        { owner: 0, kind: 'hum_paladin', tx: 20, ty: 20 },
        { owner: 1, kind: 'ali_brute', tx: 20 + Math.round(8 * Math.cos(rad)), ty: 20 + Math.round(8 * Math.sin(rad)) },
      ]);
      const p = g.state.units.find((u) => u.kind === 'hum_paladin')!;
      p.facing = 0;
      g.state.units.find((u) => u.kind === 'ali_brute')!.hp = 9000;
      return missiles(g, 10);
    };
    expect(off(0)).toBeGreaterThan(0);
    expect(off(50)).toBeGreaterThan(0);
    expect(off(120)).toBe(0);
    expect(unitDef('hum_paladin').weapon2!.arc).toBe(43);
    expect((43 * 360) / DIRS).toBeGreaterThan(55);
  });

  it('HERO-8: the cannon hits for 80, the missiles for 14', () => {
    expect(unitDef('hum_paladin').weapon!.damage).toBe(80);
    expect(unitDef('hum_paladin').weapon2!.damage).toBe(14);
  });

  it('HERO-8: the pods are cocked up like mortars at rest, and the missiles climb in a steep arc', () => {
    expect(PALADIN_POD_TILT).toBeGreaterThan(0.8);
    expect(MISSILE_ARC).toBeGreaterThanOrEqual(0.5);
    const tree = rigTree(UNIT_RIGS.hum_paladin!());
    poseRig(tree, { turret: 0, kick: 0, lunge: 0, pitch: 0, roll: 0, bob: 0, phase: 0, stride: 0, dist: 0, turnRate: 0, time: 0, reach: 0, walker: true, pod: 0 });
    for (const p of tree.anims.filter((x) => x.anim.k === 'pod')) expect(p.obj.rotation.z).toBeGreaterThan(0.8);
  });

  it('HERO-8: the unit sheet and the main-menu preview draw the same rig, pods included, and fire the salvo', () => {
    const src = readFileSync('src/render3d/preview3d.ts', 'utf8');
    expect(src).toContain('fireMissiles');
    expect(src).toContain('podOpen');
  });
});

describe('Hero crush radius (BAL-16)', () => {
  const crushedAt = (dy: number): boolean => {
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 10, ty: 20 },
      { owner: 1, kind: 'ali_brute', tx: 30, ty: 30 },
    ]);
    const h = g.state.units.find((u) => u.kind === 'hum_paladin')!;
    const v = g.state.units.find((u) => u.kind === 'ali_brute')!;
    h.facing = 0;
    v.x = h.x + 2 * FP;
    v.y = h.y + dy;
    submit(g, { type: 'move', player: 0, units: [h.id], x: at(30), y: at(20) });
    for (let i = 0; i < 120; i++) tick(g);
    return !g.state.units.some((u) => u.id === v.id);
  };
  it('BAL-16: a Paladin crushes a unit 0.9 tiles beside its path (it did not at 0.7), but not one 2 tiles beside', () => {
    expect(unitDef('hum_paladin').crushRadius).toBe(256);
    expect(unitDef('hum_paladin').radius).toBeLessThan(0.9 * FP);
    expect(crushedAt(Math.round(0.9 * FP))).toBe(true);
    expect(crushedAt(2 * FP)).toBe(false);
  });
  it('BAL-16: a Bulwark Tank still crushes only within its body', () => {
    expect(unitDef('hum_tank').crushRadius).toBeUndefined();
  });
});

describe('Stop and scatter (CTL-17, CTL-18)', () => {
  it('CTL-18: scatter sends each unit away from the group centre', () => {
    const g = game([0, 1, 2, 3].map((i) => ({ owner: 0, kind: 'hum_rifleman', tx: 18 + (i % 2), ty: 18 + Math.floor(i / 2) })));
    const ids = g.state.units.map((u) => u.id);
    const cx = g.state.units.reduce((a, u) => a + u.x, 0) / ids.length;
    const cy = g.state.units.reduce((a, u) => a + u.y, 0) / ids.length;
    const before = g.state.units.map((u) => Math.hypot(u.x - cx, u.y - cy));
    submit(g, { type: 'scatter', player: 0, units: ids });
    for (let i = 0; i < 300; i++) tick(g);
    g.state.units.forEach((u, i) => expect(Math.hypot(u.x - cx, u.y - cy)).toBeGreaterThan(before[i]! + 2 * FP));
  });
  it('CTL-18: scatter is deterministic, and units stacked on one point still go different ways', () => {
    const mk = (): Game => game([0, 1, 2].map(() => ({ owner: 0, kind: 'hum_rifleman', tx: 20, ty: 20 })));
    const a = mk();
    const b = mk();
    for (const g of [a, b]) {
      submit(g, { type: 'scatter', player: 0, units: g.state.units.map((u) => u.id) });
      for (let i = 0; i < 150; i++) tick(g);
    }
    expect(a.state.units.map((u) => [u.x, u.y])).toEqual(b.state.units.map((u) => [u.x, u.y]));
    expect(new Set(a.state.units.map((u) => `${u.x},${u.y}`)).size).toBeGreaterThan(1);
  });
  it('CTL-18: a player cannot scatter the enemy, and the network layer keeps the sender seat', () => {
    expect(sanitizeCommand({ type: 'scatter', units: [1, 2], player: 5 }, 1)).toEqual({ type: 'scatter', player: 1, units: [1, 2] });
    expect(sanitizeCommand({ type: 'scatter', units: 'x' }, 1)).toBeNull();
    const g = game([
      { owner: 0, kind: 'hum_rifleman', tx: 20, ty: 20 },
      { owner: 1, kind: 'ali_skitter', tx: 5, ty: 5 },
    ]);
    const theirs = g.state.units.find((u) => u.owner === 1)!;
    submit(g, { type: 'scatter', player: 0, units: [theirs.id] });
    tick(g);
    expect(theirs.path.length).toBe(0);
  });
  it('CTL-17 CTL-18: Z stops and X scatters in the game input; both acknowledge without a marker', () => {
    const src = readFileSync('src/game.ts', 'utf8');
    expect(src).toMatch(/k === 'z'\) \{\s+if \(selection\.selected\.length > 0\) give\(\{ type: 'stop'/);
    expect(src).toMatch(/k === 'x'\) \{\s+if \(selection\.selected\.length > 0\) give\(\{ type: 'scatter'/);
    expect(acknowledge({ type: 'scatter', player: 0, units: [1] }, 0, 0)).toMatchObject({ color: null, sound: 'order', units: [1] });
  });
});
