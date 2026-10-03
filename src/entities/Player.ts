import * as THREE from 'three';
import { Actor } from './Actor';
import type { GameContext } from './Context';
import type { Input } from '../core/Input';
import { PLAYER_ATTACKS } from '../combat/Attacks';
import { audio } from '../core/Audio';
import { ROLL_DURATION } from '../anim/Animations';
import { damp, rotateTowards, yawTo } from '../core/math';
import { maxHp, maxStamina, damageMultiplier, type PlayerStats } from '../systems/Stats';

type Buffered = 'light' | 'heavy' | 'roll' | 'heal' | 'parry';

const BUFFER_TIME = 0.45;
const WALK_SPEED = 4.2;
const SPRINT_SPEED = 6.8;
const BLOCK_SPEED = 2.1;

export class Player extends Actor {
  camYaw = 0;
  flasks = 3;
  flasksMax = 3;
  private buffer: { a: Buffered; t: number } | null = null;
  private clock = 0;
  private sprintTime = 0;
  private healApplied = false;
  private moveDir = new THREE.Vector3();
  /** Set by the game: whether the HUD/game wants the player to ignore input. */
  frozen = false;

  constructor(private input: Input) {
    super({
      scale: 1,
      armor: 0x7d8189,
      cloth: 0x4a1814,
      trim: 0xa8834a,
      skin: 0xc49a7c,
      helmet: 'knight',
      weapon: 'sword',
      shield: true,
      cape: true,
    });
    this.name = 'Ashen One';
    this.team = 'player';
    this.attacks = PLAYER_ATTACKS;
    this.maxPoise = this.poise = 18;
    this.blockReduction = 1;
    this.blockStability = 1;
    this.maxSpeed = WALK_SPEED;
    this.trail.setColor(0xfff0d0);
  }

  applyStats(s: PlayerStats): void {
    const hpFrac = this.maxHp > 0 ? this.hp / this.maxHp : 1;
    this.maxHp = maxHp(s.vigor);
    this.hp = Math.round(this.maxHp * hpFrac);
    this.maxStamina = maxStamina(s.endurance);
    this.stamina = Math.min(this.stamina, this.maxStamina);
    this.damageMult = damageMultiplier(s.strength);
  }

  get healAmount(): number {
    return Math.round(this.maxHp * 0.45);
  }

  get isSprinting(): boolean {
    return this.sprintTime > 0;
  }

  private buffered(a: Buffered): boolean {
    return !!this.buffer && this.buffer.a === a && this.clock - this.buffer.t < BUFFER_TIME;
  }

  private consumeBuffer(): void {
    this.buffer = null;
  }

  protected wantsChain(): boolean {
    if (this.buffered('light')) {
      this.consumeBuffer();
      return this.stamina > 0;
    }
    return false;
  }

  protected think(dt: number, ctx: GameContext): void {
    this.clock += dt;
    const inp = this.input;
    if (!this.alive || this.state === 'rest') {
      this.moveVel.set(0, 0, 0);
      return;
    }
    if (!this.frozen) {
      for (const a of ['light', 'heavy', 'roll', 'heal', 'parry'] as const) {
        if (inp.wasPressed(a)) this.buffer = { a, t: this.clock };
      }
    }
    if (this.buffer && this.clock - this.buffer.t > BUFFER_TIME) this.buffer = null;

    // Camera-relative movement direction
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const mx = this.frozen ? 0 : inp.moveX, my = this.frozen ? 0 : inp.moveY;
    this.moveDir.set(fx * my - fz * mx, 0, fz * my + fx * mx);
    const moveLen = Math.min(1, this.moveDir.length());
    if (moveLen > 0.01) this.moveDir.normalize();

    this.blocking = !this.frozen && inp.block && (this.state === 'move' || this.state === 'blockstun');

    switch (this.state) {
      case 'move':
        this.thinkMove(dt, ctx, moveLen);
        break;
      case 'attack': {
        const a = this.attack!;
        if (a.cancelAt !== undefined && this.stateTime >= a.cancelAt && this.buffered('roll')) {
          this.consumeBuffer();
          this.doRoll(moveLen);
        } else if (a.chainAt !== undefined && this.stateTime >= a.chainAt && this.buffered('heavy') && this.stamina > 0) {
          this.consumeBuffer();
          this.startAttack(this.attacks.heavy, 0.08);
        }
        break;
      }
      case 'roll':
        if (this.stateTime > 0.5 && this.buffered('light') && this.stamina > 0) {
          this.consumeBuffer();
          if (moveLen > 0.1) this.yaw = yawTo(this.moveDir.x, this.moveDir.z);
          this.startAttack(this.attacks.rollAttack, 0.06);
        } else if (this.stateTime > ROLL_DURATION - 0.08 && this.buffered('roll') && this.stamina > 0) {
          this.consumeBuffer();
          this.doRoll(moveLen);
        }
        break;
      case 'heal':
        this.moveVel.copy(this.moveDir).multiplyScalar(WALK_SPEED * moveLen);
        if (!this.healApplied && this.stateTime >= 0.62) {
          this.healApplied = true;
          this.hp = Math.min(this.maxHp, this.hp + this.healAmount);
          ctx.fx.healBurst(this.pos);
          audio.heal();
        }
        break;
      case 'parry':
        // Once the parry window has passed, recovery can be cancelled into a riposte or roll.
        if (this.stateTime > 0.3 && (this.buffered('light') || this.buffered('roll'))) {
          this.setState('move', 0.06);
          this.thinkMove(dt, ctx, moveLen);
        }
        break;
      default:
        break;
    }
    if (this.state !== 'move') this.sprintTime = 0;
  }

