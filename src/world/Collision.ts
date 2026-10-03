/** 2D (XZ-plane) collision primitives for the static world. */

export interface BoxCollider {
  kind: 'box';
  x: number;
  z: number;
  hx: number; // half extent along local X
  hz: number; // half extent along local Z
  angle: number; // rotation about Y (radians)
  height: number;
  enabled: boolean;
  tag?: string;
}

export interface CircleCollider {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  height: number;
  enabled: boolean;
  tag?: string;
}

export type Collider = BoxCollider | CircleCollider;

export interface Push {
  x: number;
  z: number;
}

/**
 * Push a circle (cx, cz, r) out of a collider. Returns the displacement
 * required, or null if not overlapping.
 */
export function resolveCircle(cx: number, cz: number, r: number, c: Collider): Push | null {
  if (!c.enabled) return null;
  if (c.kind === 'circle') {
    const dx = cx - c.x, dz = cz - c.z;
    const d2 = dx * dx + dz * dz;
    const rr = r + c.r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2);
    if (d < 1e-6) return { x: rr, z: 0 };
    const k = (rr - d) / d;
    return { x: dx * k, z: dz * k };
  }
  // Transform into box local space.
  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  const dx = cx - c.x, dz = cz - c.z;
  // Inverse rotation (rotation about Y by -angle).
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx));
  const qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let px = lx - qx, pz = lz - qz;
  const d2 = px * px + pz * pz;
  if (d2 >= r * r) return null;
  let ox: number, oz: number;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    ox = px * k;
    oz = pz * k;
  } else {
    // Centre inside the box: push out along the axis of least penetration.
    const penX = c.hx - Math.abs(lx);
    const penZ = c.hz - Math.abs(lz);
    if (penX < penZ) {
      ox = (penX + r) * Math.sign(lx || 1);
      oz = 0;
    } else {
      ox = 0;
      oz = (penZ + r) * Math.sign(lz || 1);
    }
  }
  // Rotate back to world.
  px = ox * cos + oz * sin;
  pz = -ox * sin + oz * cos;
  return { x: px, z: pz };
}

/** Ray (origin, unit dir in XZ) vs collider. Returns hit distance or Infinity. */
export function rayCollider(ox: number, oz: number, dx: number, dz: number, c: Collider, maxDist: number): number {
  if (!c.enabled) return Infinity;
  if (c.kind === 'circle') {
    const fx = ox - c.x, fz = oz - c.z;
    const b = fx * dx + fz * dz;
    const cc = fx * fx + fz * fz - c.r * c.r;
    const disc = b * b - cc;
    if (disc < 0) return Infinity;
    const t = -b - Math.sqrt(disc);
    return t >= 0 && t <= maxDist ? t : cc < 0 ? 0 : Infinity;
  }
  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  const rx = ox - c.x, rz = oz - c.z;
  const lox = rx * cos - rz * sin, loz = rx * sin + rz * cos;
  const ldx = dx * cos - dz * sin, ldz = dx * sin + dz * cos;
  let tmin = -Infinity, tmax = Infinity;
  for (const [o, d, h] of [[lox, ldx, c.hx], [loz, ldz, c.hz]] as const) {
    if (Math.abs(d) < 1e-9) {
      if (o < -h || o > h) return Infinity;
    } else {
      let t1 = (-h - o) / d, t2 = (h - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  const t = Math.max(0, tmin);
  return t <= maxDist ? t : Infinity;
}

export class CollisionWorld {
  colliders: Collider[] = [];

  add<T extends Collider>(c: T): T {
    this.colliders.push(c);
    return c;
  }

  /** Iteratively resolve a circle against all colliders. Mutates nothing; returns corrected position. */
  resolve(x: number, z: number, r: number, iterations = 3): Push {
    for (let it = 0; it < iterations; it++) {
      let moved = false;
      for (const c of this.colliders) {
        const p = resolveCircle(x, z, r, c);
        if (p) {
          x += p.x;
          z += p.z;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  raycast(ox: number, oz: number, dx: number, dz: number, maxDist: number): number {
    let best = Infinity;
    for (const c of this.colliders) {
      if (c.height < 1.2) continue;
      const t = rayCollider(ox, oz, dx, dz, c, maxDist);
      if (t < best) best = t;
    }
    return best;
  }
}
