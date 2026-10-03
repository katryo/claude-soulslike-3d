import type { Keyframe, Pose } from '../anim/Pose';
import { BRUTE_GUARD, GUARD } from '../anim/Animations';

export interface AoE {
  at: number; // time in clip
  radius: number;
  forward: number; // centre offset along facing (in world units, pre-scale)
  damage: number;
  poise: number;
  fire?: boolean;
}

export interface AttackDef {
  id: string;
  clip: Keyframe[];
  duration: number;
  hitStart: number;
  hitEnd: number;
  damage: number;
  poise: number;
  stamina: number;
  /** Reach from the attacker's centre, before rig scale. */
  range: number;
  /** Half-angle of the swing arc in radians. */
  arc: number;
  /** Forward root motion segments: [start, end, speed]. */
  lunge?: [number, number, number][];
  /** Rotation speed toward the target before hitStart (rad/s). */
  track?: number;
  /** Next attack in a chain when input is buffered (player) or chosen (AI). */
  next?: string;
  /** Time from which the next chained attack may begin. */
  chainAt?: number;
  /** Time from which a roll may cancel recovery. */
  cancelAt?: number;
  hyperArmor?: boolean;
  parryable?: boolean;
  heavy?: boolean;
  aoe?: AoE[];
  /** Multi-hit: reset the hit set at these times. */
  rehit?: number[];
  sfxAt?: number[];
  fire?: boolean;
  /** Weapon trail colour hint. */
  trail?: number;
}

const P = (base: Pose, over: Pose): Pose => ({ ...base, ...over });

// ---------------------------------------------------------------------------
// Player — straight sword & shield
// ---------------------------------------------------------------------------

const pSlashWind = P(GUARD, {
  spine: [0, -0.1, 0],
  chest: [0, -0.75, 0],
  rShoulder: [-2.5, 0, -0.55],
  rElbow: [-1.1, 0, 0],
  rWrist: [0.1, 0, 0],
  lShoulder: [-0.3, -1.1, 0.4],
});
const pSlashEnd = P(GUARD, {
  root: [0, -0.12, 0.12],
  spine: [0.2, 0.1, 0],
  chest: [0.15, 0.75, 0],
  rShoulder: [-0.7, 0, 0.55],
  rElbow: [-0.25, 0, 0],
  rWrist: [0.4, 0, 0],
  lShoulder: [0.1, -1.0, 0.5],
  lHip: [-0.6, 0, 0.05],
  lKnee: [0.6, 0, 0],
  rHip: [0.35, 0, -0.05],
  rKnee: [0.35, 0, 0],
});

const pBackWind = P(GUARD, {
  chest: [0, 0.85, 0],
  rShoulder: [-1.45, 0, 0.7],
  rElbow: [-1.5, 0, 0],
  rWrist: [0.2, 1.4, 0],
  lShoulder: [-0.1, -1.0, 0.5],
});
const pBackEnd = P(GUARD, {
  root: [0, -0.12, 0.1],
  spine: [0.15, -0.1, 0],
  chest: [0.1, -0.85, 0],
  rShoulder: [-1.35, 0, -0.9],
  rElbow: [-0.15, 0, 0],
  rWrist: [0.2, 1.4, 0],
  lShoulder: [-0.4, -1.2, 0.3],
  rHip: [-0.5, 0, -0.05],
  rKnee: [0.6, 0, 0],
  lHip: [0.3, 0, 0.05],
  lKnee: [0.35, 0, 0],
});

const pOverWind = P(GUARD, {
  root: [0, 0.02, -0.05],
  spine: [-0.2, 0, 0],
  chest: [-0.15, -0.2, 0],
  rShoulder: [-2.9, 0, -0.15],
  rElbow: [-1.3, 0, 0],
  rWrist: [0.0, 0, 0],
});
const pOverEnd = P(GUARD, {
  root: [0, -0.22, 0.18],
  spine: [0.45, 0, 0],
  chest: [0.25, 0.1, 0],
  head: [-0.2, 0, 0],
  rShoulder: [-0.75, 0, 0.05],
  rElbow: [-0.1, 0, 0],
  rWrist: [0.7, 0, 0],
  lHip: [-0.8, 0, 0.05],
  lKnee: [0.8, 0, 0],
  rHip: [0.4, 0, -0.05],
  rKnee: [0.4, 0, 0],
});

