import * as THREE from 'three';
import type { Ctx } from './ctx';
import { ARENA } from './world';
import { EL_COLOR, type Element } from './elements';
import { REST, aimBone, clip, createRig, rotateWorld, type Rig } from './rig';
import { TIP, buildItemMesh, makeItem, type ItemState } from './items';

export type EnemyKind = 'archer' | 'mage' | 'sword';

const G = {
  pelvis: new THREE.CylinderGeometry(0.21, 0.17, 0.2, 6),
  foot: new THREE.BoxGeometry(0.15, 0.09, 0.3),
  torso: new THREE.CylinderGeometry(0.3, 0.2, 0.58, 6),
  head: new THREE.IcosahedronGeometry(0.19, 0),
  pad: new THREE.IcosahedronGeometry(0.12, 0),
  hood: new THREE.ConeGeometry(0.25, 0.45, 6),
  hat: new THREE.ConeGeometry(0.27, 0.66, 6),
  brim: new THREE.CylinderGeometry(0.36, 0.36, 0.04, 6),
  robe: new THREE.ConeGeometry(0.46, 1.0, 6),
  helmet: new THREE.CylinderGeometry(0.2, 0.23, 0.28, 6),
  crest: new THREE.BoxGeometry(0.04, 0.16, 0.34),
  quiver: new THREE.CylinderGeometry(0.08, 0.07, 0.55, 5),
  charge: new THREE.IcosahedronGeometry(0.13, 1),
  crown: new THREE.OctahedronGeometry(0.07, 0),
  ice: new THREE.IcosahedronGeometry(0.62, 0).scale(1, 1.7, 1),
};
const limbGeo = new Map<string, THREE.BoxGeometry>();
function limb(len: number, th: number): THREE.BoxGeometry {
  const key = `${len.toFixed(3)}:${th}`;
  let g = limbGeo.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(th, len, th * 1.1);
    limbGeo.set(key, g);
  }
  return g;
}

function crystal(color: number, glow = 0.22): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.16,
    metalness: 0.08,
    flatShading: true,
    emissive: new THREE.Color(color).multiplyScalar(glow),
  });
}
const BODY: Record<Element, Record<EnemyKind, THREE.MeshStandardMaterial>> = {
  none: { archer: crystal(0xe3262c), mage: crystal(0xd01f63), sword: crystal(0xc4161d) },
  fire: { archer: crystal(0xff8a1e, 0.55), mage: crystal(0xffa726, 0.55), sword: crystal(0xff6a12, 0.55) },
  ice: { archer: crystal(0xa9ecff, 0.3), mage: crystal(0xc4f3ff, 0.3), sword: crystal(0x8fd6f5, 0.3) },
  storm: { archer: crystal(0xa66bff, 0.45), mage: crystal(0xc08cff, 0.45), sword: crystal(0x8f52f0, 0.45) },
};
const DARK: Record<Element, THREE.MeshStandardMaterial> = {
  none: crystal(0x6e0c12),
  fire: crystal(0x8a2a06),
  ice: crystal(0x3c7fb0),
  storm: crystal(0x3d1c8a),
};
const chargeMat = (color: number) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const CHARGE: Record<Element, THREE.MeshBasicMaterial> = {
  none: chargeMat(0xfff1a8),
  fire: chargeMat(0xffb060),
  ice: chargeMat(0xc8f4ff),
  storm: chargeMat(0xd9c2ff),
};
const ICE_MAT = new THREE.MeshStandardMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1, flatShading: true, emissive: 0x1d5f8f, depthWrite: false });

const RED = new THREE.Color(0xff3030);
const GOLD = new THREE.Color(0xffe08a);
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tq = new THREE.Quaternion();

