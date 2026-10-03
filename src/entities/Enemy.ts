import * as THREE from 'three';
import { Actor } from './Actor';
import type { GameContext } from './Context';
import type { RigStyle } from '../anim/Rig';
import type { AttackDef } from '../combat/Attacks';
import { BRUTE_ATTACKS, HOLLOW_ATTACKS } from '../combat/Attacks';
import { BRUTE_GUARD } from '../anim/Animations';
import type { Pose } from '../anim/Pose';
import { damp, rotateTowards, yawTo } from '../core/math';

export interface EnemyDef {
  kind: string;
  name: string;
  style: RigStyle;
  hp: number;
  poise: number;
  souls: number;
  attacks: Record<string, AttackDef>;
  runSpeed: number;
  walkSpeed: number;
  aggroRange: number;
  leash: number;
  /** Distance at which the enemy stops approaching and starts circling. */
  engageRange: number;
  cooldown: [number, number];
  chainChance: number;
  basePose?: Pose;
  /** Pick an attack id for the current distance, or null to keep manoeuvring. */
  choose(dist: number, e: Enemy): string | null;
}

export const HOLLOW: EnemyDef = {
  kind: 'hollow',
  name: 'Hollow Soldier',
  style: {
    scale: 0.97,
    armor: 0x4d4a45,
    cloth: 0x3f362c,
    trim: 0x5e4f36,
    skin: 0x7d776a,
    helmet: 'hood',
    eyes: 0xff4a10,
    weapon: 'sword',
    shield: false,
    cape: false,
  },
  hp: 95,
  poise: 14,
  souls: 85,
  attacks: HOLLOW_ATTACKS,
  runSpeed: 3.6,
  walkSpeed: 1.5,
  aggroRange: 12,
  leash: 26,
  engageRange: 2.6,
  cooldown: [0.6, 1.8],
  chainChance: 0.55,
  choose(dist) {
    if (dist < 2.6) return Math.random() < 0.8 ? 'slash' : 'lunge';
    if (dist < 4.2 && Math.random() < 0.5) return 'lunge';
    return null;
  },
};

export const SPEARMAN: EnemyDef = {
  ...HOLLOW,
  kind: 'spearman',
  name: 'Hollow Spearman',
  style: { ...HOLLOW.style, weapon: 'spear', helmet: 'knight', armor: 0x55534f, cloth: 0x3a2e28 },
  hp: 110,
  poise: 20,
  souls: 110,
  engageRange: 3.4,
  choose(dist) {
    if (dist < 4.4) return Math.random() < 0.75 ? 'lunge' : dist < 2.6 ? 'slash' : 'lunge';
    return null;
  },
};

export const BRUTE: EnemyDef = {
  kind: 'brute',
  name: 'Ashbound Brute',
  style: {
    scale: 1.32,
    bulk: 1.35,
    armor: 0x38332f,
    cloth: 0x2a221c,
    trim: 0x5a4632,
    skin: 0x6b5e52,
    helmet: 'horned',
    eyes: 0xff2a10,
    weapon: 'club',
    shield: false,
    cape: false,
  },
  hp: 400,
  poise: 85,
  souls: 380,
  attacks: BRUTE_ATTACKS,
  runSpeed: 3.0,
  walkSpeed: 1.3,
  aggroRange: 11,
  leash: 24,
  engageRange: 3.2,
  cooldown: [1.0, 2.4],
  chainChance: 0,
  basePose: BRUTE_GUARD,
  choose(dist) {
    if (dist < 3.3) return Math.random() < 0.5 ? 'smash' : 'sweep';
    if (dist < 4.2 && Math.random() < 0.3) return 'smash';
    return null;
  },
};

export class Enemy extends Actor {
  readonly home = new THREE.Vector3();
  homeYaw = 0;
  cooldown = 1;
  private strafeDir = 1;
  private strafeTimer = 0;
  private chain = false;
  dissolve = 0;
  awardedSouls = false;
  readonly id: string;

  constructor(readonly def: EnemyDef, x: number, z: number, yaw: number, id: string) {
    super(def.style);
    this.id = id;
    this.name = def.name;
    this.team = 'enemy';
    this.attacks = def.attacks;
    this.maxHp = this.hp = def.hp;
    this.maxPoise = this.poise = def.poise;
    this.maxSpeed = def.runSpeed;
    this.basePose = def.basePose ?? this.basePose;
    this.lastPose = this.basePose;
    this.home.set(x, 0, z);
    this.homeYaw = yaw;
    this.reset(x, z, yaw);
    this.trail.setColor(0xffc8a0);
  }

