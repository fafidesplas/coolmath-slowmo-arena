import * as THREE from 'three';
import { ARENA } from './world';

const dummy = new THREE.Object3D();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpC = new THREE.Color();

/** Fixed-size ring buffer of instanced particles; all physics runs on *world* time. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private next = 0;
  private live = 0;
  private colorDirty = false;
  private p: Float32Array;
  private v: Float32Array;
  private r: Float32Array;
  private w: Float32Array;
  private size: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private bounce: Float32Array;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, private max: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.w = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.bounce = new Float32Array(max);
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, dummy.matrix);
      this.mesh.setColorAt(i, tmpC.set(1, 1, 1));
    }
    scene.add(this.mesh);
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    size: number, life: number, color: THREE.Color,
    grav: number, drag: number, bounce: number,
  ): void {
    const i = this.next;
    this.next = (i + 1) % this.max;
    const j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z;
    this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.r[j] = Math.random() * 6; this.r[j + 1] = Math.random() * 6; this.r[j + 2] = Math.random() * 6;
    this.w[j] = (Math.random() - 0.5) * 16; this.w[j + 1] = (Math.random() - 0.5) * 16; this.w[j + 2] = (Math.random() - 0.5) * 16;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grav[i] = grav;
    this.drag[i] = drag;
    this.bounce[i] = bounce;
    this.mesh.setColorAt(i, color);
    this.colorDirty = true;
    this.live++;
  }

  update(dt: number): void {
    if (this.live <= 0) return;
    let live = 0;
    const { p, v, r, w } = this;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        this.mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      live++;
      const j = i * 3;
      const s = this.size[i] * Math.min(1, this.life[i] / (this.maxLife[i] * 0.3));
      v[j + 1] -= this.grav[i] * dt;
      const dr = Math.exp(-this.drag[i] * dt);
      v[j] *= dr; v[j + 1] *= dr; v[j + 2] *= dr;
      p[j] += v[j] * dt; p[j + 1] += v[j + 1] * dt; p[j + 2] += v[j + 2] * dt;
      r[j] += w[j] * dt; r[j + 1] += w[j + 1] * dt; r[j + 2] += w[j + 2] * dt;
      const b = this.bounce[i];
      if (b > 0) {
        const floor = s * 0.5;
        if (p[j + 1] < floor) {
          p[j + 1] = floor;
          if (v[j + 1] < 0) v[j + 1] = -v[j + 1] * b;
          v[j] *= 0.6; v[j + 2] *= 0.6;
          w[j] *= 0.6; w[j + 1] *= 0.6; w[j + 2] *= 0.6;
        }
        const lim = ARENA + 0.9;
        if (Math.abs(p[j]) > lim) { p[j] = Math.sign(p[j]) * lim; v[j] = -v[j] * b; }
        if (Math.abs(p[j + 2]) > lim) { p[j + 2] = Math.sign(p[j + 2]) * lim; v[j + 2] = -v[j + 2] * b; }
      }
      dummy.position.set(p[j], p[j + 1], p[j + 2]);
      dummy.rotation.set(r[j], r[j + 1], r[j + 2]);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.live = live;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.colorDirty && this.mesh.instanceColor) {
      this.mesh.instanceColor.needsUpdate = true;
      this.colorDirty = false;
    }
  }

  clear(): void {
    dummy.scale.setScalar(0);
    dummy.updateMatrix();
    for (let i = 0; i < this.max; i++) {
      this.life[i] = 0;
      this.mesh.setMatrixAt(i, dummy.matrix);
    }
    this.live = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Particles {
  private shards: Pool;
  private sparks: Pool;
  private scale: number;

  constructor(scene: THREE.Scene, mobile: boolean) {
    this.scale = mobile ? 0.6 : 1;
    const shardMat = new THREE.MeshStandardMaterial({
      roughness: 0.15,
      metalness: 0.1,
      flatShading: true,
      emissive: 0x3a0306,
    });
    this.shards = new Pool(scene, new THREE.TetrahedronGeometry(1, 0), shardMat, mobile ? 500 : 1000);
    const sparkMat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.sparks = new Pool(scene, new THREE.OctahedronGeometry(1, 0), sparkMat, mobile ? 400 : 800);
  }

  /** Break a mesh into crystal shards flying along `dir`. */
  shatter(mesh: THREE.Mesh, dir: THREE.Vector3, power: number): void {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    const center = tmpV.copy(bs.center).applyMatrix4(mesh.matrixWorld);
    const ws = mesh.getWorldScale(tmpV2);
    const rad = bs.radius * Math.max(ws.x, ws.y, ws.z);
    const posAttr = geo.attributes.position;
    const n = Math.max(3, Math.round(Math.min(14, rad * 30) * this.scale));
    const base = ((mesh.material as THREE.MeshStandardMaterial).color ?? tmpC.set(0xff2222)).clone();
    const cx = center.x, cy = center.y, cz = center.z;
    const pt = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      pt.fromBufferAttribute(posAttr, Math.floor(Math.random() * posAttr.count)).applyMatrix4(mesh.matrixWorld);
      const t = Math.random();
      const x = cx + (pt.x - cx) * t, y = cy + (pt.y - cy) * t, z = cz + (pt.z - cz) * t;
      let ox = x - cx, oy = y - cy, oz = z - cz;
      const ol = Math.hypot(ox, oy, oz) || 1;
      ox /= ol; oy /= ol; oz /= ol;
      const k = power * (0.35 + Math.random() * 0.9);
      const o = 1 + Math.random() * 2.5;
      tmpC.copy(base).offsetHSL((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.3) * 0.25);
      this.shards.spawn(
        x, y, z,
        dir.x * k + ox * o, dir.y * k + oy * o + 1 + Math.random() * 2.5, dir.z * k + oz * o,
        (0.035 + Math.random() * 0.085) * Math.min(1.6, Math.max(0.7, rad * 2.5)),
        3.5 + Math.random() * 2.5, tmpC, 9.8, 0.25, 0.35,
      );
    }
  }

  spark(pos: THREE.Vector3, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grav = 0, drag = 1.5): void {
    this.sparks.spawn(pos.x, pos.y, pos.z, vx, vy, vz, size, life, color, grav, drag, 0);
  }

  burst(pos: THREE.Vector3, count: number, color: THREE.Color, speed: number, size: number, life: number, grav = 0): void {
    const n = Math.max(2, Math.round(count * this.scale));
    for (let i = 0; i < n; i++) {
      tmpV.randomDirection().multiplyScalar(speed * (0.3 + Math.random() * 0.7));
      tmpC.copy(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      this.sparks.spawn(pos.x, pos.y, pos.z, tmpV.x, tmpV.y, tmpV.z, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), tmpC, grav, 2, 0);
    }
  }

  update(dt: number): void {
    this.shards.update(dt);
    this.sparks.update(dt);
  }

  clear(): void {
    this.shards.clear();
    this.sparks.clear();
  }
}
