import { describe, expect, it } from 'vitest';
import { CollisionWorld, rayCollider, resolveCircle, type BoxCollider } from '../src/world/Collision';

const box = (angle = 0): BoxCollider => ({ kind: 'box', x: 0, z: 0, hx: 2, hz: 0.5, angle, height: 3, enabled: true });

describe('resolveCircle', () => {
  it('ignores non-overlapping circles', () => {
    expect(resolveCircle(0, 5, 0.4, box())).toBeNull();
  });

  it('pushes a circle out of an axis-aligned box', () => {
    const p = resolveCircle(0, 0.7, 0.4, box())!;
    expect(p.x).toBeCloseTo(0);
    expect(0.7 + p.z).toBeCloseTo(0.9);
  });

  it('handles rotated boxes', () => {
    // Box rotated 90°: its long axis now runs along world Z.
    const b = box(Math.PI / 2);
    expect(resolveCircle(0, 1.5, 0.4, b)).not.toBeNull();
    expect(resolveCircle(1.5, 0, 0.4, b)).toBeNull();
  });

  it('pushes a centre that is inside the box out along the shortest axis', () => {
    const p = resolveCircle(0.1, 0.1, 0.4, box())!;
    expect(Math.abs(p.z)).toBeGreaterThan(Math.abs(p.x));
    expect(0.1 + p.z).toBeCloseTo(0.9);
  });

  it('separates circles', () => {
    const p = resolveCircle(0.5, 0, 0.5, { kind: 'circle', x: 0, z: 0, r: 0.5, height: 1, enabled: true })!;
    expect(0.5 + p.x).toBeCloseTo(1);
  });

  it('skips disabled colliders', () => {
    expect(resolveCircle(0, 0, 0.4, { ...box(), enabled: false })).toBeNull();
  });
});

describe('CollisionWorld', () => {
  it('iteratively resolves against several colliders', () => {
    const w = new CollisionWorld();
    w.add(box());
    w.add({ ...box(), z: 1.5 });
    const r = w.resolve(0, 0.75, 0.3);
    // Squeezed between two walls 1m apart with a 0.6m body: ends outside both.
    expect(Math.abs(r.z - 0.75)).toBeGreaterThan(0);
  });

  it('raycasts against tall colliders only', () => {
    const w = new CollisionWorld();
    w.add({ ...box(), z: 5 });
    w.add({ kind: 'circle', x: 0, z: 2, r: 0.5, height: 0.5, enabled: true });
    expect(w.raycast(0, 0, 0, 1, 10)).toBeCloseTo(4.5);
    expect(rayCollider(0, 0, 0, -1, box(), 10)).toBe(0); // origin inside the box
  });
});
