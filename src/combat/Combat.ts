import * as THREE from 'three';
import type { Actor } from '../entities/Actor';
import type { GameContext } from '../entities/Context';
import type { AoE, AttackDef } from './Attacks';
import { audio } from '../core/Audio';
import { BACKSTAB_MULTIPLIER, RIPOSTE_MULTIPLIER, blockStaminaCost, blockedDamage } from '../systems/Stats';

/** Front cone (half-angle) in which a shield or parry is effective. */
const GUARD_ARC = 1.25;

export type HitOutcome = 'immune' | 'parried' | 'blocked' | 'guardbreak' | 'hit' | 'killed';

/** Is `target` inside `attacker`'s weapon swing volume for this attack? */
export function inSwing(attacker: Actor, target: Actor, def: AttackDef): boolean {
  const dx = target.pos.x - attacker.pos.x;
  const dz = target.pos.z - attacker.pos.z;
  const dist = Math.hypot(dx, dz);
  const reach = def.range * attacker.scale + target.radius;
  if (dist > reach) return false;
  if (dist < attacker.radius + target.radius + 0.1) return true; // point blank
  const ang = Math.abs(attacker.angleTo(target.pos));
  // Widen the arc slightly for large targets.
  const angPad = Math.atan2(target.radius, dist);
  return ang <= def.arc + angPad;
}

function opponents(a: Actor, ctx: GameContext): Actor[] {
  return ctx.actors.filter((o) => o !== a && o.team !== a.team && o.alive && o.rig.root.visible);
}

/** Run hit detection, AoE and critical events for an actor mid-attack. */
export function processAttack(attacker: Actor, def: AttackDef, ctx: GameContext): void {
  const t = attacker.stateTime;

  if (def.id === 'riposte') {
    if (attacker.criticalVictim && !attacker.firedEvents.has('crit') && t >= def.hitStart) {
      attacker.firedEvents.add('crit');
      applyCritical(attacker, attacker.criticalVictim, ctx);
    }
    return;
  }

  if (t >= def.hitStart && t <= def.hitEnd) {
    for (const o of opponents(attacker, ctx)) {
      if (attacker.hitSet.has(o)) continue;
      if (!inSwing(attacker, o, def)) continue;
      resolveHit(attacker, o, def, ctx, def.damage * attacker.damageMult, def.poise, false);
    }
  }

  def.aoe?.forEach((aoe, i) => {
    const key = `aoe${i}`;
    if (t >= aoe.at && !attacker.firedEvents.has(key)) {
      attacker.firedEvents.add(key);
      triggerAoE(attacker, def, aoe, ctx);
    }
  });
}

function triggerAoE(attacker: Actor, def: AttackDef, aoe: AoE, ctx: GameContext): void {
  const c = attacker.pos.clone().addScaledVector(attacker.forward, aoe.forward * attacker.scale * 0.6);
  const radius = aoe.radius * attacker.scale * 0.75;
  if (aoe.fire) {
    ctx.fx.fireNova(c, radius);
    audio.fireBurst();
  } else {
    ctx.fx.shockwave(c, radius);
  }
  audio.slam();
  const d = c.distanceTo(ctx.player.pos);
  ctx.shake(Math.max(0, 0.6 - d * 0.03));
  for (const o of opponents(attacker, ctx)) {
    const dist = Math.hypot(o.pos.x - c.x, o.pos.z - c.z);
    if (dist > radius + o.radius) continue;
    if (attacker.hitSet.has(o) && !aoe.fire) continue; // already struck by the weapon itself
    resolveHit(attacker, o, def, ctx, aoe.damage * attacker.damageMult, aoe.poise, true, c);
  }
}