const pHeavyWind = P(GUARD, {
  root: [0, -0.05, -0.1],
  spine: [-0.3, 0, 0],
  chest: [-0.2, -0.35, 0],
  head: [0.2, 0, 0],
  rShoulder: [-3.1, 0, 0.1],
  rElbow: [-1.6, 0, 0],
  rWrist: [-0.3, 0, 0],
  lShoulder: [-2.6, 0, -0.3],
  lElbow: [-1.4, 0, 0],
  rHip: [0.3, 0, 0],
  rKnee: [0.5, 0, 0],
});
const pHeavyEnd = P(GUARD, {
  root: [0, -0.32, 0.25],
  spine: [0.55, 0, 0],
  chest: [0.3, 0, 0],
  head: [-0.3, 0, 0],
  rShoulder: [-0.6, 0, 0.2],
  rElbow: [-0.1, 0, 0],
  rWrist: [0.9, 0, 0],
  lShoulder: [-0.5, 0, -0.3],
  lElbow: [-0.4, 0, 0],
  lHip: [-1.0, 0, 0.05],
  lKnee: [1.0, 0, 0],
  rHip: [0.5, 0, -0.05],
  rKnee: [0.5, 0, 0],
});

const pThrustWind = P(GUARD, {
  root: [0, -0.08, -0.08],
  chest: [0, -0.5, 0],
  rShoulder: [-0.6, 0, -0.5],
  rElbow: [-1.9, 0, 0],
  rWrist: [1.57, 0, 0],
});
const pThrustEnd = P(GUARD, {
  root: [0, -0.2, 0.25],
  spine: [0.25, 0, 0],
  chest: [0.1, 0.35, 0],
  rShoulder: [-1.5, 0, 0.1],
  rElbow: [-0.05, 0, 0],
  rWrist: [1.57, 0, 0],
  lShoulder: [0.3, -1.0, 0.4],
  lHip: [-0.9, 0, 0.05],
  lKnee: [0.9, 0, 0],
  rHip: [0.5, 0, -0.05],
  rKnee: [0.3, 0, 0],
});

