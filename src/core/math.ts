export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

/** Framerate-independent exponential smoothing factor. */
export function damp(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt);
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Shortest signed angular difference b - a. */
export function angleDiff(a: number, b: number): number {
  return wrapAngle(b - a);
}

export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

/** Rotate angle a toward b by at most maxStep radians. */
export function rotateTowards(a: number, b: number, maxStep: number): number {
  const d = angleDiff(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return wrapAngle(a + Math.sign(d) * maxStep);
}

export function moveTowards(a: number, b: number, maxStep: number): number {
  if (Math.abs(b - a) <= maxStep) return b;
  return a + Math.sign(b - a) * maxStep;
}

/** Yaw (rotation about +Y) that makes local +Z face the direction (dx, dz). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap value noise in 2D, range roughly [-1, 1]. */
export function noise2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (i: number, j: number) => {
    let n = i * 374761393 + j * 668265263;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) & 0xffff) / 0x7fff - 1;
  };
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
}

export function fbm(x: number, y: number, octaves = 4): number {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return s;
}