export function resolveHit(
  attacker: Actor,
  defender: Actor,
  def: AttackDef,
  ctx: GameContext,
  damage: number,
  poiseDamage: number,
  isAoe: boolean,
  origin: THREE.Vector3 = attacker.pos,
): HitOutcome {
  if (defender.invulnerable) return 'immune';
  attacker.hitSet.add(defender);

  const dir = new THREE.Vector3(defender.pos.x - origin.x, 0, defender.pos.z - origin.z);
  if (dir.lengthSq() < 1e-6) dir.copy(attacker.forward);
  dir.normalize();
  const hitPoint = defender.pos.clone().addScaledVector(dir, -defender.radius * 0.8);
  hitPoint.y = 1.25 * defender.scale;
  const facing = Math.abs(defender.angleTo(origin)) < GUARD_ARC;
  const playerInvolved = defender === ctx.player || attacker === ctx.player;

  // Parry
  if (defender.parryActive && def.parryable && !isAoe && facing) {
    attacker.getParried();
    attacker.hitSet.add(defender);
    audio.parry();
    ctx.fx.sparks(hitPoint, dir.clone().negate(), 40, [1, 0.85, 0.5]);
    ctx.hitstop(0.14);
    ctx.shake(0.25);
    return 'parried';
  }

  // Block
  const canBlock = defender.blocking && (defender.state === 'move' || defender.state === 'blockstun');
  if (canBlock && facing && !(isAoe && def.fire)) {
    const cost = blockStaminaCost(damage, !!def.heavy) * defender.blockStability;
    defender.useStamina(cost);
    const chip = blockedDamage(damage, defender.blockReduction);
    audio.clang();
    ctx.fx.sparks(hitPoint, dir.clone().negate(), 22);
    if (defender.stamina <= 0) {
      defender.stamina = 0;
      defender.blocking = false;
      defender.applyDamage(chip, ctx, attacker);
      if (defender.alive) {
        defender.getParried();
        defender.knock.addScaledVector(dir, 3);
      }
      ctx.hitstop(0.1);
      ctx.shake(0.3);
      return 'guardbreak';
    }
    const died = chip > 0 && defender.applyDamage(chip, ctx, attacker);
    if (!died) {
      defender.setState('blockstun', 0.04);
      defender.knock.addScaledVector(dir, def.heavy ? 4.5 : 2.2);
    }
    ctx.hitstop(def.heavy ? 0.08 : 0.05);
    if (playerInvolved) ctx.shake(def.heavy ? 0.25 : 0.1);
    return died ? 'killed' : 'blocked';
  }

  // Clean hit
  audio.hit(!!def.heavy);
  if (defender === ctx.player) audio.hurt();
  ctx.fx.blood(hitPoint, dir, def.heavy ? 30 : 16);
  ctx.fx.sparks(hitPoint, dir, 6, [1, 0.5, 0.25]);
  if (def.fire || (isAoe && def.fire)) ctx.fx.sparks(hitPoint, dir, 20, [1, 0.45, 0.1]);
  ctx.hitstop(def.heavy ? 0.1 : 0.065);
  if (playerInvolved) ctx.shake(defender === ctx.player ? (def.heavy ? 0.5 : 0.3) : def.heavy ? 0.22 : 0.12);

  const died = defender.applyDamage(damage, ctx, attacker);
  if (died) {
    defender.knock.addScaledVector(dir, 3);
    return 'killed';
  }
  defender.poiseTimer = 3;
  const armor = defender.hyperArmorActive ? 0.5 : 1;
  defender.poise -= poiseDamage * armor;
  if (defender.poise <= 0) {
    defender.poise = defender.maxPoise;
    // Staggering out of a riposte-able state is not allowed; keep the window.
    if (defender.state !== 'parried' && defender.state !== 'knockdown') {
      defender.stagger(origin, def.heavy ? 5 : 3);
    }
  } else {
    defender.knock.addScaledVector(dir, 1.2 / Math.max(1, defender.scale));
  }
  return 'hit';
}

function applyCritical(attacker: Actor, victim: Actor, ctx: GameContext): void {
  if (!victim.alive) return;
  const mult = attacker.critical === 'backstab' ? BACKSTAB_MULTIPLIER : RIPOSTE_MULTIPLIER;
  const base = (attacker.attacks.light1?.damage ?? 20) * attacker.damageMult;
  const dir = attacker.forward;
  const hp = victim.pos.clone();
  hp.y = 1.2 * victim.scale;
  audio.hit(true);
  ctx.fx.blood(hp, dir, 60);
  ctx.fx.sparks(hp, dir, 20, [1, 0.6, 0.3]);
  ctx.hitstop(0.18);
  ctx.shake(0.45);
  const died = victim.applyDamage(Math.round(base * mult), ctx, attacker);
  if (!died) victim.knockdown();
  attacker.critical = null;
  attacker.criticalVictim = null;
}
