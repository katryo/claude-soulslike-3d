import type { Keyframe, Pose } from './Pose';

/** Ready stance: sword raised, shield arm loosely in front. */
export const GUARD: Pose = {
  root: [0, -0.04, 0],
  spine: [0.06, 0, 0],
  chest: [0.04, 0.18, 0],
  neck: [0, -0.08, 0],
  head: [0, -0.1, 0],
  rShoulder: [-0.25, 0, -0.18],
  rElbow: [-1.05, 0, 0],
  rWrist: [0.45, 0, 0],
  lShoulder: [-0.25, -1.2, 0.22],
  lElbow: [-0.9, 0, 0],
  lHip: [-0.18, 0, 0.06],
  lKnee: [0.32, 0, 0],
  rHip: [0.12, 0, -0.06],
  rKnee: [0.28, 0, 0],
};

/** Shield raised in front of chest. */
export const BLOCK: Pose = {
  ...GUARD,
  root: [0, -0.1, 0],
  spine: [0.12, 0, 0],
  chest: [0.08, 0.25, 0],
  lShoulder: [-0.75, -1.45, 0.35],
  lElbow: [-1.45, 0, 0],
  rShoulder: [-0.1, 0, -0.3],
  rElbow: [-0.8, 0, 0],
  rWrist: [0.6, 0, 0],
  lHip: [-0.3, 0, 0.08],
  lKnee: [0.5, 0, 0],
  rHip: [0.2, 0, -0.08],
  rKnee: [0.4, 0, 0],
};

/** Heavy two-handed stance used by the boss and brutes. */
export const BRUTE_GUARD: Pose = {
  root: [0, -0.06, 0],
  spine: [0.1, 0, 0],
  chest: [0.08, 0.3, 0],
  head: [0, -0.2, 0],
  rShoulder: [-0.15, 0, -0.25],
  rElbow: [-0.7, 0, 0],
  rWrist: [0.3, 0, 0],
  lShoulder: [-0.5, 0, -0.1],
  lElbow: [-1.2, 0, 0],
  lHip: [-0.2, 0, 0.12],
  lKnee: [0.35, 0, 0],
  rHip: [0.15, 0, -0.12],
  rKnee: [0.3, 0, 0],
};

export interface LocoParams {
  phase: number; // radians, advances with distance travelled
  forward: number; // -1..1 local forward component of velocity (normalized by max)
  side: number; // -1..1 local strafe component
  speed: number; // 0..1 normalized
  sprint: number; // 0..1
}

/** Procedural walk / run / strafe cycle layered on a base stance. */
export function locomotion(base: Pose, p: LocoParams): Pose {
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);
  const amp = (0.45 + p.sprint * 0.35) * p.speed;
  const f = p.forward;
  const sd = p.side;
  const lift = (x: number) => Math.max(0, x);
  const out: Pose = { ...base };
  const b = (k: keyof Pose) => base[k] ?? [0, 0, 0];

  out.lHip = [b('lHip')[0] * (1 - p.speed) - s * amp * f, 0, b('lHip')[2] * (1 - p.speed) + s * amp * sd * 0.6];
  out.rHip = [b('rHip')[0] * (1 - p.speed) + s * amp * f, 0, b('rHip')[2] * (1 - p.speed) - s * amp * sd * 0.6];
  out.lKnee = [b('lKnee')[0] * (1 - p.speed) + (0.15 + lift(-c) * 1.1) * p.speed * (0.7 + p.sprint * 0.6), 0, 0];
  out.rKnee = [b('rKnee')[0] * (1 - p.speed) + (0.15 + lift(c) * 1.1) * p.speed * (0.7 + p.sprint * 0.6), 0, 0];
  const bob = -Math.abs(Math.cos(p.phase)) * 0.06 * p.speed - p.sprint * 0.04;
  const r = b('root');
  out.root = [r[0] + sd * 0.02 * s, r[1] + bob, r[2]];
  const sp = b('spine');
  out.spine = [sp[0] + p.sprint * 0.35 + p.speed * 0.05 * f, sp[1], sp[2]];
  const ch = b('chest');
  out.chest = [ch[0], ch[1] * (1 - p.sprint) + s * 0.12 * p.speed * f, ch[2]];
  const h = b('head');
  out.head = [h[0] - p.sprint * 0.3, h[1] * (1 - p.sprint), h[2]];

  if (p.sprint > 0) {
    // Arms pump while sprinting, weapon held low.
    const k = p.sprint;
    const rs = b('rShoulder'), ls = b('lShoulder');
    out.rShoulder = [rs[0] * (1 - k) + (-s * 0.7 + 0.2) * k, rs[1] * (1 - k), rs[2] * (1 - k) - 0.15 * k];
    out.lShoulder = [ls[0] * (1 - k) + (s * 0.7 + 0.2) * k, ls[1] * (1 - k), ls[2] * (1 - k) + 0.15 * k];
    const re = b('rElbow'), le = b('lElbow');
    out.rElbow = [re[0] * (1 - k) - 1.2 * k, 0, 0];
    out.lElbow = [le[0] * (1 - k) - 1.2 * k, 0, 0];
    const rw = b('rWrist');
    out.rWrist = [rw[0] * (1 - k) + 1.3 * k, 0, 0];
  } else {
    const rs = b('rShoulder');
    out.rShoulder = [rs[0] - s * 0.12 * p.speed * f, rs[1], rs[2]];
  }
  return out;
}

