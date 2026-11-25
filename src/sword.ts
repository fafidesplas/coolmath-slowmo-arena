import * as THREE from 'three';
import { FISTS, ITEMS, TIP, buildItemMesh, type AttackStyle, type ItemDef, type ItemState } from './items';

type Pose = [number, number, number, number, number, number];

// [px, py, pz, rx, ry, rz] in camera space; the held item's business end points along local +Y
interface StylePoses { idle: Pose; wind: Pose; end: Pose; mirror: boolean; trail: boolean }
const POSES: Record<AttackStyle, StylePoses> = {
  slash: {
    idle: [0.3, -0.3, -0.52, -0.62, 0.05, 0.16],
    wind: [0.42, -0.08, -0.45, -0.05, -0.25, -1.0],
    end: [-0.36, -0.38, -0.55, -1.3, 0.3, 1.65],
    mirror: true, trail: true,
  },
  thrust: {
    idle: [0.3, -0.34, -0.5, -0.5, 0.05, 0.12],
    wind: [0.3, -0.3, -0.36, -0.85, 0.0, 0.1],
    end: [0.24, -0.24, -0.78, -1.2, 0.0, 0.06],
    mirror: false, trail: false,
  },
  bow: {
    idle: [0.27, -0.24, -0.6, 0.0, Math.PI, -0.3],
    wind: [0.2, -0.16, -0.52, 0.0, Math.PI, -0.08],
    end: [0.2, -0.16, -0.62, 0.0, Math.PI, -0.08],
    mirror: false, trail: false,
  },
  shield: {
    idle: [-0.3, -0.42, -0.52, 0.0, -0.3, -0.06],
    wind: [-0.3, -0.38, -0.44, 0.05, -0.3, -0.06],
    end: [-0.08, -0.3, -0.8, -0.25, -0.15, -0.15],
    mirror: false, trail: false,
  },
  fist: {
    idle: [0.3, -0.38, -0.5, -1.25, 0.0, 0.12],
    wind: [0.32, -0.32, -0.4, -1.2, 0.0, 0.12],
    end: [0.1, -0.2, -0.86, -1.4, 0.0, -0.1],
    mirror: false, trail: false,
  },
  toss: {
    idle: [0.3, -0.3, -0.5, -0.2, 0.0, 0.1],
    wind: [0.34, -0.2, -0.4, 0.3, 0.0, 0.1],
    end: [0.2, -0.2, -0.7, -0.9, 0.0, 0.1],
    mirror: false, trail: false,
  },
};

