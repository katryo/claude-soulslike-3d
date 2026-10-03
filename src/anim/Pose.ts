import { smoothstep } from '../core/math';

export const JOINTS = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  'lShoulder',
  'lElbow',
  'lWrist',
  'rShoulder',
  'rElbow',
  'rWrist',
  'lHip',
  'lKnee',
  'rHip',
  'rKnee',
] as const;

export type Joint = (typeof JOINTS)[number];
export type V3 = readonly [number, number, number];

/**
 * A pose is a set of Euler rotations (radians, XYZ order) per joint, plus an
 * optional `root` translation offset applied to the hips.
 *
 * Conventions (character faces local +Z, limbs hang along -Y):
 *   shoulder/hip  x < 0  → limb swings forward
 *   elbow         x < 0  → forearm bends forward/up
 *   knee          x > 0  → shin bends backward
 *   chest         y > 0  → torso twists to the character's left
 *   lShoulder z > 0 / rShoulder z < 0 → arm raised outward
 */
export type Pose = Partial<Record<Joint | 'root', V3>>;

export interface Keyframe {
  t: number;
  pose: Pose;
  /** Easing used when interpolating *into* this keyframe. */
  ease?: 'linear' | 'smooth' | 'in' | 'out';
}

const ZERO: V3 = [0, 0, 0];

function ease(t: number, kind: Keyframe['ease']): number {
  switch (kind) {
    case 'linear':
      return t;
    case 'in':
      return t * t * t;
    case 'out':
      return 1 - Math.pow(1 - t, 3);
    default:
      return smoothstep(t);
  }
}

export function lerpV3(a: V3, b: V3, t: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Blend two poses; joints absent from either side are treated as zero. */
export function blendPoses(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out: Pose = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof Pose>;
  for (const k of keys) out[k] = lerpV3(a[k] ?? ZERO, b[k] ?? ZERO, t);
  return out;
}

/** Add `b` on top of `a` (per-joint sum), scaled by w. */
export function addPoses(a: Pose, b: Pose, w = 1): Pose {
  const out: Pose = { ...a };
  for (const k of Object.keys(b) as (keyof Pose)[]) {
    const x = a[k] ?? ZERO;
    const y = b[k]!;
    out[k] = [x[0] + y[0] * w, x[1] + y[1] * w, x[2] + y[2] * w];
  }
  return out;
}

/** Override only the given joints of `base` with `over`, weighted. */
export function maskPose(base: Pose, over: Pose, joints: readonly (Joint | 'root')[], w: number): Pose {
  const out: Pose = { ...base };
  for (const j of joints) {
    out[j] = lerpV3(base[j] ?? ZERO, over[j] ?? ZERO, w);
  }
  return out;
}

/** Sample a keyframed clip at time t (clamped to clip range). */
export function sampleClip(keys: readonly Keyframe[], t: number): Pose {
  if (keys.length === 0) return {};
  if (t <= keys[0].t) return keys[0].pose;
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i];
    if (t <= k1.t) {
      const k0 = keys[i - 1];
      const span = k1.t - k0.t;
      const u = span > 0 ? (t - k0.t) / span : 1;
      return blendPoses(k0.pose, k1.pose, ease(u, k1.ease));
    }
  }
  return keys[keys.length - 1].pose;
}
