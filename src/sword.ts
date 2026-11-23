import * as THREE from 'three';

type Pose = [number, number, number, number, number, number];

// [px, py, pz, rx, ry, rz] in camera space; blade points along local +Y
const IDLE: Pose = [0.3, -0.3, -0.52, -0.62, 0.05, 0.16];
const WIND: Pose = [0.42, -0.08, -0.45, -0.05, -0.25, -1.0];
const END: Pose = [-0.36, -0.38, -0.55, -1.3, 0.3, 1.65];
const BLOCK: Pose = [0.26, -0.16, -0.46, 0.12, 0.0, 1.5];

const SWING_TIME = 0.36;
const ACTIVE_FROM = 0.06;
const ACTIVE_TO = 0.18;

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

export class Sword {
  readonly root = new THREE.Group();
  private pivot = new THREE.Group();
  private glowMat: THREE.MeshBasicMaterial;
  private trail: THREE.Mesh;
  private trailMat: THREE.MeshBasicMaterial;
  private swingT = -1;
  side = 1;
  private cooldown = 0;
  private blockBlend = 0;
  private bobT = 0;
  private time = 0;
  recoil = 0;
  private pose: Pose = [...IDLE];
  private tmpA: Pose = [...IDLE];

  constructor(camera: THREE.Camera) {
    camera.add(this.root);
    this.root.add(this.pivot);
    this.pivot.scale.setScalar(0.72);

    const steel = new THREE.MeshStandardMaterial({ color: 0xe8eef5, metalness: 0.35, roughness: 0.22, flatShading: true });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9a944, metalness: 0.5, roughness: 0.35, flatShading: true });
    const leather = new THREE.MeshStandardMaterial({ color: 0x4a2c1a, roughness: 0.9, flatShading: true });
    const gauntlet = new THREE.MeshStandardMaterial({ color: 0x59606c, metalness: 0.4, roughness: 0.5, flatShading: true });

    const shape = new THREE.Shape();
    shape.moveTo(-0.03, 0);
    shape.lineTo(0.03, 0);
    shape.lineTo(0.026, 0.78);
    shape.lineTo(0, 0.92);
    shape.lineTo(-0.026, 0.78);
    shape.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false });
    bladeGeo.translate(0, 0.075, -0.006);
    const blade = new THREE.Mesh(bladeGeo, steel);
    this.pivot.add(blade);

    this.glowMat = new THREE.MeshBasicMaterial({
      color: 0x58c8ff,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const glow = new THREE.Mesh(bladeGeo, this.glowMat);
    glow.scale.set(1.9, 1.03, 2.5);
    glow.position.y = -0.003;
    this.pivot.add(glow);

    const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.6, 0.016), new THREE.MeshStandardMaterial({ color: 0x9aa6b4, metalness: 0.5, roughness: 0.3 }));
    fuller.position.y = 0.42;
    this.pivot.add(fuller);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.035, 0.05), gold);
    guard.position.y = 0.06;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.024, 0.17, 6), leather);
    grip.position.y = -0.03;
    const pommel = new THREE.Mesh(new THREE.IcosahedronGeometry(0.036, 0), gold);
    pommel.position.y = -0.135;
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.1, 0.11), gauntlet);
    hand.position.set(0, -0.03, 0.01);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.075, 0.14, 6), gauntlet);
    cuff.position.set(0, -0.06, 0.1);
    cuff.rotation.x = Math.PI / 2 - 0.4;
    this.pivot.add(guard, grip, pommel, hand, cuff);

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
    this.trailMat = new THREE.MeshBasicMaterial({
      color: 0x4aa8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexColors: true,
      toneMapped: false,
    });
    this.trail = new THREE.Mesh(ring, this.trailMat);
    this.trail.position.set(0, -0.3, -0.85);
    this.trail.visible = false;
    this.root.add(this.trail);
    this.pivot.traverse((o) => {
      o.renderOrder = 5;
    });
  }

  get swinging(): boolean {
    return this.swingT >= 0;
  }
  /** True during the frames where the blade can cut / deflect. */
  get active(): boolean {
    return this.swingT >= ACTIVE_FROM && this.swingT <= ACTIVE_TO;
  }

  startSwing(): boolean {
    if (this.cooldown > 0) return false;
    this.swingT = 0;
    this.side *= -1;
    this.cooldown = 0.34;
    this.trail.scale.x = this.side;
    this.trail.rotation.z = -0.35 * this.side;
    return true;
  }

  reset(): void {
    this.swingT = -1;
    this.cooldown = 0;
    this.blockBlend = 0;
    this.recoil = 0;
  }

  update(dt: number, moveI: number, blocking: boolean): void {
    this.time += dt;
    this.cooldown -= dt;
    const p = this.pose;
    lerpPose(IDLE, IDLE, 0, p);

    if (this.swingT >= 0) {
      this.swingT += dt;
      const t = this.swingT;
      const wind = mirror(WIND, this.side);
      const end = mirror(END, this.side);
      if (t < ACTIVE_FROM) lerpPose(IDLE, wind, easeOut(t / ACTIVE_FROM), p);
      else if (t < ACTIVE_FROM + 0.1) lerpPose(wind, end, easeIn((t - ACTIVE_FROM) / 0.1), p);
      else lerpPose(end, IDLE, easeInOut(Math.min(1, (t - ACTIVE_FROM - 0.1) / (SWING_TIME - ACTIVE_FROM - 0.1))), p);
      const tt = (t - ACTIVE_FROM) / 0.26;
      this.trail.visible = tt > 0 && tt < 1;
      this.trailMat.opacity = tt > 0 ? 0.85 * (1 - tt) : 0;
      if (t >= SWING_TIME) {
        this.swingT = -1;
        this.trail.visible = false;
      }
    }

    const wantBlock = blocking && this.swingT < 0 ? 1 : 0;
    this.blockBlend += (wantBlock - this.blockBlend) * (1 - Math.exp(-20 * dt));
    lerpPose(p, BLOCK, this.blockBlend, this.tmpA);
    for (let i = 0; i < 6; i++) p[i] = this.tmpA[i];

    // walk bob + breathing
    this.bobT += dt * (3 + 7 * moveI);
    p[0] += Math.sin(this.bobT) * 0.014 * moveI;
    p[1] += Math.abs(Math.cos(this.bobT)) * 0.018 * moveI + Math.sin(this.time * 1.6) * 0.004;

    // parry recoil
    this.recoil = Math.max(0, this.recoil - dt * 5);
    p[2] += this.recoil * 0.1;
    p[3] += this.recoil * 0.35;

    this.pivot.position.set(p[0], p[1], p[2]);
    this.pivot.rotation.set(p[3], p[4], p[5]);
    const hot = Math.max(this.blockBlend, this.active ? 1 : 0, this.recoil);
    this.glowMat.opacity = 0.16 + 0.5 * hot + Math.sin(this.time * 3) * 0.04;
  }
}
