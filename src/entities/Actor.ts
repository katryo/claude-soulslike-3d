import * as THREE from 'three';
import { Rig, type RigStyle } from '../anim/Rig';
import { blendPoses, sampleClip, type Keyframe, type Pose } from '../anim/Pose';
import {
  BACKSTEP_CLIP,
  BACKSTEP_DURATION,
  BLOCK,
  DEATH_CLIP,
  GUARD,
  HEAL_CLIP,
  HEAL_DURATION,
  PARRIED_CLIP,
  PARRY_CLIP,
  PARRY_DURATION,
  REST_POSE,
  ROLL_CLIP,
  ROLL_DURATION,
  STAGGER_CLIP,
  breathe,
  locomotion,
} from '../anim/Animations';
import type { AttackDef } from '../combat/Attacks';
import { processAttack } from '../combat/Combat';
import { WeaponTrail } from '../fx/Effects';
import { audio } from '../core/Audio';
import { angleDiff, clamp, rotateTowards, wrapAngle, yawTo } from '../core/math';
import type { GameContext } from './Context';

export type ActorState =
  | 'move'
  | 'attack'
  | 'roll'
  | 'backstep'
  | 'stagger'
  | 'parried'
  | 'knockdown'
  | 'heal'
  | 'parry'
  | 'blockstun'
  | 'dead'
  | 'rest';

export type Team = 'player' | 'enemy';

const KNOCKDOWN_CLIP: Keyframe[] = [
  ...DEATH_CLIP,
  { t: 2.3, pose: DEATH_CLIP[DEATH_CLIP.length - 1].pose },
  {
    t: 2.9,
    pose: {
      ...GUARD,
      root: [0, -0.5, 0],
      spine: [0.6, 0, 0],
      lHip: [-1.3, 0, 0.1],
      lKnee: [1.5, 0, 0],
      rHip: [0.1, 0, 0],
      rKnee: [1.6, 0, 0],
    },
  },
  { t: 3.4, pose: GUARD },
];
const KNOCKDOWN_DURATION = 3.4;
const STAGGER_DURATION = 0.55;
const PARRIED_DURATION = 2.0;
const BLOCKSTUN_DURATION = 0.32;

function wrapPose(p: Pose): Pose {
  const out: Pose = {};
  for (const k of Object.keys(p) as (keyof Pose)[]) {
    const v = p[k]!;
    out[k] = k === 'root' ? v : [wrapAngle(v[0]), wrapAngle(v[1]), wrapAngle(v[2])];
  }
  return out;
}

export abstract class Actor {
  readonly rig: Rig;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  readonly moveVel = new THREE.Vector3();
  readonly knock = new THREE.Vector3();
  radius = 0.4;
  scale: number;

  hp = 100;
  maxHp = 100;
  stamina = 100;
  maxStamina = 100;
  staminaRegen = 45;
  staminaDelay = 0;
  poise = 20;
  maxPoise = 20;
  poiseTimer = 0;
  /** Physical damage absorption while blocking (0..1). */
  blockReduction = 1;
  /** Shield stability: multiplies stamina lost when blocking. */
  blockStability = 1;

  state: ActorState = 'move';
  stateTime = 0;
  attack: AttackDef | null = null;
  readonly hitSet = new Set<Actor>();
  readonly firedEvents = new Set<string>();
  attacks: Record<string, AttackDef> = {};
  animSpeed = 1;
  team: Team = 'enemy';
  target: Actor | null = null;
  blocking = false;
  /** Damage multiplier applied to the next landed critical / to all attacks. */
  damageMult = 1;
  critical: 'riposte' | 'backstab' | null = null;
  criticalVictim: Actor | null = null;

  protected locoPhase = 0;
  protected maxSpeed = 4;
  protected rollDir = new THREE.Vector3();
  protected trans: { from: Pose; t: number; dur: number } | null = null;
  protected lastPose: Pose = {};
  protected basePose: Pose = GUARD;
  protected deathTime = 0;
  readonly trail: WeaponTrail;
  protected stepPhaseLast = 0;
  name = 'Actor';

  constructor(style: RigStyle) {
    this.rig = new Rig(style);
    this.scale = style.scale;
    this.radius = 0.4 * style.scale * (style.bulk ?? 1);
    this.trail = new WeaponTrail(this.rig.weaponBase, this.rig.weaponTip, 0xffe0b0);
  }

