import * as THREE from 'three';
import { Enemy, type EnemyDef } from './Enemy';
import type { GameContext } from './Context';
import { BOSS_ATTACKS, type AttackDef } from '../combat/Attacks';
import { BRUTE_GUARD, REST_POSE } from '../anim/Animations';
import type { Pose } from '../anim/Pose';
import { audio } from '../core/Audio';

export const WARDEN: EnemyDef = {
  kind: 'boss',
  name: 'Vorhal, the Ashen Warden',
  style: {
    scale: 2.15,
    bulk: 1.2,
    armor: 0x2e2927,
    cloth: 0x1c1310,
    trim: 0x8a6a34,
    skin: 0x5a4d44,
    helmet: 'horned',
    eyes: 0xff7a1a,
    weapon: 'greataxe',
    shield: false,
    cape: true,
  },
  hp: 1650,
  poise: 220,
  souls: 6500,
  attacks: BOSS_ATTACKS,
  runSpeed: 4.4,
  walkSpeed: 1.9,
  aggroRange: 100,
  leash: 1000,
  engageRange: 2.0,
  cooldown: [0.5, 1.4],
  chainChance: 0.65,
  basePose: BRUTE_GUARD,
  choose: () => null, // Boss uses its own selection logic
};

export class Boss extends Enemy {
  active = false;
  phase = 1;
  private recent: string[] = [];
  private phaseShiftPending = false;
  onPhaseChange: ((phase: number) => void) | null = null;
  private emberTimer = 0;

  constructor(x: number, z: number, yaw: number) {
    super(WARDEN, x, z, yaw, 'warden');
    this.trail.setColor(0xffb070);
  }

  respawn(): void {
    super.respawn();
    this.active = false;
    this.phase = 1;
    this.animSpeed = 1;
    this.recent = [];
    this.phaseShiftPending = false;
    this.trail.setColor(0xffb070);
    this.setState('rest', 0);
  }

  activate(): void {
    if (this.active) return;
    this.active = true;
    this.setState('move', 0.8);
    this.cooldown = 1.6;
  }

  protected evaluatePose(root: THREE.Vector3): Pose {
    if (this.state === 'rest') return REST_POSE;
    return super.evaluatePose(root);
  }

  get invulnerable(): boolean {
    return !this.active || super.invulnerable;
  }

  startAttack(def: AttackDef, blend = 0.12): void {
    super.startAttack(def, blend);
    this.recent.push(def.id);
    if (this.recent.length > 3) this.recent.shift();
  }

  private pick(dist: number): string | null {
    const r = Math.random();
    const s = this.scale;
    const p2 = this.phase === 2;
    const opts: [string, number][] = [];
    if (dist > 8 * s * 0.5) {
      opts.push(['leap', 3]);
    } else if (dist > 4.6) {
      opts.push(['leap', 1], ['sweepR', 2], ['delayedCleave', 1]);
      if (p2) opts.push(['spin', 2]);
    } else {
      opts.push(['sweepR', 3], ['cleave', 2], ['delayedCleave', 2]);
      if (p2) opts.push(['spin', 2], ['nova', 1.5]);
    }
    // Avoid spamming the same move.
    const weights = opts.map(([id, w]) => [id, this.recent.filter((x) => x === id).length >= 2 ? w * 0.1 : w] as [string, number]);
    const total = weights.reduce((a, [, w]) => a + w, 0);
    let acc = 0;
    for (const [id, w] of weights) {
      acc += w / total;
      if (r <= acc) return id;
    }
    return weights[weights.length - 1]?.[0] ?? null;
  }

  protected think(dt: number, ctx: GameContext): void {
    if (!this.alive) return;
    if (!this.active) {
      this.moveVel.set(0, 0, 0);
      return;
    }
    this.target = ctx.player.alive ? ctx.player : null;

    // Fire effects in phase 2
    if (this.phase === 2) {
      this.emberTimer -= dt;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.03;
        const tip = new THREE.Vector3();
        this.rig.weaponTip.getWorldPosition(tip);
        const base = new THREE.Vector3();
        this.rig.weaponBase.getWorldPosition(base);
        ctx.fx.fireEmber(tip.lerp(base, Math.random() * 0.4), 0.25, 1.2);
      }
    }
    // Charging nova telegraph
    if (this.state === 'attack' && this.attack?.id === 'nova' && this.stateTime > 0.4 && this.stateTime < 1.6) {
      ctx.fx.fireGather(this.pos, 4 * this.scale * 0.6);
    }

    if (this.phase === 1 && this.hp < this.maxHp * 0.5) this.phaseShiftPending = true;
    if (this.phaseShiftPending && this.state === 'move') {
      this.phaseShiftPending = false;
      this.phase = 2;
      this.animSpeed = 1.15;
      this.trail.setColor(0xff6a20);
      this.startAttack(this.attacks.nova);
      audio.startBossMusic(true);
      this.onPhaseChange?.(2);
      return;
    }

    if (this.state !== 'move' || !this.target) {
      if (!this.target) this.moveVel.set(0, 0, 0);
      return;
    }
    this.cooldown -= dt;
    const t = this.target;
    const dist = this.distanceTo(t);
    const to = new THREE.Vector3(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    const want = Math.atan2(to.x, to.z);
    const diff = Math.atan2(Math.sin(want - this.yaw), Math.cos(want - this.yaw));
    this.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 3.2 * dt);

    if (this.cooldown <= 0 && Math.abs(diff) < 0.7) {
      const id = this.pick(dist);
      if (id) {
        this.moveVel.set(0, 0, 0);
        this.startAttack(this.attacks[id]);
        return;
      }
    }
    const speed = dist > 7 ? this.def.runSpeed : this.def.walkSpeed * 1.4;
    const desired = dist > 4.2 ? to.clone().multiplyScalar(speed) : new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(this.def.walkSpeed * 0.7);
    this.moveVel.lerp(desired, 1 - Math.exp(-6 * dt));
  }

  protected onFootstep(ctx: GameContext): void {
    if (this.pos.distanceTo(ctx.player.pos) < 30) audio.heavyStep();
    ctx.shake(0.04);
  }
}
