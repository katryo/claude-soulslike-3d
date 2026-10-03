import * as THREE from 'three';
import { clamp, damp, lerpAngle, yawTo } from './math';
import type { Input } from './Input';
import type { CollisionWorld } from '../world/Collision';
import type { Actor } from '../entities/Actor';

/** Third-person orbit camera with lock-on framing, collision and trauma shake. */
export class CameraRig {
  yaw = Math.PI;
  pitch = 0.28;
  distance = 4.6;
  private focus = new THREE.Vector3();
  private trauma = 0;
  private time = 0;
  private lookAt = new THREE.Vector3();
  private curDist = 4.6;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  snap(player: Actor, yaw: number): void {
    this.yaw = yaw;
    this.pitch = 0.28;
    this.focus.set(player.pos.x, 1.55, player.pos.z);
    this.curDist = this.distance;
  }

  shake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, player: Actor, target: Actor | null, input: Input | null, col: CollisionWorld, scripted?: { yaw: number; pitch: number; dist: number }): void {
    this.time += dt;
    const fy = player.state === 'rest' ? 1.0 : 1.55;
    const fk = damp(12, dt);
    this.focus.x += (player.pos.x - this.focus.x) * fk;
    this.focus.z += (player.pos.z - this.focus.z) * fk;
    this.focus.y += (fy - this.focus.y) * damp(4, dt);

    let wantDist = this.distance;
    if (scripted) {
      this.yaw = lerpAngle(this.yaw, scripted.yaw, damp(2, dt));
      this.pitch += (scripted.pitch - this.pitch) * damp(2, dt);
      wantDist = scripted.dist;
    } else if (target && target.alive) {
      const ty = yawTo(target.pos.x - player.pos.x, target.pos.z - player.pos.z);
      this.yaw = lerpAngle(this.yaw, ty, damp(8, dt));
      const d = Math.max(1, player.distanceTo(target));
      const th = 1.3 * target.scale;
      const wantPitch = clamp(0.22 + Math.atan2(th - 1.5, d + this.distance) * 0.8 + (target.scale > 1.5 ? 0.06 : 0), 0.05, 0.7);
      this.pitch += (wantPitch - this.pitch) * damp(6, dt);
      if (target.scale > 1.5) wantDist = this.distance + 1.2;
    } else if (input) {
      this.yaw -= input.lookX;
      this.pitch = clamp(this.pitch + input.lookY, -0.45, 1.2);
    }

    // Camera direction: looks along (sin yaw, ·, cos yaw)
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, -sp, Math.cos(this.yaw) * cp);

    // Collision: shorten the boom when something is between focus and camera.
    const back = new THREE.Vector3(-dir.x, 0, -dir.z);
    const bl = back.length();
    let allowed = wantDist;
    if (bl > 1e-4) {
      back.divideScalar(bl);
      const hit = col.raycast(this.focus.x, this.focus.z, back.x, back.z, wantDist * bl + 0.4);
      if (hit < Infinity) allowed = Math.max(0.8, (hit - 0.35) / bl);
    }
    // Pull in fast, ease out slowly.
    this.curDist += (allowed - this.curDist) * damp(allowed < this.curDist ? 20 : 3, dt);

    const pos = this.focus.clone().addScaledVector(dir, -this.curDist);
    pos.y = Math.max(0.35, pos.y);

    // Look point: when locked on, bias toward the target.
    this.lookAt.copy(this.focus);
    if (target && target.alive && !scripted) {
      const tp = new THREE.Vector3(target.pos.x, 1.2 * target.scale, target.pos.z);
      this.lookAt.lerp(tp, 0.25);
    }

    // Shake (trauma²)
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const n = (k: number) => Math.sin(this.time * 37 + k) * Math.sin(this.time * 23 + k * 3);
    pos.x += n(1) * s * 0.35;
    pos.y += n(2) * s * 0.35;
    pos.z += n(3) * s * 0.35;

    this.camera.position.copy(pos);
    this.camera.lookAt(this.lookAt);
    this.camera.rotateZ(n(4) * s * 0.05);
  }
}