function mirror(p: Pose, side: number): Pose {
  return side > 0 ? p : [-p[0], p[1], p[2], p[3], -p[4], -p[5]];
}
function lerpPose(a: Pose, b: Pose, t: number, out: Pose): Pose {
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeIn = (t: number) => t * t;
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** The player's hand in first person: whatever is held, its swing and its glow. */
export class Hand {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private model: THREE.Group | null = null;
  private aura: THREE.Mesh;
  private auraMat: THREE.MeshBasicMaterial;
  private trail: THREE.Mesh;
  private trailMat: THREE.MeshBasicMaterial;
  private swingT = -1;
  private cooldown = 0;
  private speed = 1;
  private bobT = 0;
  private time = 0;
  private wasActive = false;
  private pose: Pose = [...POSES.fist.idle];
  private cur: Pose = [...POSES.fist.idle];
  side = 1;
  recoil = 0;
  def: ItemDef = FISTS;
  /** Increments on every swing, so each swing damages a target once. */
  swingId = 0;
  /** True on the single frame the swing becomes live. */
  justActive = false;
  private tipY = 0;
  private tinted = false;

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.pivot);
    this.pivot.scale.setScalar(0.72);

    const gauntlet = new THREE.MeshStandardMaterial({ color: 0x59606c, metalness: 0.4, roughness: 0.5, flatShading: true });
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.1, 0.11), gauntlet);
    hand.position.set(0, -0.03, 0.01);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.14, 6), gauntlet);
    cuff.position.set(0, -0.06, 0.1);
    cuff.rotation.x = Math.PI / 2 - 0.4;
    this.pivot.add(hand, cuff);

    this.auraMat = new THREE.MeshBasicMaterial({ color: 0x58c8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.aura = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.auraMat);
    this.aura.visible = false;
    this.pivot.add(this.aura);

    // swing arc
    const ring = new THREE.RingGeometry(0.5, 1.2, 24, 1, 0.1, 2.7);
    const pos = ring.attributes.position;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      const a = Math.min(1, Math.max(0, (Math.atan2(y, x) - 0.1) / 2.7));
      const r = Math.min(1, Math.max(0, (Math.hypot(x, y) - 0.5) / 0.7));
      col.set([1, 1, 1, Math.pow(a, 1.6) * Math.pow(r, 1.5)], i * 4);
    }
    ring.setAttribute('color', new THREE.BufferAttribute(col, 4));
    this.trailMat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, toneMapped: false });
    this.trail = new THREE.Mesh(ring, this.trailMat);
    this.trail.position.set(0, -0.3, -0.85);
    this.trail.visible = false;
    this.root.add(this.trail);
    this.setItem(null);
  }

  /** Show what the hand holds (null = bare fist). */
  setItem(s: ItemState | null): void {
    if (this.model) this.pivot.remove(this.model);
    this.model = s ? buildItemMesh(s) : null;
    this.def = s ? ITEMS[s.kind] : FISTS;
    this.tipY = s ? TIP[s.kind] : 0;
    if (this.model) {
      this.model.traverse((o) => {
        o.renderOrder = 5;
        o.castShadow = false;
      });
      this.pivot.add(this.model);
    }
    const big = s?.kind === 'hammer' ? 0.2 : s?.kind === 'shield' ? 0.34 : 0.13;
    this.aura.position.set(0, s?.kind === 'sword' || s?.kind === 'arrow' ? 0.55 : this.tipY, 0);
    this.aura.scale.set(big, s?.kind === 'sword' || s?.kind === 'arrow' ? 0.5 : big, big);
    this.side = 1;
    this.swingT = -1;
    this.trail.visible = false;
  }

  /** Elemental coating: tints the glow and the swing arc. Pass null for plain steel. */
  setTint(hex: number | null): void {
    this.tinted = hex !== null;
    this.auraMat.color.setHex(hex ?? 0x58c8ff);
    this.trailMat.color.setHex(hex ?? 0x4aa8ff);
  }

  /** World position of the business end (spell and arrow origins). */
  tip(out: THREE.Vector3): THREE.Vector3 {
    return this.pivot.localToWorld(out.set(0, this.tipY, 0));
  }

  get swinging(): boolean {
    return this.swingT >= 0;
  }
  /** True during the frames where the blow lands. */
  get active(): boolean {
    return this.swingT >= this.def.from && this.swingT <= this.def.to;
  }
  get ready(): boolean {
    return this.cooldown <= 0;
  }

  startSwing(cdMult = 1): boolean {
    if (this.cooldown > 0) return false;
    const st = POSES[this.def.style];
    this.swingT = 0;
    this.swingId++;
    if (st.mirror) this.side *= -1;
    this.cooldown = this.def.cooldown * cdMult;
    this.speed = 1 / cdMult;
    const big = this.def.knock > 10 ? 1.3 : 1;
    this.trail.scale.set(this.side * big, big, 1);
    this.trail.rotation.z = -0.35 * this.side;
    return true;
  }

  /** Short jolt for throws, grabs and breaks. */
  kick(amount = 1): void {
    this.recoil = amount;
    this.cooldown = Math.max(this.cooldown, 0.18);
  }

  reset(): void {
    this.swingT = -1;
    this.cooldown = 0;
    this.recoil = 0;
  }

  update(dt: number, moveI: number): void {
    this.time += dt;
    this.cooldown -= dt;
    const p = this.pose;
    const w = this.def;
    const st = POSES[w.style];
    lerpPose(st.idle, st.idle, 0, p);

    if (this.swingT >= 0) {
      this.swingT += dt * this.speed;
      const t = this.swingT;
      const wind = st.mirror ? mirror(st.wind, this.side) : st.wind;
      const end = st.mirror ? mirror(st.end, this.side) : st.end;
      if (t < w.from) lerpPose(st.idle, wind, easeOut(t / w.from), p);
      else if (t < w.from + w.strike) lerpPose(wind, end, easeIn((t - w.from) / w.strike), p);
      else lerpPose(end, st.idle, easeInOut(Math.min(1, (t - w.from - w.strike) / (w.swingTime - w.from - w.strike))), p);
      const tt = (t - w.from) / 0.26;
      this.trail.visible = st.trail && tt > 0 && tt < 1;
      this.trailMat.opacity = tt > 0 ? 0.85 * (1 - tt) : 0;
      if (t >= w.swingTime) {
        this.swingT = -1;
        this.trail.visible = false;
      }
    }

    // walk bob + breathing
    this.bobT += dt * (3 + 7 * moveI);
    p[0] += Math.sin(this.bobT) * 0.014 * moveI;
    p[1] += Math.abs(Math.cos(this.bobT)) * 0.018 * moveI + Math.sin(this.time * 1.6) * 0.004;

    // jolt
    this.recoil = Math.max(0, this.recoil - dt * 5);
    p[2] += this.recoil * 0.1;
    p[1] -= this.recoil * 0.05;

    // ease between stances when the held item changes; swings stay crisp
    const k = this.swingT >= 0 ? 1 : 1 - Math.exp(-18 * dt);
    for (let i = 0; i < 6; i++) this.cur[i] += (p[i] - this.cur[i]) * k;
    this.pivot.position.set(this.cur[0], this.cur[1], this.cur[2]);
    this.pivot.rotation.set(this.cur[3], this.cur[4], this.cur[5]);

    this.justActive = this.active && !this.wasActive;
    this.wasActive = this.active;
    this.aura.visible = this.tinted;
    this.auraMat.opacity = 0.35 + (this.active ? 0.35 : 0) + Math.sin(this.time * 5) * 0.08;
  }
}
