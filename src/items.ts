import * as THREE from 'three';
import type { Ctx } from './ctx';
import { ARENA } from './world';
import { EL_COLOR, EL_HEX, EL_NAME, type Element } from './elements';

/**
 * Everything that can be held, dropped, caught and thrown: by the player and by the knights.
 * A held item, a knight's weapon and a pickup floating in the yard are all the same thing.
 */
export type ItemKind = 'sword' | 'hammer' | 'shield' | 'bow' | 'staff' | 'potion' | 'arrow';
export type AttackStyle = 'slash' | 'thrust' | 'bow' | 'shield' | 'fist' | 'toss';

export interface ItemDef {
  name: string;
  style: AttackStyle;
  /** melee damage (0 = this is not a melee weapon) */
  damage: number;
  /** hits before it breaks, or shots it carries */
  uses: number;
  cooldown: number;
  swingTime: number;
  /** the blow is live between these two moments of the swing */
  from: number;
  to: number;
  strike: number;
  range: number;
  /** minimum facing dot to hit */
  arc: number;
  knock: number;
  throwDmg: number;
  /** word for what `uses` counts */
  unit: string;
}

export const ITEMS: Record<ItemKind, ItemDef> = {
  sword: { name: 'Longsword', style: 'slash', damage: 2, uses: 5, cooldown: 0.34, swingTime: 0.36, from: 0.06, to: 0.18, strike: 0.1, range: 2.7, arc: 0.4, knock: 2, throwDmg: 3, unit: 'cuts' },
  hammer: { name: 'War Hammer', style: 'slash', damage: 4, uses: 3, cooldown: 0.78, swingTime: 0.62, from: 0.2, to: 0.36, strike: 0.14, range: 3.2, arc: 0.1, knock: 11, throwDmg: 4, unit: 'blows' },
  shield: { name: 'Shield', style: 'shield', damage: 1, uses: 6, cooldown: 0.5, swingTime: 0.4, from: 0.08, to: 0.18, strike: 0.08, range: 2.2, arc: 0.4, knock: 9, throwDmg: 2, unit: 'blocks' },
  bow: { name: 'Bow', style: 'bow', damage: 0, uses: 2, cooldown: 0.55, swingTime: 0.4, from: 0.16, to: 0.2, strike: 0.05, range: 0, arc: 1, knock: 0, throwDmg: 1, unit: 'arrows' },
  staff: { name: 'Staff', style: 'thrust', damage: 0, uses: 3, cooldown: 0.5, swingTime: 0.34, from: 0.1, to: 0.14, strike: 0.06, range: 0, arc: 1, knock: 0, throwDmg: 2, unit: 'charges' },
  potion: { name: 'Flask', style: 'toss', damage: 0, uses: 1, cooldown: 0.3, swingTime: 0.2, from: 0.05, to: 0.1, strike: 0.05, range: 0, arc: 1, knock: 0, throwDmg: 0, unit: '' },
  arrow: { name: 'Arrow', style: 'thrust', damage: 2, uses: 1, cooldown: 0.34, swingTime: 0.3, from: 0.08, to: 0.16, strike: 0.07, range: 2.3, arc: 0.6, knock: 1, throwDmg: 2, unit: '' },
};
export const FISTS: ItemDef = { name: 'Bare hands', style: 'fist', damage: 1, uses: 0, cooldown: 0.3, swingTime: 0.3, from: 0.07, to: 0.15, strike: 0.07, range: 2.1, arc: 0.5, knock: 3, throwDmg: 0, unit: '' };

export interface ItemState {
  kind: ItemKind;
  /** what a staff casts / a flask holds */
  element: Element;
  uses: number;
  /** temporary coating from a broken flask or an elemental knight */
  imbue: Element;
  imbueUses: number;
  /** not yet touched by the player (upgrades apply on first pick-up) */
  fresh: boolean;
}

export function makeItem(kind: ItemKind, element: Element = 'none', uses = ITEMS[kind].uses): ItemState {
  return { kind, element, uses, imbue: 'none', imbueUses: 0, fresh: true };
}

export function itemName(s: ItemState): string {
  const d = ITEMS[s.kind];
  if (s.kind === 'staff') return s.element === 'none' ? 'Arcane Staff' : `${EL_NAME[s.element]} Staff`;
  if (s.kind === 'potion') return `${EL_NAME[s.element]} Flask`;
  return d.name;
}

/** The element an attack with this item carries right now. */
export function itemElement(s: ItemState | null): Element {
  if (!s) return 'none';
  if (s.kind === 'staff' || s.kind === 'potion') return s.element;
  return s.imbueUses > 0 ? s.imbue : 'none';
}