export const PLAYER_ATTACKS: Record<string, AttackDef> = {
  light1: {
    id: 'light1',
    clip: [
      { t: 0, pose: GUARD },
      { t: 0.17, pose: pSlashWind },
      { t: 0.3, pose: pSlashEnd, ease: 'out' },
      { t: 0.5, pose: pSlashEnd },
      { t: 0.75, pose: GUARD },
    ],
    duration: 0.75,
    hitStart: 0.18,
    hitEnd: 0.3,
    damage: 22,
    poise: 22,
    stamina: 16,
    range: 2.2,
    arc: 1.1,
    lunge: [[0.14, 0.3, 3.2]],
    track: 6,
    next: 'light2',
    chainAt: 0.42,
    cancelAt: 0.4,
    parryable: true,
    sfxAt: [0.18],
  },
  light2: {
    id: 'light2',
    clip: [
      { t: 0, pose: pSlashEnd },
      { t: 0.15, pose: pBackWind },
      { t: 0.3, pose: pBackEnd, ease: 'out' },
      { t: 0.5, pose: pBackEnd },
      { t: 0.75, pose: GUARD },
    ],
    duration: 0.75,
    hitStart: 0.17,
    hitEnd: 0.3,
    damage: 24,
    poise: 22,
    stamina: 16,
    range: 2.2,
    arc: 1.2,
    lunge: [[0.12, 0.3, 3]],
    track: 6,
    next: 'light3',
    chainAt: 0.44,
    cancelAt: 0.4,
    parryable: true,
    sfxAt: [0.17],
  },
  light3: {
    id: 'light3',
    clip: [
      { t: 0, pose: pBackEnd },
      { t: 0.25, pose: pOverWind },
      { t: 0.4, pose: pOverEnd, ease: 'in' },
      { t: 0.65, pose: pOverEnd },
      { t: 0.95, pose: GUARD },
    ],
    duration: 0.95,
    hitStart: 0.28,
    hitEnd: 0.41,
    damage: 32,
    poise: 35,
    stamina: 20,
    range: 2.3,
    arc: 0.6,
    lunge: [[0.2, 0.4, 3.5]],
    track: 5,
    next: 'light1',
    chainAt: 0.62,
    cancelAt: 0.55,
    parryable: true,
    sfxAt: [0.28],
  },
  heavy: {
    id: 'heavy',
    clip: [
      { t: 0, pose: GUARD },
      { t: 0.45, pose: pHeavyWind },
      { t: 0.62, pose: pHeavyEnd, ease: 'in' },
      { t: 0.95, pose: pHeavyEnd },
      { t: 1.3, pose: GUARD },
    ],
    duration: 1.3,
    hitStart: 0.5,
    hitEnd: 0.64,
    damage: 48,
    poise: 70,
    stamina: 32,
    range: 2.4,
    arc: 0.6,
    lunge: [[0.42, 0.62, 4.5]],
    track: 4,
    cancelAt: 0.9,
    heavy: true,
    parryable: true,
    sfxAt: [0.48],
  },
  sprintAttack: {
    id: 'sprintAttack',
    clip: [
      { t: 0, pose: pThrustWind },
      { t: 0.22, pose: pThrustEnd, ease: 'out' },
      { t: 0.55, pose: pThrustEnd },
      { t: 0.85, pose: GUARD },
    ],
    duration: 0.85,
    hitStart: 0.1,
    hitEnd: 0.25,
    damage: 30,
    poise: 30,
    stamina: 20,
    range: 2.6,
    arc: 0.5,
    lunge: [[0, 0.3, 7]],
    track: 3,
    cancelAt: 0.55,
    parryable: true,
    sfxAt: [0.08],
  },
  rollAttack: {
    id: 'rollAttack',
    clip: [
      { t: 0, pose: pBackWind },
      { t: 0.2, pose: pBackEnd, ease: 'out' },
      { t: 0.45, pose: pBackEnd },
      { t: 0.7, pose: GUARD },
    ],
    duration: 0.7,
    hitStart: 0.06,
    hitEnd: 0.2,
    damage: 20,
    poise: 18,
    stamina: 14,
    range: 2.2,
    arc: 1.2,
    lunge: [[0, 0.2, 3]],
    track: 8,
    next: 'light2',
    chainAt: 0.36,
    cancelAt: 0.4,
    parryable: true,
    sfxAt: [0.05],
  },
  riposte: {
    id: 'riposte',
    clip: [
      { t: 0, pose: GUARD },
      { t: 0.22, pose: pThrustWind },
      { t: 0.36, pose: pThrustEnd, ease: 'out' },
      { t: 0.9, pose: pThrustEnd },
      { t: 1.05, pose: P(pThrustEnd, { rShoulder: [-1.1, 0, -0.3], rElbow: [-1.2, 0, 0], chest: [0.1, -0.4, 0] }) },
      { t: 1.5, pose: GUARD },
    ],
    duration: 1.5,
    hitStart: 0.34,
    hitEnd: 0.4,
    damage: 0, // computed as a critical
    poise: 999,
    stamina: 0,
    range: 3.0,
    arc: 1.4,
    hyperArmor: true,
    sfxAt: [0.3],
  },
};

// ---------------------------------------------------------------------------
// Hollow soldier — sword, aggressive, light
// ---------------------------------------------------------------------------

export const HOLLOW_ATTACKS: Record<string, AttackDef> = {
  slash: {
    id: 'slash',
    clip: [
      { t: 0, pose: GUARD },
      { t: 0.5, pose: P(pSlashWind, { root: [0, -0.06, -0.08], spine: [-0.15, -0.1, 0] }) },
      { t: 0.66, pose: pSlashEnd, ease: 'out' },
      { t: 1.0, pose: pSlashEnd },
      { t: 1.35, pose: GUARD },
    ],
    duration: 1.35,
    hitStart: 0.52,
    hitEnd: 0.67,
    damage: 18,
    poise: 30,
    stamina: 0,
    range: 2.2,
    arc: 1.0,
    lunge: [[0.48, 0.66, 3]],
    track: 3.5,
    next: 'backhand',
    chainAt: 0.85,
    parryable: true,
    sfxAt: [0.52],
  },
  backhand: {
    id: 'backhand',
    clip: [
      { t: 0, pose: pSlashEnd },
      { t: 0.3, pose: pBackWind },
      { t: 0.46, pose: pBackEnd, ease: 'out' },
      { t: 0.8, pose: pBackEnd },
      { t: 1.15, pose: GUARD },
    ],
    duration: 1.15,
    hitStart: 0.32,
    hitEnd: 0.47,
    damage: 18,
    poise: 30,
    stamina: 0,
    range: 2.2,
    arc: 1.1,
    lunge: [[0.28, 0.46, 3]],
    track: 2.5,
    parryable: true,
    sfxAt: [0.32],
  },
  lunge: {
    id: 'lunge',
    clip: [
      { t: 0, pose: GUARD },
      { t: 0.55, pose: pThrustWind },
      { t: 0.72, pose: pThrustEnd, ease: 'out' },
      { t: 1.1, pose: pThrustEnd },
      { t: 1.45, pose: GUARD },
    ],
    duration: 1.45,
    hitStart: 0.6,
    hitEnd: 0.75,
    damage: 22,
    poise: 35,
    stamina: 0,
    range: 2.6,
    arc: 0.5,
    lunge: [[0.55, 0.75, 9]],
    track: 4,
    parryable: true,
    sfxAt: [0.58],
  },
};

