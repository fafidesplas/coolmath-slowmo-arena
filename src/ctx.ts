import type * as THREE from 'three';
import type { Sfx } from './audio';
import type { Particles } from './particles';
import type { Projectiles } from './projectiles';
import type { Enemy } from './enemies';
import type { Collider } from './world';

export interface PlayerState {
  /** Feet position */
  pos: THREE.Vector3;
  /** Eye (camera) position */
  eye: THREE.Vector3;
  /** Camera look direction */
  forward: THREE.Vector3;
  /** Look direction flattened on XZ */
  flatForward: THREE.Vector3;
  blocking: boolean;
  blockStart: number;
  swingActive: boolean;
  alive: boolean;
}

/** Shared game context passed to subsystems. */
export interface Ctx {
  scene: THREE.Scene;
  sfx: Sfx;
  particles: Particles;
  projectiles: Projectiles;
  enemies: Enemy[];
  colliders: Collider[];
  player: PlayerState;
  realTime: number;
  wave: number;
  mobile: boolean;
  pan(pos: THREE.Vector3): number;
  killEnemy(e: Enemy, dir: THREE.Vector3, power: number): void;
  playerHit(from: THREE.Vector3): void;
  deflected(pos: THREE.Vector3, perfect: boolean): void;
  enemyBlocked(e: Enemy): void;
  explosion(pos: THREE.Vector3): void;
}
