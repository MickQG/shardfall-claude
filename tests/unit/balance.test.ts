import { describe, expect, it } from 'vitest';
import { mean, rounds, type Army } from './battle';

/** Average margin (human minus alien) over two army sizes, fought from both seats. */
const even = (human: Army, alien: Army): number => mean(rounds(human, alien), 'margin');

describe('faction balance', () => {
  const cases: [string, Army, Army][] = [
    ['rifle infantry', { hum_rifleman: 1 }, { ali_skitter: 1 }],
    ['scouts', { hum_buggy: 1 }, { ali_stalker: 1 }],
    ['anti-armour infantry', { hum_rocketeer: 1 }, { ali_spitter: 1 }],
    ['tanks', { hum_tank: 1 }, { ali_brute: 1 }],
    ['mixed army', { hum_tank: 3, hum_rocketeer: 4, hum_rifleman: 6 }, { ali_brute: 3, ali_spitter: 4, ali_skitter: 8 }],
  ];
  for (const [name, human, alien] of cases) {
    it(`ROS-3: equal-cost ${name} fights end within 20% of even`, () => {
      expect(Math.abs(even(human, alien))).toBeLessThan(20);
    }, 60_000);
  }
});