// ---------------------------------------------------------------------------
// Brute — spiked club, slow, hyper armor
// ---------------------------------------------------------------------------

const bSmashWind = P(BRUTE_GUARD, {
  root: [0, 0.0, -0.1],
  spine: [-0.3, 0, 0],
  chest: [-0.25, 0, 0],
  rShoulder: [-3.0, 0, 0.15],
  rElbow: [-1.4, 0, 0],
  rWrist: [-0.2, 0, 0],
  lShoulder: [-2.7, 0, -0.3],
  lElbow: [-1.5, 0, 0],
});
const bSmashEnd = P(BRUTE_GUARD, {
  root: [0, -0.35, 0.2],
  spine: [0.6, 0, 0],
  chest: [0.35, 0, 0],
  rShoulder: [-0.7, 0, 0.25],
  rElbow: [-0.1, 0, 0],
  rWrist: [0.9, 0, 0],
  lShoulder: [-0.6, 0, -0.35],
  lElbow: [-0.4, 0, 0],
  lHip: [-0.9, 0, 0.1],
  lKnee: [1.0, 0, 0],
  rHip: [0.5, 0, -0.1],
  rKnee: [0.6, 0, 0],
});
const bSweepWind = P(BRUTE_GUARD, {
  chest: [0, -1.1, 0],
  spine: [0, -0.3, 0],
  rShoulder: [-1.3, 0, -1.2],
  rElbow: [-0.5, 0, 0],
  rWrist: [0.3, 1.5, 0],
  lShoulder: [-1.2, 0, -0.6],
  lElbow: [-1.2, 0, 0],
});
const bSweepEnd = P(BRUTE_GUARD, {
  root: [0, -0.15, 0.1],
  chest: [0.1, 1.1, 0],
  spine: [0.1, 0.3, 0],
  rShoulder: [-1.3, 0, 0.6],
  rElbow: [-0.2, 0, 0],
  rWrist: [0.3, 1.5, 0],
  lShoulder: [-0.4, 0, 0.6],
  lElbow: [-0.3, 0, 0],
  lHip: [-0.5, 0, 0.1],
  lKnee: [0.6, 0, 0],
});

export const BRUTE_ATTACKS: Record<string, AttackDef> = {
  smash: {
    id: 'smash',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.85, pose: bSmashWind },
      { t: 1.05, pose: bSmashEnd, ease: 'in' },
      { t: 1.6, pose: bSmashEnd },
      { t: 2.1, pose: BRUTE_GUARD },
    ],
    duration: 2.1,
    hitStart: 0.92,
    hitEnd: 1.07,
    damage: 42,
    poise: 80,
    stamina: 0,
    range: 2.6,
    arc: 0.55,
    lunge: [[0.85, 1.05, 2.5]],
    track: 2.2,
    hyperArmor: true,
    heavy: true,
    aoe: [{ at: 1.05, radius: 2.0, forward: 2.2, damage: 15, poise: 30 }],
    sfxAt: [0.9],
  },
  sweep: {
    id: 'sweep',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.75, pose: bSweepWind },
      { t: 0.98, pose: bSweepEnd, ease: 'out' },
      { t: 1.4, pose: bSweepEnd },
      { t: 1.9, pose: BRUTE_GUARD },
    ],
    duration: 1.9,
    hitStart: 0.8,
    hitEnd: 1.0,
    damage: 34,
    poise: 70,
    stamina: 0,
    range: 2.8,
    arc: 1.7,
    lunge: [[0.75, 0.98, 1.5]],
    track: 2.5,
    hyperArmor: true,
    heavy: true,
    sfxAt: [0.78],
  },
};

// ---------------------------------------------------------------------------
// Boss — the Ashen Warden, greataxe
// ---------------------------------------------------------------------------