// Attack clips: when the blow lands, when the follow-through ends, clip length; plus the AI timings they are stretched to
const ATK = {
  sword: { clip: 'Sword_Attack', hit: 0.36, end: 0.62, len: 1.53, wind: 0.6, trigger: 2.1, reach: 2.5 },
  punch: { clip: 'Punch_Cross', hit: 0.16, end: 0.34, len: 1.0, wind: 0.45, trigger: 1.7, reach: 2.0 },
};

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
  hp: number;
  frozen = 0;
  burn = 0;
  hitT = 0;
  lastSwing = -1;
  private burnAcc = 0;
  private auraAcc = 0;
  private seed = Math.random() * 10;
  private clock = 0;
  private rig: Rig;
  /** Turns hips and legs toward the direction of travel while the chest keeps facing the player. */
  private body = new THREE.Group();
  private hipYaw = 0;
  private aimW = 0;
  private mixer: THREE.AnimationMixer;
  private acts = new Map<string, THREE.AnimationAction>();
  private upper: THREE.AnimationAction | null = null;
  private lower: THREE.AnimationAction | null = null;
  /** What the knight holds; dropped when hit, and the player can take it. */
  weapon: ItemState | null = null;
  shieldHp = 0;
  private held: THREE.Group | null = null;
  private shieldG: THREE.Group | null = null;
  private bow: THREE.Group | null = null;
  /** Bones that get procedural rotations on top of the clips. */
  private proc: { bone: THREE.Object3D; pre: THREE.Quaternion; post: THREE.Quaternion }[] = [];
  private charge: THREE.Mesh;
  private iceShell: THREE.Mesh;

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  constructor(public kind: EnemyKind, x: number, z: number, public element: Element = 'none', hp = 2, shield = false) {
    this.hp = hp;
    const g = this.group;
    g.position.set(x, 0, z);
    g.scale.setScalar(0.001);
    const body = BODY[element][kind];
    const dark = DARK[element];
    const rig = (this.rig = createRig());
    this.body.add(rig.root);
    g.add(this.body);
    this.mixer = new THREE.AnimationMixer(rig.root);
    const H = (b: string) => rig.holder(b);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, px: number, py: number, pz: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      parent.add(m);
      this.parts.push(m);
      return m;
    };
    /** A box from joint `a` to joint `b`. */
    const seg = (a: string, b: string, th: number, mat: THREE.Material, extra = 0) => {
      const dir = tmp.copy(REST[b]).sub(REST[a]);
      const len = dir.length() + extra;
      dir.normalize();
      const m = add(limb(len, th), mat, H(a), dir.x * len / 2, dir.y * len / 2, dir.z * len / 2);
      m.quaternion.setFromUnitVectors(UP, dir);
      return m;
    };

    add(G.pelvis, dark, H('pelvis'), 0, 0.03, 0.04);
    if (kind === 'mage') {
      add(G.robe, body, H('pelvis'), 0, -0.36, 0.03);
    } else {
      for (const s of ['l', 'r']) {
        seg(`thigh_${s}`, `calf_${s}`, 0.18, body);
        seg(`calf_${s}`, `foot_${s}`, 0.15, body);
        add(G.foot, dark, H(`foot_${s}`), 0, -0.055, 0.08);
      }
    }
    add(G.torso, body, H('spine_02'), 0, 0.07, 0);
    add(G.head, body, H('Head'), 0, 0.15, 0.02);
    for (const s of ['l', 'r']) {
      seg(`upperarm_${s}`, `lowerarm_${s}`, 0.13, body);
      seg(`lowerarm_${s}`, `hand_${s}`, 0.11, body, 0.09);
      if (kind === 'sword') add(G.pad, dark, H(`upperarm_${s}`), 0, 0.04, 0);
    }

    this.charge = new THREE.Mesh(G.charge, CHARGE[element]);
    this.charge.visible = false;
    this.iceShell = new THREE.Mesh(G.ice, ICE_MAT);
    this.iceShell.position.y = 1.05;
    this.iceShell.visible = false;
    this.iceShell.rotation.y = Math.random() * 6;
    g.add(this.iceShell);

    const head = H('Head');
    if (kind === 'archer') {
      add(G.hood, dark, head, 0, 0.3, 0);
      const q = add(G.quiver, dark, H('spine_02'), -0.1, 0.14, -0.26);
      q.rotation.z = -0.4;
      // the bow follows the hand but keeps itself upright (see animate)
      this.weapon = makeItem('bow');
      this.bow = this.held = new THREE.Group();
      g.add(this.bow);
      this.bow.add(buildItemMesh(this.weapon));
      this.charge.position.set(0, 0, 0.06);
      this.bow.add(this.charge);
    } else {
      // held items: in the rest pose the fist's grip axis runs back-to-front (checked against Sword_Idle / Sword_Attack)
      const item = (this.held = new THREE.Group());
      item.position.set(-0.08, -0.02, 0);
      item.rotation.x = Math.PI / 2;
      H('hand_r').add(item);
      if (kind === 'mage') {
        add(G.hat, dark, head, 0, 0.5, 0);
        add(G.brim, dark, head, 0, 0.24, 0);
        this.weapon = makeItem('staff', element);
      } else {
        add(G.helmet, dark, head, 0, 0.22, 0.02);
        add(G.crest, dark, head, 0, 0.4, 0.02);
        this.weapon = makeItem('sword');
        if (element !== 'none') {
          // an elemental's blade keeps some of its bite
          this.weapon.imbue = element;
          this.weapon.imbueUses = 3;
        }
        if (shield) {
          this.shieldHp = 2;
          this.shieldG = new THREE.Group();
          this.shieldG.add(buildItemMesh(makeItem('shield')));
          g.add(this.shieldG);
        }
      }
      item.add(buildItemMesh(this.weapon));
      this.charge.position.set(0, TIP[this.weapon.kind], 0);
      item.add(this.charge);
    }
    if (element !== 'none') {
      // elementals wear a small crown of shards
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const c = add(G.crown, body, head, Math.sin(a) * 0.24, 0.47 + (kind === 'mage' ? 0.36 : 0), Math.cos(a) * 0.24);
        c.scale.set(1, 2.2, 1);
      }
    }
    this.proc = ['spine_01', 'spine_02', 'neck_01', 'upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r'].map((n) => ({
      bone: rig.bones[n],
      pre: rig.bones[n].quaternion.clone(),
      post: new THREE.Quaternion(9, 9, 9, 9),
    }));
    this.animate(0, 0, 0, 0, 0);
  }

  dispose(): void {
    this.mixer.stopAllAction();
  }

  /** Shield up and ready: frontal blows bounce off. Attacking, staggered or frozen knights are open. */
  get guarding(): boolean {
    return this.shieldHp > 0 && this.frozen <= 0 && this.stun <= 0 && (this.state === 'move' || this.state === 'spawn');
  }

  /** Would the shield stop a blow coming from `from`? */
  blocks(from: THREE.Vector3): boolean {
    if (!this.guarding) return false;
    tmp.set(from.x - this.pos.x, 0, from.z - this.pos.z).normalize();
    return tmp.x * Math.sin(this.yaw) + tmp.z * Math.cos(this.yaw) > 0.35;
  }

  /** The shield takes a blow; heavy ones split it. */
  hitShield(ctx: Ctx, heavy: boolean, dir: THREE.Vector3): void {
    this.shieldHp -= heavy ? 2 : 1;
    if (this.shieldHp > 0 || !this.shieldG) return;
    this.shieldHp = 0;
    this.shieldG.updateWorldMatrix(true, true);
    this.shieldG.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) ctx.particles.shatter(o as THREE.Mesh, dir, 5);
    });
    this.group.remove(this.shieldG);
    this.shieldG = null;
    this.stun = Math.max(this.stun, 0.9);
  }

  /** The weapon flies out of the knight's hand, toward the player so it can be caught. */
  dropWeapon(ctx: Ctx): void {
    if (!this.weapon || !this.held) return;
    const from = this.held.getWorldPosition(new THREE.Vector3());
    from.y = Math.max(0.9, from.y);
    this.fling(ctx, this.weapon, from);
    this.charge.visible = false;
    this.held.parent?.remove(this.held);
    this.held = this.bow = null;
    this.weapon = null;
    if (this.state !== 'spawn') { this.state = 'recover'; this.t = 0.5; }
  }

  dropAll(ctx: Ctx): void {
    this.dropWeapon(ctx);
    if (this.shieldG && this.shieldHp > 0) {
      this.fling(ctx, makeItem('shield', 'none', this.shieldHp * 3), this.shieldG.getWorldPosition(new THREE.Vector3()));
      this.group.remove(this.shieldG);
      this.shieldG = null;
      this.shieldHp = 0;
    }
  }

  private fling(ctx: Ctx, item: ItemState, from: THREE.Vector3): void {
    const pl = ctx.player.pos;
    const v = new THREE.Vector3(pl.x - from.x, 0, pl.z - from.z);
    const d = v.length() || 1;
    // lob it roughly a third of the way to the player, never past them
    v.multiplyScalar(Math.min(3.2, d * 0.32) / d);
    v.x += (Math.random() - 0.5) * 1.6;
    v.z += (Math.random() - 0.5) * 1.6;
    v.y = 5 + Math.random() * 1.2;
    ctx.items.spawn(item, from, 'flying', v);
  }

  private get attacking(): boolean {
    return this.state === 'windup' || this.state === 'strike' || (this.state === 'recover' && this.t <= 0.75);
  }

  /** Chest position, used for aiming and effects. */
  chest(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, 1.25, this.pos.z);
  }

  private play(slot: 'upper' | 'lower', name: string, fade = 0.2): THREE.AnimationAction {
    let next = this.acts.get(name);
    if (!next) {
      next = this.mixer.clipAction(clip(name));
      this.acts.set(name, next);
    }
    const cur = this[slot];
    if (cur !== next) {
      next.reset();
      next.setEffectiveTimeScale(1);
      next.setEffectiveWeight(1);
      // the very first clip must not blend in from the T-pose
      if (cur) {
        next.fadeIn(fade);
        cur.fadeOut(fade);
      }
      next.play();
      this[slot] = next;
    }
    return next;
  }

  /** Hold a clip at an exact moment (the AI drives attack timing, not the clip). */
  private scrub(slot: 'upper' | 'lower', name: string, time: number, fade = 0.12): void {
    const a = this.play(slot, name, fade);
    a.paused = true;
    a.time = Math.max(0, Math.min(a.getClip().duration - 0.001, time));
  }

  /** Pick clips for the current state, advance the mixer, then layer procedural touches on top. */
  private animate(dt: number, speed: number, lx: number, lz: number, chargeK: number): void {
    const { kind, state } = this;
    const b = this.rig.bones;
    // --- legs
    let hipTarget = 0;
    const armed = this.weapon !== null;
    const brawler = kind === 'sword' || !armed;
    const idle = armed && kind === 'sword' ? 'Sword_Idle' : 'Idle_Loop';
    if (brawler && this.attacking && this.stun <= 0) {
      const A = armed ? ATK.sword : ATK.punch;
      const tt = state === 'windup' ? (1 - this.t / A.wind) * A.hit
        : state === 'strike' ? A.hit + (1 - this.t / 0.18) * (A.end - A.hit)
        : A.end + (1 - this.t / 0.75) * (A.len - A.end);
      this.scrub('lower', `${A.clip}:L`, tt, 0.1);
      this.scrub('upper', `${A.clip}:U`, tt, 0.1);
    } else {
      if (speed > 0.1) {
        const back = lz < -0.25;
        hipTarget = Math.max(-1.1, Math.min(1.1, back ? Math.atan2(-lx, -lz) : Math.atan2(lx, Math.max(lz, 0.05))));
        const jog = speed > 2.5;
        const a = this.play('lower', jog ? 'Jog_Fwd_Loop:L' : 'Walk_Loop:L', 0.25);
        a.paused = false;
        a.setEffectiveTimeScale((back ? -1 : 1) * speed / (jog ? 3.3 : 1.45));
      } else {
        this.play('lower', `${idle}:L`, 0.3).paused = false;
      }
      // --- torso and arms
      if (this.stun > 0) {
        this.scrub('upper', 'Hit_Head:U', 0.2 + 0.14 * Math.sin(this.clock * 7 + this.seed), 0.1);
      } else if (this.hitT > 0) {
        this.scrub('upper', 'Hit_Chest:U', (1 - this.hitT) * 0.33, 0.04);
      } else if (kind === 'mage' && armed && state === 'cast') {
        const el = 1.15 - this.t;
        if (el < 0.45) this.scrub('upper', 'Spell_Simple_Enter:U', (el / 0.45) * 0.53, 0.1);
        else this.play('upper', 'Spell_Simple_Idle_Loop:U', 0.1).paused = false;
      } else if (kind === 'mage' && armed && state === 'recover' && this.t <= 0.6) {
        this.scrub('upper', 'Spell_Simple_Shoot:U', (1 - this.t / 0.6) * 0.5, 0.05);
      } else {
        this.play('upper', `${idle}:U`, 0.3).paused = false;
      }
    }
    this.mixer.update(dt);
    // The mixer only rewrites a bone when its value changes, so undo last frame's procedural
    // touches on bones it left alone (otherwise they would pile up while time is frozen).
    for (const st of this.proc) {
      if (st.bone.quaternion.equals(st.post)) st.bone.quaternion.copy(st.pre);
      else st.pre.copy(st.bone.quaternion);
    }

    // --- hips turn into the direction of travel, chest stays on the player
    const k = 1 - Math.exp(-9 * dt);
    this.hipYaw += (hipTarget - this.hipYaw) * (dt > 0 ? k : 1);
    this.body.rotation.y = this.hipYaw;
    this.body.rotation.z = this.stun > 0 ? Math.sin(this.clock * 9 + this.seed) * 0.07 : 0;
    this.body.position.y = kind === 'mage' ? 0.05 + Math.sin(this.clock * 2 + this.seed) * 0.05 : 0;
    if (Math.abs(this.hipYaw) > 0.01) rotateWorld(b.spine_01, tq.setFromAxisAngle(UP, -this.hipYaw));

    // --- archer: no bow clips in the pack, so the draw is posed on top of the idle/walk
    if (this.bow) {
      const aiming = state === 'aim' && this.stun <= 0;
      this.aimW += ((aiming ? 1 : 0) - this.aimW) * (dt > 0 ? 1 - Math.exp(-(aiming ? 9 : 14) * dt) : 0);
      const w = this.aimW;
      const yaw = this.group.rotation.y;
      const dir = (x: number, y: number, z: number) => tmp2.set(x, y, z).normalize().applyAxisAngle(UP, yaw);
      // carry pose: bow arm half raised in front
      aimBone(b.upperarm_l, b.lowerarm_l, dir(0.35, -0.75, 0.55), 1 - w);
      aimBone(b.lowerarm_l, b.hand_l, dir(-0.1, -0.2, 1), 1 - w);
      if (w > 0.01) {
        const draw = Math.min(1, chargeK * 2.2);
        const rel = state === 'aim' ? draw : 0;
        // side-on stance, bow arm straight at the target, string hand to the cheek
        rotateWorld(b.spine_02, tq.setFromAxisAngle(UP, -0.7 * w));
        rotateWorld(b.neck_01, tq.setFromAxisAngle(UP, 0.7 * w));
        aimBone(b.upperarm_l, b.lowerarm_l, dir(0.12, 0.04, 1), w);
        aimBone(b.lowerarm_l, b.hand_l, dir(0.02, 0.04, 1), w);
        aimBone(b.upperarm_r, b.lowerarm_r, dir(-0.25 - 0.65 * rel, 0.02, 1 - 1.4 * rel), w);
        aimBone(b.lowerarm_r, b.hand_r, dir(0.45 + 0.4 * rel, 0.12, 1 - 0.5 * rel), w);
      }
      // bow sits in the hand, upright and pointing where the archer faces
      this.group.updateWorldMatrix(true, true);
      this.group.worldToLocal(b.hand_l.getWorldPosition(this.bow.position));
      this.bow.rotation.z = 0.45 * (1 - w);
      this.bow.rotation.y = 0.35 * (1 - w);
    }
    // --- shield: carried on the forearm, brought across the body while guarding
    if (this.shieldG) {
      if (this.guarding) {
        const yaw = this.group.rotation.y;
        aimBone(b.upperarm_l, b.lowerarm_l, tmp2.set(0.35, -0.45, 0.85).normalize().applyAxisAngle(UP, yaw), 1);
        aimBone(b.lowerarm_l, b.hand_l, tmp2.set(-0.8, 0.45, 0.45).normalize().applyAxisAngle(UP, yaw), 1);
      }
      this.group.updateWorldMatrix(true, true);
      b.lowerarm_l.getWorldPosition(tmp).lerp(b.hand_l.getWorldPosition(tmp2), 0.6);
      this.group.worldToLocal(this.shieldG.position.copy(tmp));
      this.shieldG.position.z += 0.1;
      const want = this.guarding ? 0 : 0.7;
      this.shieldG.rotation.y += (want - this.shieldG.rotation.y) * (dt > 0 ? 1 - Math.exp(-10 * dt) : 1);
    }
    for (const st of this.proc) st.post.copy(st.bone.quaternion);
  }

  update(dt: number, realDt: number, ctx: Ctx): void {
    const g = this.group;
    if (this.state === 'spawn') {
      this.spawnT += realDt;
      const k = Math.min(1, this.spawnT / 0.75);
      const s = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2); // ease out back
      g.scale.setScalar(Math.max(0.001, s) * (this.element === 'none' ? 1 : 1.1));
      if (Math.random() < realDt * 30) {
        ctx.particles.spark(
          tmp.set(this.pos.x + (Math.random() - 0.5) * 0.8, Math.random() * 2, this.pos.z + (Math.random() - 0.5) * 0.8),
          0, 1.5, 0, this.element === 'none' ? RED : EL_COLOR[this.element], 0.06, 0.8,
        );
      }
      if (k >= 1) {
        this.state = 'move';
        this.t = 0.6 + Math.random() * 1.2;
      }
    }

    // status: burning ticks on world time
    if (this.burn > 0) {
      this.burn -= dt;
      this.burnAcc += dt;
      if (Math.random() < dt * 25) {
        ctx.particles.spark(tmp.set(this.pos.x + (Math.random() - 0.5) * 0.5, 0.6 + Math.random() * 1.2, this.pos.z + (Math.random() - 0.5) * 0.5), 0, 1.6, 0, EL_COLOR.fire, 0.07, 0.5, -1);
      }
      if (this.burnAcc >= 0.6) {
        this.burnAcc = 0;
        ctx.damageEnemy(this, 0.5, 'fire', UP, 4, { dot: true });
        if (!this.alive) return;
      }
    }
    // elemental aura
    if (this.element !== 'none') {
      this.auraAcc += dt;
      if (this.auraAcc > 0.09) {
        this.auraAcc = 0;
        const fire = this.element === 'fire';
        ctx.particles.spark(
          tmp.set(this.pos.x + (Math.random() - 0.5) * 0.7, 0.3 + Math.random() * 1.7, this.pos.z + (Math.random() - 0.5) * 0.7),
          (Math.random() - 0.5) * 0.6, fire ? 1.4 : this.element === 'ice' ? -0.5 : (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 0.6,
          EL_COLOR[this.element], 0.05, 0.6,
        );
      }
    }

    const pl = ctx.player;
    const dx = pl.pos.x - this.pos.x;
    const dz = pl.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist;
    const nz = dz / dist;

    // knockback slide (force push, heavy hits)
    const kb = this.vel.length();
    if (kb > 0.05) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(Math.exp(-2.5 * dt));
    }

    // frozen solid: no thinking, no animation
    this.iceShell.visible = this.frozen > 0;
    if (this.frozen > 0) {
      this.frozen -= dt;
      this.charge.visible = false;
      this.resolveCollisions(ctx, kb);
      return;
    }

    this.yaw = lerpAngle(this.yaw, Math.atan2(dx, dz), 1 - Math.exp(-7 * dt));
    g.rotation.y = this.yaw;
    this.clock += dt;
    this.hitT = Math.max(0, this.hitT - dt * 3.5);

    let moveX = 0;
    let moveZ = 0;
    let speed = 0;
    let chargeK = 0;
    const fast = this.element === 'storm' ? 1.3 : 1;

    if (this.stun > 0) {
      this.stun -= dt;
    } else if (this.state !== 'spawn' && pl.alive) {
      this.t -= dt;
      if (this.kind === 'archer' && this.weapon) {
        if (this.state === 'move') {
          const radial = dist < 7 ? -1 : dist > 13 ? 1 : 0;
          moveX = nx * radial + -nz * this.strafe * 0.8;
          moveZ = nz * radial + nx * this.strafe * 0.8;
          speed = 1.9 * fast;
          if (this.t <= 0) { this.state = 'aim'; this.t = 0.95; }
        } else if (this.state === 'aim') {
          chargeK = 1 - this.t / 0.95;
          if (this.t <= 0) {
            this.fire(ctx, 'arrow');
            this.state = 'recover';
            this.t = 0.45;
          }
        } else if (this.t <= 0) {
          this.state = 'move';
          this.t = 1.3 + Math.random() * 1.8;
          if (Math.random() < 0.4) this.strafe *= -1;
        }
      } else if (this.kind === 'mage' && this.weapon) {
        if (this.state === 'move') {
          const radial = dist < 6 ? -1 : dist > 12 ? 1 : 0;
          moveX = nx * radial + -nz * this.strafe;
          moveZ = nz * radial + nx * this.strafe;
          speed = 1.3 * fast;
          if (this.t <= 0) { this.state = 'cast'; this.t = 1.15; }
        } else if (this.state === 'cast') {
          chargeK = 1 - this.t / 1.15;
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
        // swordsman, or anyone who has lost their weapon: close in and strike
        const A = this.weapon ? ATK.sword : ATK.punch;
        if (this.state === 'move') {
          const weave = Math.sin(this.clock * 1.3 + this.strafe) * 0.35;
          moveX = nx - nz * weave;
          moveZ = nz + nx * weave;
          speed = dist > A.trigger - 0.1 ? (this.weapon ? 3.1 : 3.5) * fast : 0;
          if (dist < A.trigger) { this.state = 'windup'; this.t = A.wind; }
        } else if (this.state === 'windup') {
          chargeK = 1 - this.t / A.wind;
          moveX = nx; moveZ = nz; speed = 0.6;
          if (this.t <= 0) {
            this.state = 'strike';
            this.t = 0.18;
            this.strike(ctx, dist, A.reach);
          }
        } else if (this.state === 'strike') {
          if (this.t <= 0) { this.state = 'recover'; this.t = 0.75; }
        } else if (this.t <= 0) {
          this.state = 'move';
        }
      }
    }

    // charge telegraph glow
    this.charge.visible = chargeK > 0 && this.weapon !== null;
    if (chargeK > 0) this.charge.scale.setScalar(0.3 + chargeK * 1.1 + Math.sin(ctx.realTime * 40) * 0.08 * chargeK);

    // locomotion
    let lx = 0;
    let lz = 0;
    if (speed > 0) {
      const l = Math.hypot(moveX, moveZ) || 1;
      moveX /= l; moveZ /= l;
      this.pos.x += moveX * speed * dt;
      this.pos.z += moveZ * speed * dt;
      // travel direction in the enemy's own frame (+X = its left, +Z = toward the player)
      lx = moveX * nz - moveZ * nx;
      lz = moveX * nx + moveZ * nz;
    }
    this.resolveCollisions(ctx, kb);
    if (!this.alive) return;
    this.animate(dt, this.state === 'windup' ? 0 : speed, lx, lz, chargeK);
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
        if (kb > 6) { this.slam(ctx, kb); return; }
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
      if (kb > 6) { this.slam(ctx, kb); return; }
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

  /** Thrown hard into a wall or pillar. */
  private slam(ctx: Ctx, kb: number): void {
    const dir = this.vel.clone().normalize();
    this.vel.set(0, 0, 0);
    ctx.damageEnemy(this, 3, 'none', dir, kb * 0.6, { dot: true });
  }

  private fire(ctx: Ctx, kind: 'arrow' | 'orb'): void {
    const from = this.charge.getWorldPosition(new THREE.Vector3());
    const target = tmp.set(ctx.player.pos.x, 1.3, ctx.player.pos.z);
    const spread = kind === 'arrow' ? 0.12 : 0.05;
    target.x += (Math.random() - 0.5) * spread;
    target.y += (Math.random() - 0.5) * spread;
    const dir = tmp2.copy(target).sub(from).normalize();
    const quick = this.element === 'storm' ? 1.35 : 1;
    if (kind === 'arrow') {
      ctx.projectiles.spawn('arrow', 'enemy', from, dir.multiplyScalar(17 * quick), this.element);
      ctx.sfx.arrowShot(ctx.pan(from));
    } else {
      const triple = ctx.level >= 5 && Math.random() < 0.45;
      const angles = triple ? [-0.22, 0, 0.22] : [0];
      for (const a of angles) {
        const v = dir.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, a).multiplyScalar(7.5 * quick);
        ctx.projectiles.spawn('orb', 'enemy', from, v, this.element);
      }
      ctx.sfx.orbCast(ctx.pan(from));
    }
    ctx.particles.burst(from, 8, this.element === 'none' ? GOLD : EL_COLOR[this.element], 2, 0.05, 0.4);
  }

  private strike(ctx: Ctx, dist: number, reach: number): void {
    ctx.sfx.swing();
    const pl = ctx.player;
    if (!pl.alive || dist > reach) return;
    // direction from player to enemy
    tmp.set(this.pos.x - pl.pos.x, 0, this.pos.z - pl.pos.z).normalize();
    if (pl.blocking && tmp.dot(pl.flatForward) > 0.3) {
      ctx.enemyBlocked(this);
    } else {
      ctx.playerHit(this.chest(tmp2), this.element);
    }
  }
}