// ---------------------------------------------------------------- meshes
const mat = (color: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.4, ...o });
const M = {
  steel: mat(0xe8eef5, { metalness: 0.35, roughness: 0.22 }),
  gold: mat(0xd9a944, { metalness: 0.5, roughness: 0.35 }),
  wood: mat(0x5a3a22, { roughness: 0.85 }),
  leather: mat(0x4a2c1a, { roughness: 0.9 }),
  iron: mat(0x7c8694, { metalness: 0.45, roughness: 0.4 }),
  glass: mat(0xdff3ff, { transparent: true, opacity: 0.45, roughness: 0.05 }),
  fletch: mat(0xd81f26, { roughness: 0.9 }),
};
const gemMats = new Map<Element, THREE.MeshStandardMaterial>();
function gem(el: Element): THREE.MeshStandardMaterial {
  let m = gemMats.get(el);
  if (!m) {
    m = mat(el === 'none' ? 0xcfeaff : EL_HEX[el], { emissive: EL_HEX[el], emissiveIntensity: 1.3, roughness: 0.1 });
    gemMats.set(el, m);
  }
  return m;
}
const GEO = {
  blade: new THREE.BoxGeometry(0.075, 0.95, 0.025).translate(0, 0.55, 0),
  guard: new THREE.BoxGeometry(0.26, 0.04, 0.05).translate(0, 0.06, 0),
  grip: new THREE.CylinderGeometry(0.022, 0.024, 0.17, 6).translate(0, -0.03, 0),
  pommel: new THREE.IcosahedronGeometry(0.036, 0).translate(0, -0.135, 0),
  haft: new THREE.CylinderGeometry(0.02, 0.024, 0.86, 6).translate(0, 0.33, 0),
  hammerHead: new THREE.BoxGeometry(0.3, 0.17, 0.17).translate(0, 0.76, 0),
  hammerBand: new THREE.BoxGeometry(0.1, 0.19, 0.19).translate(0, 0.76, 0),
  shield: new THREE.BoxGeometry(0.52, 0.66, 0.06),
  boss: new THREE.ConeGeometry(0.11, 0.1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.07),
  rim: new THREE.BoxGeometry(0.56, 0.06, 0.07).translate(0, 0.33, 0),
  // upright bow in the YZ plane, belly toward +Z, grip at the origin
  bow: new THREE.TorusGeometry(0.45, 0.026, 3, 10, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0, -0.42),
  bowString: new THREE.BoxGeometry(0.008, 0.9, 0.008).translate(0, 0, -0.42),
  staff: new THREE.CylinderGeometry(0.02, 0.026, 1.5, 6).translate(0, 0.45, 0),
  staffGem: new THREE.OctahedronGeometry(0.08, 0).scale(1, 1.5, 1).translate(0, 1.27, 0),
  flask: new THREE.IcosahedronGeometry(0.12, 0).translate(0, 0.02, 0),
  flaskNeck: new THREE.CylinderGeometry(0.035, 0.05, 0.1, 6).translate(0, 0.16, 0),
  cork: new THREE.CylinderGeometry(0.04, 0.035, 0.05, 6).translate(0, 0.23, 0),
  shaft: new THREE.CylinderGeometry(0.014, 0.014, 0.9, 4).translate(0, 0.35, 0),
  arrowHead: new THREE.ConeGeometry(0.045, 0.14, 4).translate(0, 0.86, 0),
  fletch: new THREE.BoxGeometry(0.09, 0.16, 0.005).translate(0, -0.03, 0),
  halo: new THREE.RingGeometry(0.3, 0.36, 24).rotateX(-Math.PI / 2),
};
const haloMats = new Map<Element, THREE.MeshBasicMaterial>();
function haloMat(el: Element): THREE.MeshBasicMaterial {
  let m = haloMats.get(el);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: el === 'none' ? 0xffffff : EL_HEX[el], transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    haloMats.set(el, m);
  }
  return m;
}

/** Height of the business end above the grip (for glows and spell origins). */
export const TIP: Record<ItemKind, number> = { sword: 1.0, hammer: 0.76, shield: 0.1, bow: 0, staff: 1.27, potion: 0.1, arrow: 0.86 };