const wCleaveWind = bSmashWind;
const wCleaveEnd = bSmashEnd;
const wSweepRWind = bSweepWind;
const wSweepREnd = bSweepEnd;
const wSweepLWind = P(BRUTE_GUARD, {
  chest: [0, 1.0, 0],
  spine: [0, 0.3, 0],
  rShoulder: [-1.5, 0, 0.7],
  rElbow: [-0.9, 0, 0],
  rWrist: [0.3, 1.5, 0],
  lShoulder: [-0.9, 0, 0.4],
  lElbow: [-1.2, 0, 0],
});
const wSweepLEnd = P(BRUTE_GUARD, {
  root: [0, -0.15, 0.1],
  chest: [0.1, -1.1, 0],
  spine: [0.1, -0.3, 0],
  rShoulder: [-1.3, 0, -1.1],
  rElbow: [-0.1, 0, 0],
  rWrist: [0.3, 1.5, 0],
  lShoulder: [-1.2, 0, -0.5],
  lElbow: [-0.9, 0, 0],
  rHip: [-0.5, 0, -0.1],
  rKnee: [0.6, 0, 0],
});
const wLeapAir = P(bSmashWind, {
  root: [0, 0.9, 0],
  lHip: [-1.2, 0, 0.1],
  lKnee: [1.6, 0, 0],
  rHip: [-0.3, 0, -0.1],
  rKnee: [1.4, 0, 0],
});
const wNovaCrouch = P(BRUTE_GUARD, {
  root: [0, -0.5, 0],
  spine: [0.7, 0, 0],
  chest: [0.3, 0, 0],
  head: [0.4, 0, 0],
  rShoulder: [-0.2, 0, -0.6],
  rElbow: [-0.3, 0, 0],
  lShoulder: [-0.2, 0, 0.6],
  lElbow: [-0.3, 0, 0],
  lHip: [-1.2, 0, 0.15],
  lKnee: [1.6, 0, 0],
  rHip: [-0.2, 0, -0.15],
  rKnee: [1.5, 0, 0],
});
const wNovaRelease = P(BRUTE_GUARD, {
  root: [0, 0.05, 0],
  spine: [-0.35, 0, 0],
  chest: [-0.3, 0, 0],
  head: [-0.5, 0, 0],
  rShoulder: [-0.4, 0, -1.5],
  rElbow: [-0.2, 0, 0],
  lShoulder: [-0.4, 0, 1.5],
  lElbow: [-0.2, 0, 0],
});

