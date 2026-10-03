import { describe, expect, it } from 'vitest';
import {
  BASE_STATS,
  blockStaminaCost,
  blockedDamage,
  canLevel,
  damageMultiplier,
  level,
  levelCost,
  maxHp,
  maxStamina,
} from '../src/systems/Stats';

describe('progression', () => {
  it('starts at level 1 with base stats', () => {
    expect(level(BASE_STATS)).toBe(1);
    expect(maxHp(10)).toBe(220);
    expect(maxStamina(10)).toBe(100);
    expect(damageMultiplier(10)).toBe(1);
  });

  it('has monotonically increasing, soft-capped growth', () => {
    for (let v = 10; v < 40; v++) {
      expect(maxHp(v + 1)).toBeGreaterThan(maxHp(v));
      expect(maxStamina(v + 1)).toBeGreaterThan(maxStamina(v));
      expect(damageMultiplier(v + 1)).toBeGreaterThan(damageMultiplier(v));
    }
    // Gains per point shrink after the soft cap at 25.
    expect(maxHp(26) - maxHp(25)).toBeLessThan(maxHp(25) - maxHp(24));
  });

  it('level costs rise with level', () => {
    for (let l = 1; l < 50; l++) expect(levelCost(l + 1)).toBeGreaterThan(levelCost(l));
  });

  it('only allows levelling with enough souls and below the cap', () => {
    const s = { ...BASE_STATS };
    expect(canLevel(s, 'vigor', levelCost(1) - 1)).toBe(false);
    expect(canLevel(s, 'vigor', levelCost(1))).toBe(true);
    expect(canLevel({ ...s, vigor: 40 }, 'vigor', 1e9)).toBe(false);
  });
});

describe('blocking', () => {
  it('reduces damage by the shield absorption', () => {
    expect(blockedDamage(100, 1)).toBe(0);
    expect(blockedDamage(100, 0.6)).toBe(40);
  });

  it('drains more stamina from heavy blows', () => {
    expect(blockStaminaCost(40, true)).toBeGreaterThan(blockStaminaCost(40, false));
  });
});
