import * as THREE from 'three';
import type { Ctx } from './ctx';
import { ARENA } from './world';

export type EnemyKind = 'archer' | 'mage' | 'sword';

const G = {
  leg: new THREE.BoxGeometry(0.17, 0.8, 0.2).translate(0, -0.4, 0),
  torso: new THREE.CylinderGeometry(0.3, 0.2, 0.74, 6),
  head: new THREE.IcosahedronGeometry(0.19, 0),
  arm: new THREE.BoxGeometry(0.12, 0.62, 0.12).translate(0, -0.29, 0),
  hood: new THREE.ConeGeometry(0.25, 0.45, 6),
  hat: new THREE.ConeGeometry(0.27, 0.66, 6),
  brim: new THREE.CylinderGeometry(0.36, 0.36, 0.04, 6),
  robe: new THREE.ConeGeometry(0.44, 1.05, 6),
  helmet: new THREE.CylinderGeometry(0.2, 0.23, 0.28, 6),
  crest: new THREE.BoxGeometry(0.04, 0.16, 0.34),
  bow: new THREE.TorusGeometry(0.45, 0.028, 3, 10, Math.PI),
  quiver: new THREE.CylinderGeometry(0.08, 0.07, 0.55, 5),
  staff: new THREE.CylinderGeometry(0.025, 0.03, 1.7, 5),
  staffGem: new THREE.OctahedronGeometry(0.09, 0),
  blade: new THREE.BoxGeometry(0.075, 0.95, 0.025).translate(0, 0.55, 0),
  guard: new THREE.BoxGeometry(0.26, 0.04, 0.05),
  shield: new THREE.BoxGeometry(0.5, 0.64, 0.07),
  charge: new THREE.IcosahedronGeometry(0.13, 1),
};

function crystal(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.16,
    metalness: 0.08,
    flatShading: true,
    emissive: new THREE.Color(color).multiplyScalar(0.22),
  });
}
const M = {
  archer: crystal(0xe3262c),
  mage: crystal(0xd01f63),
  sword: crystal(0xc4161d),
  dark: crystal(0x6e0c12),
  charge: new THREE.MeshBasicMaterial({
    color: 0xfff1a8,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }),
};