  get alive(): boolean {
    return this.state !== 'dead';
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** True while dodge invincibility frames are active. */
  get invulnerable(): boolean {
    if (this.state === 'roll') return this.stateTime > 0.04 && this.stateTime < 0.44;
    if (this.state === 'backstep') return this.stateTime > 0.03 && this.stateTime < 0.25;
    if (this.state === 'knockdown') return true;
    if (this.state === 'attack' && this.attack?.id === 'riposte') return true;
    if (this.state === 'rest') return true;
    return false;
  }

  get parryActive(): boolean {
    return this.state === 'parry' && this.stateTime > 0.04 && this.stateTime < 0.26;
  }

  get hyperArmorActive(): boolean {
    return this.state === 'attack' && !!this.attack?.hyperArmor && this.stateTime < this.attack.hitEnd + 0.1;
  }

  /** Whether the actor is open to a riposte. */
  get riposteable(): boolean {
    return this.state === 'parried' && this.stateTime < PARRIED_DURATION - 0.3;
  }

  setState(s: ActorState, blend = 0.1): void {
    this.trans = blend > 0 ? { from: wrapPose(this.lastPose), t: 0, dur: blend } : null;
    this.state = s;
    this.stateTime = 0;
    this.trail.active = false;
    if (s !== 'attack') this.attack = null;
  }

  startAttack(def: AttackDef, blend = 0.08): void {
    this.setState('attack', blend);
    this.attack = def;
    this.hitSet.clear();
    this.firedEvents.clear();
    if (def.stamina > 0) this.useStamina(def.stamina);
  }

  useStamina(n: number): void {
    this.stamina -= n;
    this.staminaDelay = 0.7;
  }

  faceTowards(x: number, z: number, maxStep = Infinity): void {
    const want = yawTo(x - this.pos.x, z - this.pos.z);
    this.yaw = maxStep === Infinity ? want : rotateTowards(this.yaw, want, maxStep);
  }

  /** Signed angle from our facing to the given point (0 = dead ahead). */
  angleTo(p: THREE.Vector3): number {
    return angleDiff(this.yaw, yawTo(p.x - this.pos.x, p.z - this.pos.z));
  }

  distanceTo(o: Actor): number {
    return Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z);
  }

  /** Subclass decision making — sets moveVel / yaw / triggers actions. */
  protected abstract think(dt: number, ctx: GameContext): void;

  protected onStateEnd(ctx: GameContext): void {
    void ctx;
    this.setState('move', 0.15);
  }

  update(dt: number, ctx: GameContext): void {
    this.think(dt, ctx);
    const sdt = this.state === 'attack' ? dt * this.animSpeed : dt;
    this.stateTime += sdt;

    // Stamina & poise regeneration
    if (this.staminaDelay > 0) this.staminaDelay -= dt;
    else if (this.state !== 'attack' && this.state !== 'roll') {
      const rate = this.blocking ? this.staminaRegen * 0.35 : this.staminaRegen;
      this.stamina = Math.min(this.maxStamina, this.stamina + rate * dt);
    }
    this.poiseTimer -= dt;
    if (this.poiseTimer <= 0) this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * dt);

    const root = new THREE.Vector3();
    switch (this.state) {
      case 'attack':
        this.updateAttack(dt, ctx, root);
        break;
      case 'roll': {
        const t = this.stateTime;
        const speed = t < 0.45 ? 6.2 : t < ROLL_DURATION ? 6.2 * (1 - (t - 0.45) / (ROLL_DURATION - 0.45)) : 0;
        root.copy(this.rollDir).multiplyScalar(speed * Math.min(this.scale, 1.2));
        if (t >= ROLL_DURATION) this.onStateEnd(ctx);
        break;
      }
      case 'backstep': {
        const t = this.stateTime;
        const speed = t < 0.3 ? -5 : t < BACKSTEP_DURATION ? -5 * (1 - (t - 0.3) / 0.2) : 0;
        root.copy(this.forward).multiplyScalar(speed);
        if (t >= BACKSTEP_DURATION) this.onStateEnd(ctx);
        break;
      }
      case 'stagger':
        if (this.stateTime >= STAGGER_DURATION) this.onStateEnd(ctx);
        break;
      case 'parried':
        if (this.stateTime >= PARRIED_DURATION) this.onStateEnd(ctx);
        break;
      case 'knockdown':
        if (this.stateTime >= KNOCKDOWN_DURATION) this.onStateEnd(ctx);
        break;
      case 'blockstun':
        if (this.stateTime >= BLOCKSTUN_DURATION) this.onStateEnd(ctx);
        break;
      case 'heal':
        root.copy(this.moveVel).multiplyScalar(0.35);
        if (this.stateTime >= HEAL_DURATION) this.onStateEnd(ctx);
        break;
      case 'parry':
        if (this.stateTime >= PARRY_DURATION) this.onStateEnd(ctx);
        break;
      case 'dead':
        this.deathTime += dt;
        break;
      case 'move':
        root.copy(this.moveVel);
        break;
      case 'rest':
        break;
    }