/** Breathing idle overlay. */
export function breathe(base: Pose, t: number, amount = 1): Pose {
  const k = Math.sin(t * 1.8) * 0.025 * amount;
  const ch = base.chest ?? [0, 0, 0];
  const r = base.root ?? [0, 0, 0];
  return { ...base, chest: [ch[0] + k, ch[1], ch[2]], root: [r[0], r[1] + k * 0.4, r[2]] };
}

const TAU = Math.PI * 2;

export const ROLL_DURATION = 0.72;
export const ROLL_CLIP: Keyframe[] = [
  { t: 0, pose: { ...GUARD } },
  {
    t: 0.1,
    pose: {
      root: [0, -0.35, 0.1],
      hips: [0.6, 0, 0],
      spine: [0.5, 0, 0],
      chest: [0.4, 0, 0],
      head: [0.4, 0, 0],
      lShoulder: [-1.2, 0, 0.3],
      rShoulder: [-1.2, 0, -0.3],
      lElbow: [-1.6, 0, 0],
      rElbow: [-1.6, 0, 0],
      rWrist: [1.3, 0, 0],
      lHip: [-1.2, 0, 0.1],
      rHip: [-0.5, 0, -0.1],
      lKnee: [1.6, 0, 0],
      rKnee: [1.3, 0, 0],
    },
  },
  {
    t: 0.38,
    ease: 'linear',
    pose: {
      root: [0, -0.3, 0],
      hips: [Math.PI, 0, 0],
      spine: [1.0, 0, 0],
      chest: [0.8, 0, 0],
      head: [0.7, 0, 0],
      lShoulder: [-1.4, 0, 0.3],
      rShoulder: [-1.4, 0, -0.3],
      lElbow: [-1.8, 0, 0],
      rElbow: [-1.8, 0, 0],
      rWrist: [1.3, 0, 0],
      lHip: [-2.0, 0, 0.1],
      rHip: [-2.0, 0, -0.1],
      lKnee: [2.3, 0, 0],
      rKnee: [2.3, 0, 0],
    },
  },
  {
    t: 0.56,
    ease: 'out',
    pose: {
      root: [0, -0.45, 0],
      hips: [TAU, 0, 0],
      spine: [0.4, 0, 0],
      chest: [0.3, 0, 0],
      head: [0.2, 0, 0],
      lShoulder: [-0.6, 0, 0.3],
      rShoulder: [-0.6, 0, -0.3],
      lElbow: [-1.4, 0, 0],
      rElbow: [-1.4, 0, 0],
      rWrist: [1.0, 0, 0],
      lHip: [-1.4, 0, 0.1],
      rHip: [-0.4, 0, -0.1],
      lKnee: [1.6, 0, 0],
      rKnee: [1.0, 0, 0],
    },
  },
  { t: ROLL_DURATION, pose: { ...GUARD, hips: [TAU, 0, 0] } },
];

