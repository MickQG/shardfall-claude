import { describe, expect, it } from 'vitest';
import { unitDef } from '../../src/data/defs';
import { AURA_RING, MEND_RING, selectedRings } from '../../src/render/rings';
import { auraBonus, createGame, FP, submit, tick, unitDamage, type Game, type MapDef, type UnitSpawn } from '../../src/sim';
import type { Unit } from '../../src/sim/state';
import { auraOf, unitCards } from '../../src/ui/unitInfo';
import { factsHtml } from '../../src/ui/unitSheet';

const open = (w: number, h: number): MapDef => ({ width: w, height: h, heights: new Array<number>(w * h).fill(0) });
const game = (units: UnitSpawn[], map = open(40, 30)): Game => createGame({ seed: 5, map, units });
const byKind = (g: Game, kind: string, owner = 0): Unit => g.state.units.find((u) => u.kind === kind && u.owner === owner)!;
/** A target that stands still, never fights back and does not die. */
const bag = (u: Unit): Unit => {
  u.hp = 1_000_000;
  u.auto = false;
  u.mode = 'move';
  return u;
};

describe('BAL-17: artillery reaches further than it sees', () => {
  it('BAL-17: Hammer Artillery range 13 and Lobber range 12, both with vision 8', () => {
    expect(unitDef('hum_artillery').weapon!.range).toBe(13);
    expect(unitDef('ali_lobber').weapon!.range).toBe(12);
    expect(unitDef('hum_artillery').vision).toBe(8);
    expect(unitDef('ali_lobber').vision).toBe(8);
  });

  it('BAL-17: it hits a target 12 tiles off only while another unit of its owner sees it', () => {
    const play = (spotter: boolean): number => {
      const g = game([
        { owner: 0, kind: 'hum_artillery', tx: 5, ty: 10 },
        ...(spotter ? [{ owner: 0, kind: 'hum_rifleman', tx: 15, ty: 10 }] : []),
        { owner: 1, kind: 'ali_gorger', tx: 17, ty: 10 },
      ]);
      bag(byKind(g, 'ali_gorger', 1));
      if (spotter) byKind(g, 'hum_rifleman').mode = 'move'; // it only watches
      let shots = 0;
      for (let i = 0; i < 300; i++) {
        tick(g);
        shots += g.state.events.filter((e) => e.t === 'shot' && e.owner === 0 && e.src === byKind(g, 'hum_artillery').id).length;
      }
      return shots;
    };
    expect(play(false)).toBe(0);
    expect(play(true)).toBeGreaterThan(0);
  });
});

describe('HERO-9: a hero leads', () => {
  it('HERO-9: both heroes have a 5-tile aura of +10% firepower; no other unit has one', () => {
    for (const k of ['hum_paladin', 'ali_strider']) expect(unitDef(k).aura).toEqual({ range: 5, pct: 10 });
    for (const k of ['hum_tank', 'ali_brute', 'hum_mender', 'ali_skimmer']) expect(unitDef(k).aura).toBeUndefined();
  });

  it('HERO-9: an own unit within 5 tiles of a living hero gets the bonus; outside, the hero itself, an enemy or a dead hero gets none', () => {
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 10, ty: 10 },
      { owner: 1, kind: 'ali_brute', tx: 12, ty: 10 },
    ]);
    const s = g.state;
    const hero = byKind(g, 'hum_paladin');
    const at = (tx: number, ty: number): [number, number] => [tx * FP + FP / 2, ty * FP + FP / 2];
    expect(auraBonus(s, 0, ...at(13, 13), 999)).toBe(10); // about 4.2 tiles
    expect(auraBonus(s, 0, ...at(15, 10), 999)).toBe(10); // exactly 5
    expect(auraBonus(s, 0, ...at(16, 10), 999)).toBe(0);
    expect(auraBonus(s, 0, hero.x, hero.y, hero.id)).toBe(0);
    expect(auraBonus(s, 1, ...at(12, 10), 999)).toBe(0);
    hero.hp = 0;
    expect(auraBonus(s, 0, ...at(12, 10), 999)).toBe(0);
  });

  it('HERO-9: a tank near its hero fires shells carrying 10% more damage, rounded down, than one far from it', () => {
    /** The damage the tank's first shell carries, with the hero standing at (hx, hy). */
    const shell = (hx: number, hy: number): number => {
      const g = game([
        { owner: 0, kind: 'hum_paladin', tx: hx, ty: hy },
        { owner: 0, kind: 'hum_tank', tx: 10, ty: 10 },
        { owner: 1, kind: 'ali_gorger', tx: 14, ty: 10 },
      ]);
      const t = bag(byKind(g, 'ali_gorger', 1));
      const tank = byKind(g, 'hum_tank');
      submit(g, { type: 'attack', player: 0, units: [tank.id], target: t.id });
      for (let i = 0; i < 200; i++) {
        tick(g);
        const p = g.state.projectiles.find((q) => q.shooter === tank.id);
        if (p) return p.damage;
      }
      return 0;
    };
    const base = unitDamage('hum_tank', unitDef('hum_tank').hp, 0);
    expect(shell(36, 25)).toBe(base);
    expect(shell(7, 10)).toBe(Math.floor((base * 110) / 100));
    expect(Math.floor((base * 110) / 100)).toBeGreaterThan(base);
  });

  it('HERO-9: the bonus is measured where the shot leaves, so a passenger firing from a Field Mender beside the hero gets it', () => {
    const g = game([
      { owner: 0, kind: 'hum_paladin', tx: 8, ty: 12 },
      { owner: 0, kind: 'hum_mender', tx: 8, ty: 10 },
    ]);
    const m = byKind(g, 'hum_mender');
    expect(auraBonus(g.state, 0, m.x, m.y, 12345)).toBe(10);
  });

  it('HERO-9: selecting a hero shows a gold ring at its aura range; a Mender keeps its repair ring', () => {
    expect(selectedRings('hum_paladin')).toEqual([{ range: 5, color: AURA_RING }]);
    expect(selectedRings('ali_strider')).toEqual([{ range: 5, color: AURA_RING }]);
    expect(selectedRings('hum_mender')).toEqual([{ range: 3, color: MEND_RING }]);
    expect(selectedRings('hum_tank')).toEqual([]);
  });

  it('HERO-9: the unit sheet names the aura for heroes only', () => {
    expect(auraOf(unitDef('hum_paladin'))).toBe('Boosts the firepower of friendly units within 5 tiles by 10%');
    const paladin = unitCards('human').find((c) => c.kind === 'hum_paladin')!;
    expect(factsHtml(paladin)).toContain('<b>Aura:</b> Boosts the firepower of friendly units within 5 tiles by 10%');
    const tank = unitCards('human').find((c) => c.kind === 'hum_tank')!;
    expect(tank.aura).toBeNull();
    expect(factsHtml(tank)).not.toContain('Aura:');
  });
});
