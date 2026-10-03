/** Character progression math (pure, unit-tested). */

export interface PlayerStats {
  vigor: number;
  endurance: number;
  strength: number;
}

export const BASE_STATS: PlayerStats = { vigor: 10, endurance: 10, strength: 10 };
export const STAT_CAP = 40;

export function level(s: PlayerStats): number {
  return 1 + (s.vigor - 10) + (s.endurance - 10) + (s.strength - 10);
}

export function maxHp(vigor: number): number {
  // Strong gains until 25, softer afterwards.
  const a = Math.min(vigor, 25) - 10;
  const b = Math.max(0, vigor - 25);
  return Math.round(220 + a * 22 + b * 9);
}

export function maxStamina(endurance: number): number {
  const a = Math.min(endurance, 25) - 10;
  const b = Math.max(0, endurance - 25);
  return Math.round(100 + a * 4.5 + b * 1.5);
}

export function damageMultiplier(strength: number): number {
  const a = Math.min(strength, 25) - 10;
  const b = Math.max(0, strength - 25);
  return 1 + a * 0.045 + b * 0.015;
}

/** Souls required to go from `lvl` to `lvl + 1`. */
export function levelCost(lvl: number): number {
  return Math.round(180 + 45 * lvl + 4.2 * lvl * lvl);
}

export function canLevel(s: PlayerStats, stat: keyof PlayerStats, souls: number): boolean {
  return s[stat] < STAT_CAP && souls >= levelCost(level(s));
}

/** Damage after blocking. `reduction` 0..1 is the shield's physical absorption. */
export function blockedDamage(dmg: number, reduction: number): number {
  return Math.max(0, Math.round(dmg * (1 - reduction)));
}

/** Stamina drained from the defender when blocking a hit. */
export function blockStaminaCost(dmg: number, heavy: boolean): number {
  return Math.round(dmg * (heavy ? 1.15 : 0.85) + 6);
}

export const RIPOSTE_MULTIPLIER = 4.2;
export const BACKSTAB_MULTIPLIER = 3.4;