export const BACKSTEP_DURATION = 0.5;
export const BACKSTEP_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  {
    t: 0.15,
    pose: { ...GUARD, root: [0, 0.05, 0], spine: [-0.2, 0, 0], lHip: [0.4, 0, 0.05], rHip: [0.5, 0, -0.05], lKnee: [0.6, 0, 0], rKnee: [0.8, 0, 0] },
  },
  { t: 0.35, pose: { ...GUARD, root: [0, -0.12, 0], lHip: [-0.4, 0, 0.1], lKnee: [0.6, 0, 0], rHip: [0.3, 0, 0], rKnee: [0.6, 0, 0] } },
  { t: BACKSTEP_DURATION, pose: GUARD },
];

export const STAGGER_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  {
    t: 0.08,
    ease: 'out',
    pose: {
      ...GUARD,
      root: [0, -0.05, -0.1],
      spine: [-0.35, 0, 0.1],
      chest: [-0.25, -0.3, 0],
      head: [-0.4, 0.2, 0],
      rShoulder: [0.3, 0, -0.6],
      rElbow: [-0.4, 0, 0],
      lShoulder: [0.2, 0, 0.6],
      lElbow: [-0.3, 0, 0],
      lHip: [-0.3, 0, 0.1],
      lKnee: [0.4, 0, 0],
      rHip: [0.35, 0, 0],
      rKnee: [0.5, 0, 0],
    },
  },
  { t: 0.3, pose: { ...GUARD, root: [0, -0.15, 0], spine: [0.15, 0, 0], head: [0.2, 0, 0], rHip: [0.2, 0, 0], rKnee: [0.6, 0, 0], lKnee: [0.5, 0, 0] } },
  { t: 0.55, pose: GUARD },
];

/** Long stagger used for guard breaks and being parried (open to ripostes). */
export const PARRIED_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  {
    t: 0.12,
    ease: 'out',
    pose: {
      root: [0, -0.1, -0.15],
      spine: [-0.45, 0, 0],
      chest: [-0.3, 0, 0],
      head: [-0.5, 0, 0],
      rShoulder: [-2.6, 0, -0.5],
      rElbow: [-0.3, 0, 0],
      lShoulder: [-0.5, 0, 0.9],
      lElbow: [-0.2, 0, 0],
      lHip: [0.2, 0, 0.1],
      lKnee: [0.5, 0, 0],
      rHip: [-0.4, 0, -0.1],
      rKnee: [0.3, 0, 0],
    },
  },
  {
    t: 0.6,
    pose: {
      root: [0, -0.35, -0.05],
      spine: [0.5, 0, 0],
      chest: [0.3, 0, 0],
      head: [0.4, 0, 0],
      rShoulder: [0.1, 0, -0.2],
      rElbow: [-0.2, 0, 0],
      rWrist: [0.8, 0, 0],
      lShoulder: [0.1, 0, 0.2],
      lElbow: [-0.2, 0, 0],
      lHip: [-0.6, 0, 0.1],
      lKnee: [1.1, 0, 0],
      rHip: [0.1, 0, -0.1],
      rKnee: [1.0, 0, 0],
    },
  },
  {
    t: 1.6,
    pose: {
      root: [0, -0.38, -0.05],
      spine: [0.55, 0, 0],
      chest: [0.3, 0, 0],
      head: [0.45, 0, 0],
      rShoulder: [0.15, 0, -0.2],
      rElbow: [-0.2, 0, 0],
      rWrist: [0.8, 0, 0],
      lShoulder: [0.15, 0, 0.2],
      lElbow: [-0.2, 0, 0],
      lHip: [-0.6, 0, 0.1],
      lKnee: [1.15, 0, 0],
      rHip: [0.1, 0, -0.1],
      rKnee: [1.05, 0, 0],
    },
  },
  { t: 2.0, pose: GUARD },
];