    // Integrate
    this.pos.x += (root.x + this.knock.x) * dt;
    this.pos.z += (root.z + this.knock.z) * dt;
    const k = Math.exp(-7 * dt);
    this.knock.multiplyScalar(k);
    if (this.state !== 'dead') {
      const r = ctx.collision.resolve(this.pos.x, this.pos.z, this.radius);
      this.pos.x = r.x;
      this.pos.z = r.z;
    }

    // Locomotion phase & footsteps
    const speed = Math.hypot(root.x, root.z);
    if (this.state === 'move') {
      const stride = 1.35 * this.scale;
      this.locoPhase += (speed * dt * Math.PI) / stride;
      const stepIdx = Math.floor(this.locoPhase / Math.PI);
      if (stepIdx !== this.stepPhaseLast && speed > 0.5) this.onFootstep(ctx);
      this.stepPhaseLast = stepIdx;
    }

    this.animate(dt, root);
  }

  protected onFootstep(ctx: GameContext): void {
    const d = this.pos.distanceTo(ctx.player.pos);
    if (d < 18) audio.step(0.12 * (1 - d / 18) * (this.scale > 1.5 ? 2.5 : 1));
  }

  protected updateAttack(dt: number, ctx: GameContext, root: THREE.Vector3): void {
    const a = this.attack!;
    const t = this.stateTime;
    // Tracking toward target before the strike lands.
    if (this.target && a.track && t < a.hitStart) {
      this.faceTowards(this.target.pos.x, this.target.pos.z, a.track * dt * this.animSpeed);
    }
    // Root-motion lunge, suppressed when already in the target's face.
    if (a.lunge) {
      const close = this.target && this.target.alive && this.distanceTo(this.target) < this.radius + this.target.radius + 0.35;
      for (const [s, e, v] of a.lunge) {
        if (t >= s && t <= e && !close) root.addScaledVector(this.forward, v * Math.min(this.scale, 1.4) * this.animSpeed);
      }
    }
    // Sound cues
    a.sfxAt?.forEach((at, i) => {
      const key = `sfx${i}`;
      if (t >= at && !this.firedEvents.has(key)) {
        this.firedEvents.add(key);
        if (this.pos.distanceTo(ctx.player.pos) < 30) audio.swing(!!a.heavy);
      }
    });
    a.rehit?.forEach((at, i) => {
      const key = `rehit${i}`;
      if (t >= at && !this.firedEvents.has(key)) {
        this.firedEvents.add(key);
        this.hitSet.clear();
      }
    });
    this.trail.active = t >= a.hitStart - 0.06 && t <= a.hitEnd + 0.04;
    processAttack(this, a, ctx);

    const chainAt = a.chainAt ?? Infinity;
    if (t >= chainAt && this.wantsChain()) {
      const next = a.next ? this.attacks[a.next] : null;
      if (next) {
        this.startAttack(next, 0.06);
        return;
      }
    }
    if (t >= a.duration) this.onStateEnd(ctx);
  }

  /** Whether to continue into `attack.next` once chainAt is reached. */
  protected wantsChain(): boolean {
    return false;
  }

  protected locomotionPose(root: THREE.Vector3): Pose {
    const fwd = this.forward;
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const ms = this.maxSpeed;
    const f = clamp(root.dot(fwd) / ms, -1, 1);
    const s = clamp(-root.dot(right) / ms, -1, 1);
    const speed = clamp(Math.hypot(root.x, root.z) / ms, 0, 1);
    const sprint = clamp((Math.hypot(root.x, root.z) - ms) / (ms * 0.5), 0, 1);
    const base = this.blocking ? BLOCK : this.basePose;
    let p = locomotion(base, { phase: this.locoPhase, forward: speed > 0.01 ? f / speed : 0, side: speed > 0.01 ? s / speed : 0, speed, sprint });
    p = breathe(p, ctx_time(), 1 - speed);
    return p;
  }

  protected evaluatePose(root: THREE.Vector3): Pose {
    const t = this.stateTime;
    switch (this.state) {
      case 'move':
        return this.locomotionPose(root);
      case 'attack':
        return sampleClip(this.attack!.clip, t);
      case 'roll':
        return sampleClip(ROLL_CLIP, t);
      case 'backstep':
        return sampleClip(BACKSTEP_CLIP, t);
      case 'stagger':
        return sampleClip(STAGGER_CLIP, t);
      case 'parried':
        return sampleClip(PARRIED_CLIP, t);
      case 'knockdown':
        return sampleClip(KNOCKDOWN_CLIP, t);
      case 'heal':
        return sampleClip(HEAL_CLIP, t);
      case 'parry':
        return sampleClip(PARRY_CLIP, t);
      case 'blockstun': {
        const k = Math.sin(clamp(t / BLOCKSTUN_DURATION, 0, 1) * Math.PI);
        return blendPoses(BLOCK, { ...BLOCK, root: [0, -0.16, -0.12], spine: [-0.1, 0, 0], chest: [-0.1, 0.4, 0], lShoulder: [-0.6, -1.45, 0.4] }, k);
      }
      case 'dead':
        return sampleClip(DEATH_CLIP, t);
      case 'rest':
        return REST_POSE;
    }
  }

  protected animate(dt: number, root: THREE.Vector3): void {
    let pose = this.evaluatePose(root);
    if (this.trans) {
      this.trans.t += dt;
      const k = this.trans.t / this.trans.dur;
      if (k >= 1) this.trans = null;
      else pose = blendPoses(this.trans.from, pose, k * k * (3 - 2 * k));
    }
    this.lastPose = pose;
    this.rig.applyPose(pose);
    this.rig.root.position.copy(this.pos);
    this.rig.root.rotation.y = this.yaw;
    this.rig.updateCape(Math.hypot(root.x, root.z), ctx_time());
    this.rig.update(dt);
  }

  /** Apply incoming damage. Returns true if the actor died. */
  applyDamage(dmg: number, ctx: GameContext, killer: Actor | null): boolean {
    if (!this.alive) return false;
    this.hp = Math.max(0, this.hp - dmg);
    this.rig.hitFlash();
    if (this.hp <= 0) {
      this.die(ctx, killer);
      return true;
    }
    return false;
  }

  die(ctx: GameContext, killer: Actor | null): void {
    this.setState('dead', 0.08);
    this.deathTime = 0;
    this.blocking = false;
    ctx.onActorKilled(this, killer);
  }

  /** React to a poise-breaking hit. */
  stagger(from: THREE.Vector3, strength: number): void {
    if (!this.alive) return;
    this.setState('stagger', 0.05);
    this.faceTowards(from.x, from.z);
    const dir = new THREE.Vector3(this.pos.x - from.x, 0, this.pos.z - from.z).normalize();
    this.knock.addScaledVector(dir, strength);
  }

  getParried(): void {
    this.setState('parried', 0.05);
  }

  knockdown(): void {
    this.setState('knockdown', 0.05);
  }

  /** Reset to full health at a position (used on respawn). */
  reset(x: number, z: number, yaw: number): void {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.poise = this.maxPoise;
    this.knock.set(0, 0, 0);
    this.moveVel.set(0, 0, 0);
    this.target = null;
    this.blocking = false;
    this.lastPose = this.basePose;
    this.trans = null;
    this.state = 'move';
    this.stateTime = 0;
    this.attack = null;
    this.rig.setOpacity(1);
    this.rig.setVisible(true);
  }
}

let __time = 0;
/** Global animation clock (seconds), advanced by the game loop. */
export function ctx_time(): number {
  return __time;
}
export function advanceAnimClock(dt: number): void {
  __time += dt;
}