/** Build the mesh for an item. Grip at the origin, business end toward +Y (bows and shields face +Z). */
export function buildItemMesh(s: ItemState): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  };
  switch (s.kind) {
    case 'sword':
      add(GEO.blade, M.steel); add(GEO.guard, M.gold); add(GEO.grip, M.leather); add(GEO.pommel, M.gold);
      break;
    case 'hammer':
      add(GEO.haft, M.wood); add(GEO.hammerHead, M.iron); add(GEO.hammerBand, M.gold);
      break;
    case 'shield':
      add(GEO.shield, M.wood); add(GEO.boss, M.iron); add(GEO.rim, M.iron); add(GEO.rim, M.iron).position.y = -0.66;
      break;
    case 'bow':
      add(GEO.bow, M.wood); add(GEO.bowString, M.fletch);
      break;
    case 'staff':
      add(GEO.staff, M.wood); add(GEO.staffGem, gem(s.element));
      break;
    case 'potion':
      add(GEO.flask, gem(s.element)); add(GEO.flaskNeck, M.glass); add(GEO.cork, M.wood);
      break;
    case 'arrow':
      add(GEO.shaft, M.wood); add(GEO.arrowHead, M.iron); add(GEO.fletch, M.fletch); add(GEO.fletch, M.fletch).rotation.y = Math.PI / 2;
      break;
  }
  return g;
}

// ---------------------------------------------------------------- items in the world
type Mode = 'rest' | 'flying' | 'thrown';

export class WorldItem {
  readonly group = new THREE.Group();
  readonly vel = new THREE.Vector3();
  readonly spin = new THREE.Vector3();
  mode: Mode = 'rest';
  age = 0;
  /** stuck in the ground where it landed (arrows) instead of hovering */
  stuck = false;
  highlight = 0;
  private halo: THREE.Mesh;
  private phase = Math.random() * 6;

  get pos(): THREE.Vector3 {
    return this.group.position;
  }

  constructor(public state: ItemState, public mesh: THREE.Group) {
    this.group.add(mesh);
    this.halo = new THREE.Mesh(GEO.halo, haloMat(itemElement(state)));
    this.halo.visible = false;
  }

  attachHalo(scene: THREE.Scene): void {
    scene.add(this.halo);
  }
  removeHalo(scene: THREE.Scene): void {
    scene.remove(this.halo);
  }

  /** Idle presentation: hover, turn slowly, mark the spot on the ground. */
  present(realDt: number, time: number): void {
    const rest = this.mode === 'rest';
    this.halo.visible = rest;
    if (!rest) return;
    this.halo.position.set(this.pos.x, 0.04, this.pos.z);
    const pulse = 1 + Math.sin(time * 3 + this.phase) * 0.08 + this.highlight * 0.5;
    this.halo.scale.setScalar(pulse);
    if (this.stuck) return;
    this.pos.y += (0.85 + Math.sin(time * 1.7 + this.phase) * 0.05 - this.pos.y) * (1 - Math.exp(-6 * realDt));
    this.group.rotation.set(0.25, this.group.rotation.y + realDt * 0.9, 0.2);
  }
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const SPARK = new THREE.Color(0xfff0c0);
const MAX_ITEMS = 16;

export class Items {
  list: WorldItem[] = [];
  ctx!: Ctx;

  constructor(private scene: THREE.Scene) {}

  spawn(state: ItemState, pos: THREE.Vector3, mode: Mode, vel?: THREE.Vector3, mesh?: THREE.Group): WorldItem {
    const it = new WorldItem(state, mesh ?? buildItemMesh(state));
    it.pos.copy(pos);
    it.mode = mode;
    if (vel) it.vel.copy(vel);
    if (mode !== 'rest') it.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, mode === 'thrown' ? -13 : (Math.random() - 0.5) * 10);
    if (state.kind === 'arrow' && mode === 'thrown') it.spin.set(0, 0, 0);
    this.scene.add(it.group);
    it.attachHalo(this.scene);
    this.list.push(it);
    // keep the yard from silting up: the oldest idle pickup goes first
    if (this.list.length > MAX_ITEMS) {
      const old = this.list.find((o) => o.mode === 'rest' && o !== it);
      if (old) this.remove(old);
    }
    return it;
  }

  remove(it: WorldItem): void {
    const i = this.list.indexOf(it);
    if (i >= 0) this.list.splice(i, 1);
    this.scene.remove(it.group);
    it.removeHalo(this.scene);
  }

  clear(): void {
    for (const it of [...this.list]) this.remove(it);
  }