export const DEATH_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  {
    t: 0.25,
    pose: {
      root: [0, -0.3, 0],
      spine: [0.3, 0, 0.2],
      chest: [0.2, 0, 0],
      head: [0.5, 0, 0],
      rShoulder: [0.2, 0, -0.3],
      lShoulder: [0.2, 0, 0.3],
      lHip: [-0.7, 0, 0.1],
      lKnee: [1.5, 0, 0],
      rHip: [-0.3, 0, -0.1],
      rKnee: [1.3, 0, 0],
    },
  },
  {
    t: 0.6,
    pose: {
      root: [0, -0.55, 0],
      hips: [0.3, 0, 0],
      spine: [0.4, 0, 0.1],
      head: [0.6, 0, 0],
      rShoulder: [0.2, 0, -0.2],
      lShoulder: [0.2, 0, 0.2],
      lHip: [-1.4, 0, 0.1],
      lKnee: [2.2, 0, 0],
      rHip: [-1.4, 0, -0.1],
      rKnee: [2.2, 0, 0],
    },
  },
  {
    t: 1.1,
    ease: 'in',
    pose: {
      root: [0, -0.86, 0.3],
      hips: [1.5, 0, 0.1],
      spine: [0.1, 0, 0],
      head: [0.3, 0.6, 0],
      rShoulder: [-2.6, 0, -0.4],
      rElbow: [-0.2, 0, 0],
      lShoulder: [-2.6, 0, 0.3],
      lElbow: [-0.3, 0, 0],
      lHip: [-0.4, 0, 0.1],
      lKnee: [0.6, 0, 0],
      rHip: [-0.1, 0, -0.1],
      rKnee: [0.3, 0, 0],
    },
  },
];

export const HEAL_DURATION = 1.3;
export const HEAL_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  { t: 0.3, pose: { ...GUARD, lShoulder: [-1.0, 0, 0.1], lElbow: [-1.9, 0, 0], head: [-0.1, 0, 0] } },
  { t: 0.55, pose: { ...GUARD, lShoulder: [-1.3, -0.3, -0.1], lElbow: [-2.3, 0, 0], head: [-0.45, 0, 0], neck: [-0.2, 0, 0] } },
  { t: 0.95, pose: { ...GUARD, lShoulder: [-1.3, -0.3, -0.1], lElbow: [-2.3, 0, 0], head: [-0.45, 0, 0], neck: [-0.2, 0, 0] } },
  { t: HEAL_DURATION, pose: GUARD },
];

export const PARRY_DURATION = 0.75;
export const PARRY_CLIP: Keyframe[] = [
  { t: 0, pose: GUARD },
  { t: 0.08, ease: 'out', pose: { ...GUARD, chest: [0.05, -0.35, 0], lShoulder: [-0.9, -1.2, 0.9], lElbow: [-0.9, 0, 0] } },
  { t: 0.22, ease: 'out', pose: { ...GUARD, chest: [0.05, 0.55, 0], lShoulder: [-1.0, -1.4, 0.0], lElbow: [-0.9, 0, 0] } },
  { t: PARRY_DURATION, pose: GUARD },
];

/** Kneeling at a bonfire. */
export const REST_POSE: Pose = {
  root: [0, -0.5, 0],
  spine: [0.2, 0, 0],
  chest: [0.1, 0, 0],
  head: [0.35, 0, 0],
  lHip: [-1.4, 0, 0.1],
  lKnee: [1.45, 0, 0],
  rHip: [0.1, 0, -0.1],
  rKnee: [1.6, 0, 0],
  rShoulder: [-0.7, 0, 0.1],
  rElbow: [-0.6, 0, 0],
  rWrist: [-0.5, 0, 0],
  lShoulder: [-0.2, 0, 0.1],
  lElbow: [-0.6, 0, 0],
};