const RED = new THREE.Color(0xff3030);
const GOLD = new THREE.Color(0xffe08a);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Enemy {
  readonly group = new THREE.Group();
  readonly parts: THREE.Mesh[] = [];
  readonly vel = new THREE.Vector3();
  alive = true;
  state = 'spawn';
  t = 0;
  spawnT = 0;
  stun = 0;
  yaw = 0;
  strafe = Math.random() < 0.5 ? -1 : 1;
  walk = 0;
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL: THREE.Group | null = null;
  private legR: THREE.Group | null = null;
  private charge: THREE.Mesh;
  private bladeMat: THREE.MeshStandardMaterial | null = null;
  private strikeT = 0;

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  constructor(public kind: EnemyKind, x: number, z: number) {
    const g = this.group;
    g.position.set(x, 0, z);
    g.scale.setScalar(0.001);
    const body = M[kind];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      parent.add(m);
      this.parts.push(m);
      return m;
    };

    if (kind === 'mage') {
      add(G.robe, body, g, 0, 0.53, 0);
    } else {
      this.legL = new THREE.Group();
      this.legR = new THREE.Group();
      this.legL.position.set(-0.12, 0.82, 0);
      this.legR.position.set(0.12, 0.82, 0);
      g.add(this.legL, this.legR);
      add(G.leg, body, this.legL, 0, 0, 0);
      add(G.leg, body, this.legR, 0, 0, 0);
    }
    add(G.torso, body, g, 0, 1.2, 0);
    add(G.head, body, g, 0, 1.74, 0);
    this.armL.position.set(-0.38, 1.5, 0);
    this.armR.position.set(0.38, 1.5, 0);
    g.add(this.armL, this.armR);
    add(G.arm, body, this.armL, 0, 0, 0);
    add(G.arm, body, this.armR, 0, 0, 0);

    this.charge = new THREE.Mesh(G.charge, M.charge);
    this.charge.visible = false;

    if (kind === 'archer') {
      add(G.hood, M.dark, g, 0, 1.88, -0.02);
      const q = add(G.quiver, M.dark, g, 0.1, 1.25, -0.26);
      q.rotation.z = 0.4;
      const bow = add(G.bow, M.dark, this.armL, 0, -0.6, 0.06);
      bow.rotation.set(0, -Math.PI / 2, Math.PI);
      this.charge.position.set(0, -0.62, 0.1);
      this.armL.add(this.charge);
    } else if (kind === 'mage') {
      add(G.hat, M.dark, g, 0, 2.08, 0);
      add(G.brim, M.dark, g, 0, 1.82, 0);
      add(G.staff, M.dark, this.armR, 0, -0.55, 0.08);
      add(G.staffGem, M.mage, this.armR, 0, 0.36, 0.08);
      this.charge.position.set(0, 0.36, 0.08);
      this.armR.add(this.charge);
    } else {
      add(G.helmet, M.dark, g, 0, 1.8, 0);
      add(G.crest, M.dark, g, 0, 1.98, 0);
      const sh = add(G.shield, M.dark, this.armL, 0, -0.4, 0.13);
      sh.rotation.y = 0.1;
      const holder = new THREE.Group();
      holder.position.set(0, -0.6, 0);
      holder.rotation.x = Math.PI / 2;
      this.armR.add(holder);
      this.bladeMat = M.dark.clone();
      add(G.blade, this.bladeMat, holder, 0, 0, 0);
      add(G.guard, M.dark, holder, 0, 0.06, 0);
      this.charge.position.set(0, 1.0, 0);
      holder.add(this.charge);
    }
  }

  dispose(): void {
    this.bladeMat?.dispose();
  }

  /** Chest position, used for aiming and effects. */
  chest(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, 1.25, this.pos.z);
  }

  update(dt: number, realDt: number, ctx: Ctx): void {
    const g = this.group;
    if (this.state === 'spawn') {
      this.spawnT += realDt;
      const k = Math.min(1, this.spawnT / 0.75);
      const s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // ease out back
      g.scale.setScalar(Math.max(0.001, s));
      if (Math.random() < realDt * 30) {
        ctx.particles.spark(
          tmp.set(this.pos.x + (Math.random() - 0.5) * 0.8, Math.random() * 2, this.pos.z + (Math.random() - 0.5) * 0.8),
          0, 1.5, 0, RED, 0.06, 0.8,
        );
      }
      if (k >= 1) {
        g.scale.setScalar(1);
        this.state = 'move';
        this.t = 0.6 + Math.random() * 1.2;
      }
    }

    const pl = ctx.player;
    const dx = pl.pos.x - this.pos.x;
    const dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;
    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-7 * dt));
    g.rotation.y = this.yaw;

    // knockback slide (force push)
    const kb = this.vel.length();
    if (kb > 0.05) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.exp(-2.5 * dt));
    }

    let moveX = 0;
    let moveZ = 0;
    let speed = 0;
    let armLx = 0;
    let armRx = 0;
    let chargeK = 0;

    if (this.stun > 0) {
      this.stun -= dt;
      g.rotation.z = Math.sin(ctx.realTime * 18) * 0.05 * Math.min(1, this.stun);
      armRx = 0.4;
    } else if (this.state !== 'spawn' && pl.alive) {
      g.rotation.z = 0;
      this.t -= dt;
      if (this.kind === 'archer') {
        if (this.state === 'move') {
          const radial = dist < 7 ? -1 : dist > 13 ? 1 : 0;
          moveX = nx * radial + -nz * this.strafe * 0.8;
          moveZ = nz * radial + nx * this.strafe * 0.8;
          speed = 1.9;
          if (this.t <= 0) { this.state = 'aim'; this.t = 0.95; }
        } else if (this.state === 'aim') {
          chargeK = 1 - this.t / 0.95;
          armLx = -Math.PI / 2;
          armRx = -1.2 - chargeK * 0.4;
          if (this.t <= 0) {
            this.fire(ctx, 'arrow');
            this.state = 'recover';
            this.t = 0.45;
          }
        } else {
          armLx = -Math.PI / 2 * (this.t / 0.45);
          if (this.t <= 0) {
            this.state = 'move';
            this.t = 1.3 + Math.random() * 1.8;
            if (Math.random() < 0.4) this.strafe *= -1;
          }
        }
      } else if (this.kind === 'mage') {
        if (this.state === 'move') {
          const radial = dist < 6 ? -1 : dist > 12 ? 1 : 0;
          moveX = nx * radial + -nz * this.strafe;
          moveZ = nz * radial + nx * this.strafe;
          speed = 1.3;
          if (this.t <= 0) { this.state = 'cast'; this.t = 1.15; }
        } else if (this.state === 'cast') {
          chargeK = 1 - this.t / 1.15;
          armRx = -0.9 - chargeK * 0.5;
          armLx = -0.6;
          if (this.t <= 0) {
            this.fire(ctx, 'orb');
            this.state = 'recover';
            this.t = 0.6;
          }
        } else if (this.t <= 0) {
          this.state = 'move';
          this.t = 2 + Math.random() * 1.6;
          if (Math.random() < 0.5) this.strafe *= -1;
        }
      } else {
        // swordsman
        if (this.state === 'move') {
          const weave = Math.sin(ctx.realTime * 1.3 + this.strafe) * 0.35;
          moveX = nx - nz * weave;
          moveZ = nz + nx * weave;
          speed = dist > 2 ? 3.1 : 0;
          if (dist < 2.1) { this.state = 'windup'; this.t = 0.6; }
        } else if (this.state === 'windup') {
          chargeK = 1 - this.t / 0.6;
          armRx = -2.9 * Math.min(1, chargeK * 1.6);
          moveX = nx; moveZ = nz; speed = 0.6;
          if (this.t <= 0) {
            this.state = 'strike';
            this.t = 0.18;
            this.strikeT = 0;
            this.strike(ctx, dist);
          }
        } else if (this.state === 'strike') {
          this.strikeT += dt;
          armRx = -2.9 + Math.min(1, this.strikeT / 0.12) * 3.2;
          if (this.t <= 0) { this.state = 'recover'; this.t = 0.75; }
        } else {
          armRx = 0.3 * (this.t / 0.75);
          if (this.t <= 0) this.state = 'move';
        }
        if (this.bladeMat) this.bladeMat.emissive.setRGB(0.4 + chargeK * 2.5, chargeK * 1.6, chargeK * 0.4);
      }
    }

    // charge telegraph glow
    this.charge.visible = chargeK > 0;
    if (chargeK > 0) this.charge.scale.setScalar(0.3 + chargeK * 1.1 + Math.sin(ctx.realTime * 40) * 0.08 * chargeK);

    // locomotion
    if (speed > 0) {
      const l = Math.hypot(moveX, moveZ) || 1;
      this.pos.x += (moveX / l) * speed * dt;
      this.pos.z += (moveZ / l) * speed * dt;
      this.walk += speed * dt * 3.2;
    }
    this.resolveCollisions(ctx, kb);

    // limb animation
    const swing = speed > 0 ? Math.sin(this.walk) * 0.6 : 0;
    if (this.legL && this.legR) {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
    }
    const lerpK = 1 - Math.exp(-14 * dt);
    this.armL.rotation.x += ((armLx || -swing * 0.5) - this.armL.rotation.x) * lerpK;
    this.armR.rotation.x += ((armRx || swing * 0.5) - this.armR.rotation.x) * (this.state === 'strike' ? 1 : lerpK);
  }

  private resolveCollisions(ctx: Ctx, kb: number): void {
    const p = this.pos;
    for (const c of ctx.colliders) {
      const dx = p.x - c.x, dz = p.z - c.z;
      const min = c.r + 0.45;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
        if (kb > 6) { ctx.killEnemy(this, this.vel.clone().normalize(), kb * 0.6); return; }
        this.vel.multiplyScalar(0.3);
      }
    }
    for (const o of ctx.enemies) {
      if (o === this || !o.alive) continue;
      const dx = p.x - o.pos.x, dz = p.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.81 && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (0.9 - d) * 0.5;
        p.x += (dx / d) * push;
        p.z += (dz / d) * push;
      }
    }
    const lim = ARENA - 0.4;
    if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) {
      p.x = Math.max(-lim, Math.min(lim, p.x));
      p.z = Math.max(-lim, Math.min(lim, p.z));
      if (kb > 6) { ctx.killEnemy(this, this.vel.clone().normalize(), kb * 0.6); return; }
      this.vel.multiplyScalar(0.3);
    }
    // keep a little distance from the player
    const dx = p.x - ctx.player.pos.x, dz = p.z - ctx.player.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < 0.64 && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      p.x += (dx / d) * (0.8 - d);
      p.z += (dz / d) * (0.8 - d);
    }
  }

  private fire(ctx: Ctx, kind: 'arrow' | 'orb'): void {
    const from = this.charge.getWorldPosition(new THREE.Vector3());
    const target = tmp.set(ctx.player.pos.x, 1.3, ctx.player.pos.z);
    const spread = kind === 'arrow' ? 0.12 : 0.05;
    target.x += (Math.random() - 0.5) * spread;
    target.y += (Math.random() - 0.5) * spread;
    const dir = tmp2.copy(target).sub(from).normalize();
    if (kind === 'arrow') {
      ctx.projectiles.spawn('arrow', 'enemy', from, dir.multiplyScalar(17));
      ctx.sfx.arrowShot(ctx.pan(from));
    } else {
      const triple = ctx.wave >= 2 && Math.random() < 0.45;
      const angles = triple ? [-0.22, 0, 0.22] : [0];
      for (const a of angles) {
        const v = dir.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).multiplyScalar(7.5);
        ctx.projectiles.spawn('orb', 'enemy', from, v);
      }
      ctx.sfx.orbCast(ctx.pan(from));
    }
    ctx.particles.burst(from, 8, GOLD, 2, 0.05, 0.4);
  }

  private strike(ctx: Ctx, dist: number): void {
    ctx.sfx.swing();
    const pl = ctx.player;
    if (!pl.alive || dist > 2.5) return;
    // direction from player to enemy
    tmp.set(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z).normalize();
    if (pl.blocking && tmp.dot(pl.flatForward) > 0.35) {
      ctx.enemyBlocked(this);
    } else {
      ctx.playerHit(this.chest(tmp2));
    }
  }
}