  private thinkMove(dt: number, ctx: GameContext, moveLen: number): void {
    const inp = this.input;
    const wantSprint = !this.frozen && inp.sprint && moveLen > 0.3 && this.stamina > 0 && !this.blocking;
    if (wantSprint) {
      this.sprintTime += dt;
      this.stamina -= 16 * dt;
      this.staminaDelay = 0.5;
    } else this.sprintTime = 0;
    const speed = this.blocking ? BLOCK_SPEED : wantSprint ? SPRINT_SPEED : WALK_SPEED;
    const desired = this.moveDir.clone().multiplyScalar(speed * moveLen);
    const k = damp(14, dt);
    this.moveVel.lerp(desired, k);

    const tgt = this.target && this.target.alive ? this.target : null;
    if (tgt && !wantSprint) {
      this.yaw = rotateTowards(this.yaw, yawTo(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z), 12 * dt);
    } else if (moveLen > 0.1) {
      this.yaw = rotateTowards(this.yaw, yawTo(this.moveDir.x, this.moveDir.z), 13 * dt);
    }

    if (this.frozen) return;
    if (this.buffered('roll') && this.stamina > 0) {
      this.consumeBuffer();
      this.doRoll(moveLen);
    } else if (this.buffered('light') && this.stamina > 0) {
      this.consumeBuffer();
      if (!this.tryCritical(ctx)) {
        if (this.sprintTime > 0.35) this.startAttack(this.attacks.sprintAttack);
        else {
          if (moveLen > 0.1 && !tgt) this.yaw = yawTo(this.moveDir.x, this.moveDir.z);
          this.startAttack(this.attacks.light1);
        }
      }
    } else if (this.buffered('heavy') && this.stamina > 0) {
      this.consumeBuffer();
      if (moveLen > 0.1 && !tgt) this.yaw = yawTo(this.moveDir.x, this.moveDir.z);
      this.startAttack(this.attacks.heavy);
    } else if (this.buffered('heal')) {
      this.consumeBuffer();
      if (this.flasks > 0) {
        this.flasks--;
        this.healApplied = false;
        this.setState('heal', 0.12);
      }
    } else if (this.buffered('parry') && this.stamina > 0) {
      this.consumeBuffer();
      this.useStamina(12);
      this.setState('parry', 0.05);
      audio.swing(false);
    }
  }

  private doRoll(moveLen: number): void {
    this.useStamina(20);
    this.staminaDelay = 0.9;
    if (moveLen > 0.1) {
      this.rollDir.copy(this.moveDir);
      this.yaw = yawTo(this.moveDir.x, this.moveDir.z);
      this.setState('roll', 0.05);
    } else {
      this.setState('backstep', 0.05);
    }
    audio.roll();
  }

  /** Riposte a parried foe in front of us, or backstab an unaware one. */
  private tryCritical(ctx: GameContext): boolean {
    for (const o of ctx.actors) {
      if (o === this || o.team === this.team || !o.alive) continue;
      const d = this.distanceTo(o);
      if (d > 1.9 + o.radius) continue;
      const inFront = Math.abs(this.angleTo(o.pos)) < 0.9;
      if (!inFront) continue;
      if (o.riposteable) {
        this.beginCritical(o, 'riposte');
        return true;
      }
      const behindThem = Math.abs(o.angleTo(this.pos)) > 2.4;
      if (behindThem && o.state === 'move' && o.scale < 1.6) {
        this.beginCritical(o, 'backstab');
        return true;
      }
    }
    return false;
  }

  private beginCritical(o: Actor, kind: 'riposte' | 'backstab'): void {
    const gap = this.radius + o.radius + 0.35;
    if (kind === 'riposte') {
      // Stand in front of the victim, facing it.
      const dir = new THREE.Vector3(this.pos.x - o.pos.x, 0, this.pos.z - o.pos.z).normalize();
      this.pos.set(o.pos.x + dir.x * gap, 0, o.pos.z + dir.z * gap);
      o.yaw = yawTo(dir.x, dir.z);
    } else {
      // Stand behind the victim, facing its back.
      const f = o.forward;
      this.pos.set(o.pos.x - f.x * gap, 0, o.pos.z - f.z * gap);
      o.setState('stagger', 0.05);
      o.stateTime = -1.2; // hold the stagger while the backstab plays out
    }
    this.faceTowards(o.pos.x, o.pos.z);
    this.critical = kind;
    this.criticalVictim = o;
    this.startAttack(this.attacks.riposte, 0.06);
  }

  protected onFootstep(): void {
    audio.step(this.isSprinting ? 0.16 : 0.11);
  }

  rest(): void {
    this.setState('rest', 0.4);
    this.moveVel.set(0, 0, 0);
    this.blocking = false;
  }

  standUp(): void {
    this.setState('move', 0.4);
  }
}
