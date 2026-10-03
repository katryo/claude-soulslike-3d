import type { Effects } from '../fx/Effects';
import type { CollisionWorld } from '../world/Collision';
import type { Actor } from './Actor';

/** Services shared by every actor during a simulation step. */
export interface GameContext {
  fx: Effects;
  collision: CollisionWorld;
  actors: Actor[];
  player: Actor;
  time: number;
  shake(amount: number): void;
  hitstop(seconds: number): void;
  onActorKilled(victim: Actor, killer: Actor | null): void;
}
