import { describe, expect, it } from 'vitest';
import { addPoses, blendPoses, maskPose, sampleClip, type Keyframe } from '../src/anim/Pose';
import { angleDiff, rotateTowards, wrapAngle } from '../src/core/math';
import { PLAYER_ATTACKS, HOLLOW_ATTACKS, BRUTE_ATTACKS, BOSS_ATTACKS } from '../src/combat/Attacks';

describe('pose maths', () => {
  it('blends joint rotations linearly', () => {
    const p = blendPoses({ head: [0, 0, 0] }, { head: [1, 2, 3] }, 0.5);
    expect(p.head).toEqual([0.5, 1, 1.5]);
  });

  it('treats missing joints as zero', () => {
    const p = blendPoses({}, { chest: [2, 0, 0] }, 0.25);
    expect(p.chest![0]).toBeCloseTo(0.5);
  });

  it('adds and masks poses', () => {
    expect(addPoses({ spine: [1, 0, 0] }, { spine: [1, 1, 0] }, 0.5).spine).toEqual([1.5, 0.5, 0]);
    const m = maskPose({ head: [0, 0, 0], spine: [0, 0, 0] }, { head: [1, 1, 1], spine: [1, 1, 1] }, ['head'], 1);
    expect(m.head).toEqual([1, 1, 1]);
    expect(m.spine).toEqual([0, 0, 0]);
  });

  it('samples keyframed clips with clamping', () => {
    const clip: Keyframe[] = [
      { t: 0, pose: { head: [0, 0, 0] } },
      { t: 1, pose: { head: [1, 0, 0] }, ease: 'linear' },
    ];
    expect(sampleClip(clip, -1).head![0]).toBe(0);
    expect(sampleClip(clip, 0.25).head![0]).toBeCloseTo(0.25);
    expect(sampleClip(clip, 5).head![0]).toBe(1);
  });
});

describe('angles', () => {
  it('wraps and diffs', () => {
    expect(wrapAngle(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI);
    expect(wrapAngle(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
    expect(rotateTowards(0, 1, 0.25)).toBeCloseTo(0.25);
    expect(rotateTowards(0, 0.1, 0.25)).toBeCloseTo(0.1);
  });
});

describe('attack data', () => {
  const all = { ...PLAYER_ATTACKS, ...HOLLOW_ATTACKS, ...BRUTE_ATTACKS, ...BOSS_ATTACKS };
  for (const [id, a] of Object.entries(all)) {
    it(`${id} has a consistent timeline`, () => {
      expect(a.clip.length).toBeGreaterThan(1);
      for (let i = 1; i < a.clip.length; i++) expect(a.clip[i].t).toBeGreaterThanOrEqual(a.clip[i - 1].t);
      expect(a.clip[a.clip.length - 1].t).toBeCloseTo(a.duration, 5);
      if (a.hitStart < 99) {
        expect(a.hitStart).toBeLessThan(a.hitEnd);
        expect(a.hitEnd).toBeLessThanOrEqual(a.duration);
      }
      for (const aoe of a.aoe ?? []) expect(aoe.at).toBeLessThanOrEqual(a.duration);
      if (a.chainAt !== undefined) expect(a.chainAt).toBeLessThan(a.duration);
    });
  }
  it('chains reference existing attacks', () => {
    for (const set of [PLAYER_ATTACKS, HOLLOW_ATTACKS, BRUTE_ATTACKS, BOSS_ATTACKS]) {
      for (const a of Object.values(set)) if (a.next) expect(set[a.next]).toBeDefined();
    }
  });
});
