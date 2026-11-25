import type * as THREE from 'three';
import type { Sfx } from './audio';
import type { Particles } from './particles';
import type { Projectiles } from './projectiles';
import type { Enemy } from './enemies';
import type { Collider } from './world';
import type { Element } from './elements';
import type { SkillId } from './skills';
import type { Items } from './items';

export interface PlayerState {
  /** Feet position */
  pos: THREE.Vector3;
  /** Eye (camera) position */
  eye: THREE.Vector3;
  /** Camera look direction */
  forward: THREE.Vector3;
  /** Look direction flattened on XZ */
  flatForward: THREE.Vector3;
  /** Holding a shield: frontal shots and blows are stopped. */
  blocking: boolean;
  swingActive: boolean;
  alive: boolean;
}

export interface DamageOpts {
  /** Damage over time / indirect: no status, no hit-stop */
  dot?: boolean;
  /** Extra lightning jumps left */
  chain?: number;
  /** Freeze duration for frost hits */
  freeze?: number;
  knock?: number;
  seen?: Set<Enemy>;
  /** Where the blow comes from; lets a raised shield stop it. */
  from?: THREE.Vector3;
  /** A thrown object: staggers even through a shield. */
  thrown?: boolean;
  /** Smashes shields instead of bouncing off. */
  heavy?: boolean;
}

export type HitResult = 'hit' | 'kill' | 'blocked' | 'immune' | 'none';

/** Shared game context passed to subsystems. */
export interface Ctx {
  scene: THREE.Scene;
  sfx: Sfx;
  particles: Particles;
  projectiles: Projectiles;
  items: Items;
  enemies: Enemy[];
  colliders: Collider[];
  player: PlayerState;
  realTime: number;
  level: number;
  mobile: boolean;
  skills: Record<SkillId, number>;
  pan(pos: THREE.Vector3): number;
  damageEnemy(e: Enemy, dmg: number, el: Element, dir: THREE.Vector3, power: number, opts?: DamageOpts): HitResult;
  killEnemy(e: Enemy, dir: THREE.Vector3, power: number): void;
  playerHit(from: THREE.Vector3, el: Element): void;
  /** A projectile was stopped by the player's shield (`shield`) or cut by a swing. */
  blocked(pos: THREE.Vector3, magic: boolean, shield: boolean): void;
  /** Elemental burst (flask, frost orb, dying elemental). */
  burst(pos: THREE.Vector3, el: Element, big: boolean): void;
  enemyBlocked(e: Enemy): void;
  explosion(pos: THREE.Vector3): void;
}