export const BOSS_ATTACKS: Record<string, AttackDef> = {
  cleave: {
    id: 'cleave',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.8, pose: wCleaveWind },
      { t: 1.0, pose: wCleaveEnd, ease: 'in' },
      { t: 1.6, pose: wCleaveEnd },
      { t: 2.0, pose: BRUTE_GUARD },
    ],
    duration: 2.0,
    hitStart: 0.88,
    hitEnd: 1.02,
    damage: 55,
    poise: 100,
    stamina: 0,
    range: 2.3,
    arc: 0.45,
    lunge: [[0.8, 1.0, 3]],
    track: 2.5,
    hyperArmor: true,
    heavy: true,
    aoe: [{ at: 1.0, radius: 1.5, forward: 2.4, damage: 25, poise: 50 }],
    sfxAt: [0.85],
  },
  delayedCleave: {
    id: 'delayedCleave',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.7, pose: wCleaveWind },
      { t: 1.55, pose: P(wCleaveWind, { root: [0, 0.03, -0.12], spine: [-0.38, 0, 0] }) },
      { t: 1.72, pose: wCleaveEnd, ease: 'in' },
      { t: 2.3, pose: wCleaveEnd },
      { t: 2.7, pose: BRUTE_GUARD },
    ],
    duration: 2.7,
    hitStart: 1.6,
    hitEnd: 1.74,
    damage: 60,
    poise: 100,
    stamina: 0,
    range: 2.3,
    arc: 0.45,
    lunge: [[1.5, 1.72, 3]],
    track: 2.0,
    hyperArmor: true,
    heavy: true,
    aoe: [{ at: 1.72, radius: 1.5, forward: 2.4, damage: 25, poise: 50 }],
    sfxAt: [1.58],
  },
  sweepR: {
    id: 'sweepR',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.65, pose: wSweepRWind },
      { t: 0.88, pose: wSweepREnd, ease: 'out' },
      { t: 1.25, pose: wSweepREnd },
      { t: 1.7, pose: BRUTE_GUARD },
    ],
    duration: 1.7,
    hitStart: 0.7,
    hitEnd: 0.9,
    damage: 45,
    poise: 80,
    stamina: 0,
    range: 2.4,
    arc: 1.9,
    lunge: [[0.62, 0.88, 2.5]],
    track: 3,
    hyperArmor: true,
    heavy: true,
    next: 'sweepL',
    chainAt: 1.0,
    sfxAt: [0.68],
  },
  sweepL: {
    id: 'sweepL',
    clip: [
      { t: 0, pose: wSweepREnd },
      { t: 0.4, pose: wSweepLWind },
      { t: 0.62, pose: wSweepLEnd, ease: 'out' },
      { t: 1.0, pose: wSweepLEnd },
      { t: 1.5, pose: BRUTE_GUARD },
    ],
    duration: 1.5,
    hitStart: 0.44,
    hitEnd: 0.64,
    damage: 45,
    poise: 80,
    stamina: 0,
    range: 2.4,
    arc: 1.9,
    lunge: [[0.4, 0.62, 3]],
    track: 2.5,
    hyperArmor: true,
    heavy: true,
    next: 'cleave',
    chainAt: 0.8,
    sfxAt: [0.42],
  },
  leap: {
    id: 'leap',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.45, pose: P(BRUTE_GUARD, { root: [0, -0.4, 0], lKnee: [1.2, 0, 0], rKnee: [1.2, 0, 0], lHip: [-0.8, 0, 0.1], rHip: [-0.6, 0, -0.1], spine: [0.4, 0, 0] }) },
      { t: 0.9, pose: wLeapAir, ease: 'out' },
      { t: 1.25, pose: wCleaveEnd, ease: 'in' },
      { t: 1.9, pose: wCleaveEnd },
      { t: 2.4, pose: BRUTE_GUARD },
    ],
    duration: 2.4,
    hitStart: 1.15,
    hitEnd: 1.27,
    damage: 60,
    poise: 120,
    stamina: 0,
    range: 2.2,
    arc: 0.7,
    lunge: [[0.5, 1.2, 10]],
    track: 3.5,
    hyperArmor: true,
    heavy: true,
    aoe: [{ at: 1.25, radius: 2.6, forward: 2.0, damage: 30, poise: 60 }],
    sfxAt: [1.1],
  },
  nova: {
    id: 'nova',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.5, pose: wNovaCrouch },
      { t: 1.5, pose: P(wNovaCrouch, { root: [0, -0.55, 0], spine: [0.8, 0, 0] }) },
      { t: 1.65, pose: wNovaRelease, ease: 'out' },
      { t: 2.3, pose: wNovaRelease },
      { t: 2.8, pose: BRUTE_GUARD },
    ],
    duration: 2.8,
    hitStart: 99,
    hitEnd: 99,
    damage: 0,
    poise: 0,
    stamina: 0,
    range: 0,
    arc: 0,
    track: 1,
    hyperArmor: true,
    heavy: true,
    fire: true,
    aoe: [{ at: 1.62, radius: 3.4, forward: 0, damage: 50, poise: 120, fire: true }],
  },
  spin: {
    id: 'spin',
    clip: [
      { t: 0, pose: BRUTE_GUARD },
      { t: 0.6, pose: wSweepRWind },
      { t: 0.8, pose: P(wSweepREnd, { hips: [0, 1.6, 0] }), ease: 'linear' },
      { t: 1.0, pose: P(wSweepREnd, { hips: [0, 3.2, 0] }), ease: 'linear' },
      { t: 1.2, pose: P(wSweepREnd, { hips: [0, 4.8, 0] }), ease: 'linear' },
      { t: 1.4, pose: P(wSweepREnd, { hips: [0, 6.28, 0] }), ease: 'linear' },
      { t: 1.6, pose: P(wSweepREnd, { hips: [0, 7.85, 0] }), ease: 'linear' },
      { t: 1.8, pose: P(wSweepREnd, { hips: [0, 9.42, 0] }), ease: 'out' },
      { t: 2.3, pose: P(BRUTE_GUARD, { hips: [0, 12.566, 0] }) },
    ],
    duration: 2.3,
    hitStart: 0.65,
    hitEnd: 1.8,
    damage: 30,
    poise: 50,
    stamina: 0,
    range: 2.4,
    arc: Math.PI,
    lunge: [[0.6, 1.8, 3.2]],
    track: 2.0,
    hyperArmor: true,
    heavy: true,
    fire: true,
    rehit: [1.05, 1.45],
    sfxAt: [0.65, 1.0, 1.4],
  },
};
