import * as THREE from 'three';
import type { Ctx } from './ctx';
import { ARENA } from './world';
import { EL_COLOR, EL_HEX, type Element } from './elements';
import { makeItem } from './items';

export type ProjKind = 'arrow' | 'orb' | 'fireball';
type Owner = 'enemy' | 'player';

/** Tapered trail: radius 0 at tail (z=0) → 1 at head (z=1), alpha ramps with z. */
const trailGeo = (() => {
  const g = new THREE.CylinderGeometry(1, 0, 1, 6, 4, true);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    col.set([1, 1, 1, z * z], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
})();

const G = {
  shaft: new THREE.CylinderGeometry(0.013, 0.013, 0.78, 4).rotateX(Math.PI / 2),
  head: new THREE.ConeGeometry(0.04, 0.13, 4).rotateX(Math.PI / 2).translate(0, 0, 0.45),
  fletch: new THREE.BoxGeometry(0.004, 0.08, 0.15).translate(0, 0, -0.32),
  core: new THREE.IcosahedronGeometry(0.15, 1),
  shell: new THREE.IcosahedronGeometry(0.3, 1),
};
const M = {
  shaft: new THREE.MeshStandardMaterial({ color: 0x4a2f22, roughness: 0.8, flatShading: true }),
  head: new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.5, flatShading: true }),
  fletch: new THREE.MeshStandardMaterial({ color: 0xd81f26, roughness: 0.9, side: THREE.DoubleSide }),
  orbCore: new THREE.MeshBasicMaterial({ color: 0xffd0f6, toneMapped: false }),
  orbShell: new THREE.MeshBasicMaterial({ color: 0xe0249a, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
  fireCore: new THREE.MeshBasicMaterial({ color: 0xfff0b0, toneMapped: false }),
  fireShell: new THREE.MeshBasicMaterial({ color: 0xff6a12, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false }),
};

const TRAIL_COLOR: Record<string, number> = {
  'enemy-arrow': 0xb0141c,
  'enemy-orb': 0xd0208e,
  'player-arrow': 0x2fa8ff,
  'player-orb': 0x2fa8ff,
  'player-fireball': 0xff7a1a,
};
function trailColor(p: { kind: ProjKind; owner: Owner; element: Element }): number {
  if (p.element !== 'none' && p.kind !== 'fireball') return EL_HEX[p.element];
  return TRAIL_COLOR[`${p.owner}-${p.kind}`] ?? 0x2fa8ff;
}
const shellMats = new Map<number, THREE.MeshBasicMaterial>();
function shellMat(color: number): THREE.MeshBasicMaterial {
  let m = shellMats.get(color);
  if (!m) {
    m = M.orbShell.clone();
    m.color.setHex(color);
    shellMats.set(color, m);
  }
  return m;
}

const C = {
  orb: new THREE.Color(0xff3ac0),
  fire: new THREE.Color(0xff8a2a),
  fireHot: new THREE.Color(0xffd27a),
  player: new THREE.Color(0x7fd0ff),
  spark: new THREE.Color(0xfff0c0),
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Projectile {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  origin = new THREE.Vector3();
  mesh: THREE.Object3D;
  trail: THREE.Mesh;
  trailMat: THREE.MeshBasicMaterial;
  radius: number;
  maxTrail: number;
  trailWidth: number;
  stuck = false;
  stuckT = 0;
  age = 0;
  emitAcc = 0;
  shell: THREE.Mesh | null = null;
  damage = 2;
  /** bursts into its element on impact (staff shots) */
  burst = false;

  constructor(public kind: ProjKind, public owner: Owner, public element: Element = 'none') {
    if (kind === 'arrow') {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(G.shaft, M.shaft), new THREE.Mesh(G.head, M.head));
      const f1 = new THREE.Mesh(G.fletch, M.fletch);
      const f2 = new THREE.Mesh(G.fletch, M.fletch);
      f2.rotation.z = Math.PI / 2;
      g.add(f1, f2);
      g.scale.setScalar(1.35);
      this.mesh = g;
      this.radius = 0.06;
      this.maxTrail = 9;
      this.trailWidth = 0.055;
    } else {
      const fire = kind === 'fireball';
      const g = new THREE.Group();
      g.add(new THREE.Mesh(G.core, fire ? M.fireCore : M.orbCore));
      this.shell = new THREE.Mesh(G.shell, fire ? M.fireShell : M.orbShell);
      g.add(this.shell);
      if (fire) g.scale.setScalar(1.2);
      this.mesh = g;
      this.radius = fire ? 0.3 : 0.24;
      this.maxTrail = fire ? 5 : 4;
      this.trailWidth = fire ? 0.2 : 0.16;
    }
    this.trailMat = new THREE.MeshBasicMaterial({
      color: trailColor(this),
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      vertexColors: true,
    });
    this.trail = new THREE.Mesh(trailGeo, this.trailMat);
    this.trail.frustumCulled = false;
    this.recolor();
  }

  /** Match shell / trail colours to the current owner and element. */
  recolor(): void {
    this.trailMat.color.setHex(trailColor(this));
    if (this.shell && this.kind === 'orb') {
      if (this.element !== 'none') this.shell.material = shellMat(EL_HEX[this.element]);
      else this.shell.material = this.owner === 'player' ? shellMat(0x3aaaff) : M.orbShell;
    }
  }

  get sparkColor(): THREE.Color {
    if (this.kind === 'fireball') return Math.random() < 0.5 ? C.fire : C.fireHot;
    if (this.element !== 'none') return EL_COLOR[this.element];
    return this.owner === 'enemy' ? C.orb : C.player;
  }
}

export class Projectiles {
  list: Projectile[] = [];
  ctx!: Ctx;
  private light: THREE.PointLight;
  private lightT = 0;

  constructor(private scene: THREE.Scene) {
    this.light = new THREE.PointLight(0xff8a3a, 0, 16, 1.4);
    scene.add(this.light);
  }

  spawn(kind: ProjKind, owner: Owner, pos: THREE.Vector3, vel: THREE.Vector3, element: Element = 'none', damage = 2): Projectile {
    const p = new Projectile(kind, owner, element);
    p.damage = damage;
    p.pos.copy(pos);
    p.origin.copy(pos);
    p.vel.copy(vel);
    this.scene.add(p.mesh, p.trail);
    this.list.push(p);
    this.updateVisual(p);
    return p;
  }

  remove(p: Projectile): void {
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(p.mesh, p.trail);
    p.trailMat.dispose();
  }

  clear(): void {
    for (const p of [...this.list]) this.remove(p);
    this.light.intensity = 0;
  }

  /** Hand an enemy projectile over to the player. */
  turn(p: Projectile, damage: number): void {
    p.owner = 'player';
    p.damage = damage;
    p.origin.copy(p.pos);
    p.recolor();
  }

  /** Direction from `from` along `fwd`, nudged toward the best-aligned enemy. */
  aimAssist(from: THREE.Vector3, fwd: THREE.Vector3, minDot: number): THREE.Vector3 {
    let best = minDot;
    const out = new THREE.Vector3().copy(fwd);
    for (const e of this.ctx.enemies) {
      if (!e.alive) continue;
      tmp.set(e.pos.x, 1.25, e.pos.z).sub(from);
      const d = tmp.length();
      if (d < 0.5) continue;
      tmp.divideScalar(d);
      const dot = tmp.dot(fwd);
      if (dot > best) {
        best = dot;
        out.copy(tmp);
      }
    }
    return out.normalize();
  }

  explode(pos: THREE.Vector3, damage = 4): void {
    const ctx = this.ctx;
    ctx.particles.burst(pos, 46, C.fire, 9, 0.12, 0.9, 1.5);
    ctx.particles.burst(pos, 20, C.fireHot, 5, 0.18, 0.6);
    this.light.position.copy(pos);
    this.light.intensity = 60;
    this.lightT = 0.5;
    for (const e of [...ctx.enemies]) {
      if (!e.alive) continue;
      tmp.set(e.pos.x - pos.x, 1 - pos.y, e.pos.z - pos.z);
      if (tmp.length() < 3.2) ctx.damageEnemy(e, damage, 'fire', tmp.setY(0.6).normalize().clone(), 9, { knock: 5 });
    }
    for (const p of [...this.list]) {
      if (p.owner === 'enemy' && p.pos.distanceTo(pos) < 3) {
        ctx.particles.burst(p.pos, 6, C.spark, 3, 0.06, 0.4);
        this.remove(p);
      }
    }
    ctx.explosion(pos);
  }

  private impactWorld(p: Projectile): void {
    const ctx = this.ctx;
    if (p.owner === 'enemy' && p.element === 'fire') {
      // fire shots burst where they land: stand clear
      ctx.particles.burst(p.pos, 30, C.fire, 6, 0.1, 0.7, 1.5);
      ctx.particles.burst(p.pos, 12, C.fireHot, 3, 0.14, 0.5);
      this.light.position.copy(p.pos);
      this.light.intensity = 40;
      this.lightT = 0.4;
      ctx.explosion(p.pos);
      const pl = ctx.player;
      if (pl.alive && Math.hypot(p.pos.x - pl.pos.x, p.pos.z - pl.pos.z) < 1.7 && p.pos.y < 2.6) ctx.playerHit(p.pos, 'fire');
      this.remove(p);
      return;
    }
    if (p.burst) {
      ctx.burst(p.pos, p.element, false);
      this.remove(p);
    } else if (p.kind === 'arrow') {
      // a spent arrow stays where it lands and can be picked up again
      p.pos.y = Math.max(p.pos.y, 0.12);
      const it = ctx.items.spawn(makeItem('arrow'), p.pos, 'rest');
      it.stuck = true;
      it.group.quaternion.setFromUnitVectors(tmp.set(0, 1, 0), tmp2.copy(p.vel).normalize());
      ctx.sfx.thunk(ctx.pan(p.pos));
      ctx.particles.burst(p.pos, 5, C.spark, 2, 0.04, 0.3);
      this.remove(p);
    } else if (p.kind === 'fireball') {
      this.explode(p.pos, p.damage);
      this.remove(p);
    } else {
      ctx.particles.burst(p.pos, 18, p.sparkColor, 4, 0.08, 0.6);
      ctx.sfx.fizz(ctx.pan(p.pos));
      this.remove(p);
    }
  }

  /** Returns true when the projectile is finished (removed or stuck). */
  private collide(p: Projectile): boolean {
    const ctx = this.ctx;
    const pos = p.pos;
    if (pos.y <= 0.03 || Math.abs(pos.x) > ARENA + 1 || Math.abs(pos.z) > ARENA + 1 || pos.y > 14) {
      this.impactWorld(p);
      return true;
    }
    for (const c of ctx.colliders) {
      if (pos.y < c.h) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) {
          this.impactWorld(p);
          return true;
        }
      }
    }
    const pl = ctx.player;
    if (p.owner === 'enemy') {
      if (!pl.alive) return false;
      tmp.copy(pos).sub(pl.eye);
      const dist = tmp.length();
      if (dist < 2.6) {
        const facing = tmp.divideScalar(dist).dot(pl.forward);
        const magic = p.kind !== 'arrow';
        if (pl.swingActive && dist < 2.3 && facing > 0.45) {
          // a swing cuts the shot out of the air
          ctx.blocked(pos, magic, false);
          this.remove(p);
          return true;
        }
        if (pl.blocking && dist < 1.5 && facing > 0.25) {
          ctx.blocked(pos, magic, true);
          this.remove(p);
          return true;
        }
      }
      const dx = pos.x - pl.pos.x, dz = pos.z - pl.pos.z;
      const rr = 0.28 + p.radius;
      if (dx * dx + dz * dz < rr * rr && pos.y > 0.1 && pos.y < 1.85) {
        ctx.playerHit(pos, p.element);
        this.remove(p);
        return true;
      }
    } else {
      for (const e of ctx.enemies) {
        if (!e.alive) continue;
        const dx = pos.x - e.pos.x, dz = pos.z - e.pos.z;
        const rr = 0.45 + p.radius;
        if (dx * dx + dz * dz < rr * rr && pos.y < 2.0) {
          if (p.kind === 'fireball') {
            this.explode(pos, p.damage);
          } else {
            if (p.kind === 'orb') ctx.particles.burst(pos, 12, p.sparkColor, 4, 0.07, 0.5);
            const dir = tmp2.copy(p.vel).normalize().clone();
            ctx.damageEnemy(e, p.damage, p.element, dir, 7, { chain: 1, from: p.origin });
            if (p.burst) ctx.burst(pos, p.element, false);
          }
          this.remove(p);
          return true;
        }
      }
    }
    return false;
  }

  update(dt: number, realDt: number): void {
    const ctx = this.ctx;
    if (this.lightT > 0) {
      this.lightT -= realDt;
      this.light.intensity = Math.max(0, this.lightT / 0.5) * 60;
    }
    for (const p of [...this.list]) {
      if (p.stuck) {
        p.stuckT += realDt;
        p.trailMat.opacity = Math.max(0, 0.55 - p.stuckT * 1.5);
        if (p.stuckT > 6) this.remove(p);
        continue;
      }
      p.age += dt;
      if (p.age > 15) {
        this.remove(p);
        continue;
      }
      const step = p.vel.length() * dt;
      const n = Math.max(1, Math.ceil(step / 0.2));
      const sub = dt / n;
      let done = false;
      for (let s = 0; s < n && !done; s++) {
        p.pos.addScaledVector(p.vel, sub);
        done = this.collide(p);
      }
      if (!this.list.includes(p)) continue;
      // magical sparkle trail (emits on world time so it freezes with the world)
      if (p.kind !== 'arrow' || p.element !== 'none') {
        p.emitAcc += dt;
        const fire = p.kind === 'fireball';
        while (p.emitAcc > 0.025) {
          p.emitAcc -= 0.025;
          const col = p.sparkColor;
          ctx.particles.spark(
            p.pos,
            (Math.random() - 0.5) * 1.2, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.2,
            col, fire ? 0.09 : 0.06, 0.6, fire ? -1 : 0,
          );
        }
        if (p.shell) p.shell.scale.setScalar(1 + Math.sin(p.age * 30) * 0.12);
      }
      this.updateVisual(p);
    }
  }

  private updateVisual(p: Projectile): void {
    p.mesh.position.copy(p.pos);
    if (p.vel.lengthSq() > 1e-6) p.mesh.lookAt(tmp.copy(p.pos).add(p.vel));
    const len = Math.min(p.pos.distanceTo(p.origin), p.maxTrail);
    if (len < 0.05) {
      p.trail.visible = false;
      return;
    }
    p.trail.visible = true;
    tmp.copy(p.vel).normalize();
    p.trail.position.copy(p.pos).addScaledVector(tmp, -len);
    p.trail.lookAt(p.pos);
    p.trail.scale.set(p.trailWidth, p.trailWidth, len);
  }
}