  /** Smash an item into shards. */
  shatter(it: WorldItem, dir: THREE.Vector3): void {
    it.group.updateWorldMatrix(true, true);
    it.mesh.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.ctx.particles.shatter(o as THREE.Mesh, dir, 4);
    });
    this.remove(it);
  }

  /** The item the player is looking at and can reach. */
  target(eye: THREE.Vector3, fwd: THREE.Vector3, reach: number): WorldItem | null {
    let best: WorldItem | null = null;
    let bestScore = 0.86;
    for (const it of this.list) {
      if (it.mode === 'thrown') continue;
      tmp.copy(it.pos).sub(eye);
      const d = tmp.length();
      if (d > reach) continue;
      // things lie below eye level: facing them counts as much as looking straight at them
      const flat = (tmp.x * fwd.x + tmp.z * fwd.z) / ((Math.hypot(tmp.x, tmp.z) || 1) * (Math.hypot(fwd.x, fwd.z) || 1));
      const score = tmp.divideScalar(d || 1).dot(fwd) * 0.5 + flat * 0.5 + Math.max(0, 1.2 - d) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        best = it;
      }
    }
    return best;
  }

  private land(it: WorldItem): void {
    const ctx = this.ctx;
    if (it.state.kind === 'potion') {
      ctx.burst(it.pos, it.state.element, true);
      this.remove(it);
      return;
    }
    it.mode = 'rest';
    it.vel.set(0, 0, 0);
    ctx.sfx.thunk(ctx.pan(it.pos));
    ctx.particles.burst(it.pos, 5, SPARK, 2, 0.04, 0.3);
  }

  update(dt: number, realDt: number, time: number): void {
    const ctx = this.ctx;
    const lim = ARENA - 0.3;
    for (const it of [...this.list]) {
      it.age += realDt;
      it.highlight = Math.max(0, it.highlight - realDt * 6);
      if (it.mode === 'rest') {
        it.present(realDt, time);
        continue;
      }
      it.present(realDt, time);
      const thrown = it.mode === 'thrown';
      it.vel.y -= (thrown ? 4 : 11) * dt;
      const step = it.vel.length() * dt;
      const n = Math.max(1, Math.ceil(step / 0.25));
      const sub = dt / n;
      let done = false;
      for (let s = 0; s < n && !done; s++) {
        it.pos.addScaledVector(it.vel, sub);
        const p = it.pos;
        // world
        if (p.y < 0.12) {
          p.y = 0.12;
          this.land(it);
          done = true;
          break;
        }
        if (Math.abs(p.x) > lim || Math.abs(p.z) > lim) {
          p.x = Math.max(-lim, Math.min(lim, p.x));
          p.z = Math.max(-lim, Math.min(lim, p.z));
          if (it.state.kind === 'potion') { this.land(it); done = true; break; }
          it.vel.multiplyScalar(-0.2).setY(0);
          it.mode = 'flying';
        }
        for (const c of ctx.colliders) {
          if (p.y > c.h) continue;
          const dx = p.x - c.x, dz = p.z - c.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < c.r * c.r) {
            if (it.state.kind === 'potion') { this.land(it); done = true; break; }
            const d = Math.sqrt(d2) || 0.001;
            p.x = c.x + (dx / d) * (c.r + 0.05);
            p.z = c.z + (dz / d) * (c.r + 0.05);
            it.vel.set((dx / d) * 1.5, 1, (dz / d) * 1.5);
            it.mode = 'flying';
            ctx.sfx.thunk(ctx.pan(p));
          }
        }
        if (done || !thrown || it.mode !== 'thrown') continue;
        // a thrown thing hits like a weapon
        for (const e of ctx.enemies) {
          if (!e.alive) continue;
          const dx = p.x - e.pos.x, dz = p.z - e.pos.z;
          if (dx * dx + dz * dz > 0.3 || p.y > 2.05) continue;
          const dir = tmp2.copy(it.vel).normalize().clone();
          if (it.state.kind === 'potion') {
            ctx.burst(p, it.state.element, true);
            this.remove(it);
          } else {
            const dmg = ITEMS[it.state.kind].throwDmg + ctx.skills.arm * 2;
            const res = ctx.damageEnemy(e, dmg, itemElement(it.state), dir, 8, { knock: 5, from: tmp.copy(p).addScaledVector(dir, -2).clone(), thrown: true, chain: 1 });
            if (res === 'blocked') {
              // glances off the shield and stays in play
              it.vel.set(-dir.x * 2 + (Math.random() - 0.5) * 2, 3.5, -dir.z * 2 + (Math.random() - 0.5) * 2);
              it.mode = 'flying';
            } else {
              this.shatter(it, dir);
            }
          }
          done = true;
          break;
        }
      }
      if (done || !this.list.includes(it)) continue;
      if (it.state.kind === 'arrow' && thrown) {
        // arrows fly point first
        it.group.quaternion.setFromUnitVectors(tmp.set(0, 1, 0), tmp2.copy(it.vel).normalize());
      } else {
        it.group.rotation.x += it.spin.x * dt;
        it.group.rotation.y += it.spin.y * dt;
        it.group.rotation.z += it.spin.z * dt;
      }
      // magical things leave a trail
      const el = itemElement(it.state);
      if (el !== 'none' && Math.random() < dt * 40) ctx.particles.spark(it.pos, 0, 0.4, 0, EL_COLOR[el], 0.06, 0.5);
    }
  }
}
