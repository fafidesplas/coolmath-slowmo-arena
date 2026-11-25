import * as THREE from 'three';

/** Short-lived real-time effects: lightning arcs, ground rings and floating combat text. */
const segGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
const ringGeo = new THREE.RingGeometry(0.95, 1, 64).rotateX(-Math.PI / 2);

interface Arc { meshes: THREE.Mesh[]; t: number; life: number; width: number }
interface Ring { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; t: number; life: number; radius: number }

const tmp = new THREE.Vector3();
const a = new THREE.Vector3();
const b = new THREE.Vector3();

export class Effects {
  private arcs: Arc[] = [];
  private rings: Ring[] = [];
  private mats = new Map<number, THREE.MeshBasicMaterial>();

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private layer: HTMLElement) {}

  private mat(color: number): THREE.MeshBasicMaterial {
    let m = this.mats.get(color);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
      this.mats.set(color, m);
    }
    return m;
  }

  /** Jagged lightning arc between two points. */
  bolt(from: THREE.Vector3, to: THREE.Vector3, color = 0xd9c2ff, width = 0.05): void {
    const len = from.distanceTo(to);
    const n = Math.max(3, Math.min(10, Math.round(len / 1.1)));
    const meshes: THREE.Mesh[] = [];
    a.copy(from);
    for (let i = 1; i <= n; i++) {
      b.copy(from).lerp(to, i / n);
      if (i < n) b.add(tmp.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(Math.min(0.9, len * 0.14)));
      const m = new THREE.Mesh(segGeo, this.mat(color));
      m.position.copy(a);
      m.lookAt(b);
      m.scale.set(width, width, a.distanceTo(b));
      m.frustumCulled = false;
      this.scene.add(m);
      meshes.push(m);
      a.copy(b);
    }
    this.arcs.push({ meshes, t: 0, life: 0.22, width });
  }

  /** Expanding ring on the ground. */
  ring(pos: THREE.Vector3, radius: number, color: number, life = 0.5): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.position.set(pos.x, 0.08, pos.z);
    mesh.scale.setScalar(0.1);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, t: 0, life, radius });
  }

  /** Floating combat text at a world position. */
  text(pos: THREE.Vector3, str: string, color: string): void {
    tmp.copy(pos).project(this.camera);
    if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) return;
    const el = document.createElement('div');
    el.className = 'ft';
    el.textContent = str;
    el.style.color = color;
    el.style.left = `${((tmp.x + 1) / 2) * 100}%`;
    el.style.top = `${((1 - tmp.y) / 2) * 100}%`;
    this.layer.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  update(dt: number): void {
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      const arc = this.arcs[i];
      arc.t += dt;
      const k = 1 - arc.t / arc.life;
      if (k <= 0) {
        for (const m of arc.meshes) this.scene.remove(m);
        this.arcs.splice(i, 1);
        continue;
      }
      const w = arc.width * k * (0.6 + Math.random() * 0.8);
      for (const m of arc.meshes) m.scale.set(w, w, m.scale.z);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.scene.remove(r.mesh);
        r.mat.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      r.mesh.scale.setScalar(0.1 + (1 - Math.pow(1 - k, 2)) * r.radius);
      r.mat.opacity = 0.6 * (1 - k);
    }
  }

  clear(): void {
    for (const arc of this.arcs) for (const m of arc.meshes) this.scene.remove(m);
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      r.mat.dispose();
    }
    this.arcs.length = 0;
    this.rings.length = 0;
    this.layer.replaceChildren();
  }
}