  respawn(): void {
    this.reset(this.home.x, this.home.z, this.homeYaw);
    this.cooldown = 1;
    this.dissolve = 0;
    this.awardedSouls = false;
  }

  startAttack(def: AttackDef, blend = 0.1): void {
    super.startAttack(def, blend);
    this.chain = Math.random() < this.def.chainChance;
  }

  protected wantsChain(): boolean {
    return this.chain && !!this.target && this.target.alive && this.distanceTo(this.target) < 4.5 * this.scale;
  }

  protected onStateEnd(ctx: GameContext): void {
    if (this.state === 'attack') {
      const [a, b] = this.def.cooldown;
      this.cooldown = a + Math.random() * (b - a);
    }
    super.onStateEnd(ctx);
  }

  /** Can this enemy currently see / sense the player? */
  protected senses(p: Actor): boolean {
    const d = this.distanceTo(p);
    if (d > this.def.aggroRange) return false;
    if (d < 1.6) return true;
    // Sprinting footsteps are heard from behind.
    if (d < 6 && (p as { isSprinting?: boolean }).isSprinting) return true;
    return Math.abs(this.angleTo(p.pos)) < 1.2;
  }

  applyDamage(dmg: number, ctx: GameContext, killer: Actor | null): boolean {
    if (killer && killer.team !== this.team) this.target = killer;
    return super.applyDamage(dmg, ctx, killer);
  }

  protected think(dt: number, ctx: GameContext): void {
    if (!this.alive) {
      this.moveVel.set(0, 0, 0);
      return;
    }
    const p = ctx.player;
    if (!this.target) {
      if (p.alive && this.senses(p)) this.target = p;
    } else if (!this.target.alive || this.pos.distanceTo(this.home) > this.def.leash) {
      this.target = null;
    }
    if (this.state !== 'move') return;
    this.cooldown -= dt;
    const k = damp(8, dt);

    if (!this.target) {
      // Walk home and stand guard.
      const dx = this.home.x - this.pos.x, dz = this.home.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.5) {
        this.moveVel.lerp(new THREE.Vector3(dx / d, 0, dz / d).multiplyScalar(this.def.walkSpeed * 1.4), k);
        this.yaw = rotateTowards(this.yaw, yawTo(dx, dz), 5 * dt);
        if (d < 1 && this.hp < this.maxHp) this.hp = this.maxHp;
      } else {
        this.moveVel.lerp(new THREE.Vector3(), k);
        this.yaw = rotateTowards(this.yaw, this.homeYaw, 2 * dt);
        this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.2 * dt);
      }
      return;
    }

    const t = this.target;
    const dist = this.distanceTo(t);
    const to = new THREE.Vector3(t.pos.x - this.pos.x, 0, t.pos.z - this.pos.z).normalize();
    this.yaw = rotateTowards(this.yaw, yawTo(to.x, to.z), 6 * dt);

    if (this.cooldown <= 0 && Math.abs(this.angleTo(t.pos)) < 0.6) {
      const id = this.def.choose(dist / this.scale, this);
      if (id && this.attacks[id]) {
        this.moveVel.set(0, 0, 0);
        this.startAttack(this.attacks[id]);
        return;
      }
    }

    const engage = this.def.engageRange * this.scale;
    const desired = new THREE.Vector3();
    if (dist > engage) {
      desired.copy(to).multiplyScalar(dist > engage + 3 ? this.def.runSpeed : this.def.walkSpeed * 1.6);
    } else {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.strafeTimer = 0.8 + Math.random() * 1.6;
      }
      const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(this.strafeDir);
      desired.copy(side).multiplyScalar(this.def.walkSpeed);
      if (dist < engage * 0.6) desired.addScaledVector(to, -this.def.walkSpeed * 0.8);
    }
    this.moveVel.lerp(desired, k);
  }

  /** Corpse fade-out handled per frame by the game. Returns true once fully gone. */
  updateCorpse(dt: number, ctx: GameContext): boolean {
    if (this.alive) return false;
    if (this.deathTime > 2.0) {
      this.dissolve = Math.min(1, this.dissolve + dt * 0.7);
      this.rig.setOpacity(1 - this.dissolve);
      if (this.dissolve < 1 && Math.random() < 0.8) ctx.fx.dissolve(this.pos, this.scale);
      if (this.dissolve >= 1) {
        this.rig.setVisible(false);
        return true;
      }
    }
    return false;
  }
}
