import * as THREE from 'three';

/**
 * Shared humanoid skeleton + animation clips, extracted by tools/build-anims.mjs from
 * Quaternius' Universal Animation Library (CC0). Enemies hang rigid crystal pieces on the bones.
 */
interface RigData {
  fps: number;
  posBones: string[];
  bones: { name: string; parent: number; p: number[]; q: number[]; s: number[] }[];
  clips: { name: string; duration: number; frames: number; offset: number }[];
}

const LOWER = new Set(['root', 'pelvis', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);

let data: RigData | null = null;
const clips = new Map<string, THREE.AnimationClip>();
/** Joint positions in the rest (T) pose, character space: +Y up, +Z forward, +X the character's left. */
export const REST: Record<string, THREE.Vector3> = {};
const REST_INV: Record<string, THREE.Quaternion> = {};

export interface Rig {
  root: THREE.Object3D;
  bones: Record<string, THREE.Object3D>;
  /** A group on the bone whose axes match character space while in the rest pose. */
  holder(bone: string): THREE.Group;
}

function build(): { root: THREE.Object3D; bones: Record<string, THREE.Object3D> } {
  const bones: Record<string, THREE.Object3D> = {};
  const list = data!.bones.map((b) => {
    const o = new THREE.Object3D();
    o.name = b.name;
    o.position.fromArray(b.p);
    o.quaternion.fromArray(b.q);
    o.scale.fromArray(b.s);
    bones[b.name] = o;
    return o;
  });
  data!.bones.forEach((b, i) => {
    if (b.parent >= 0) list[b.parent].add(list[i]);
  });
  return { root: list[0], bones };
}

export async function loadRig(base: string): Promise<void> {
  const [json, bin] = await Promise.all([
    fetch(`${base}anim/rig.json`).then((r) => r.json() as Promise<RigData>),
    fetch(`${base}anim/rig.bin`).then((r) => r.arrayBuffer()),
  ]);
  data = json;
  const f = new Float32Array(bin);
  const pos = new Set(json.posBones);
  const stride = json.bones.reduce((n, b) => n + 4 + (pos.has(b.name) ? 3 : 0), 0);
  for (const c of json.clips) {
    const times = new Float32Array(c.frames);
    for (let i = 0; i < c.frames; i++) times[i] = (i / (c.frames - 1)) * c.duration;
    const all: THREE.KeyframeTrack[] = [];
    const up: THREE.KeyframeTrack[] = [];
    const low: THREE.KeyframeTrack[] = [];
    let o = 0;
    for (const b of json.bones) {
      const side = LOWER.has(b.name) ? low : up;
      if (pos.has(b.name)) {
        const v = new Float32Array(c.frames * 3);
        for (let i = 0; i < c.frames; i++) v.set(f.subarray(c.offset + i * stride + o, c.offset + i * stride + o + 3), i * 3);
        const t = new THREE.VectorKeyframeTrack(`${b.name}.position`, times, v);
        all.push(t);
        side.push(t);
        o += 3;
      }
      const v = new Float32Array(c.frames * 4);
      for (let i = 0; i < c.frames; i++) v.set(f.subarray(c.offset + i * stride + o, c.offset + i * stride + o + 4), i * 4);
      const t = new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, v);
      all.push(t);
      side.push(t);
      o += 4;
    }
    clips.set(c.name, new THREE.AnimationClip(c.name, c.duration, all));
    clips.set(`${c.name}:U`, new THREE.AnimationClip(`${c.name}:U`, c.duration, up));
    clips.set(`${c.name}:L`, new THREE.AnimationClip(`${c.name}:L`, c.duration, low));
  }
  const t = build();
  t.root.updateMatrixWorld(true);
  const q = new THREE.Quaternion();
  for (const name of Object.keys(t.bones)) {
    REST[name] = t.bones[name].getWorldPosition(new THREE.Vector3());
    REST_INV[name] = t.bones[name].getWorldQuaternion(q).clone().invert();
  }
}

/** `name`, `name:U` (upper body only) or `name:L` (hips and legs only). */
export function clip(name: string): THREE.AnimationClip {
  const c = clips.get(name);
  if (!c) throw new Error(`unknown clip ${name}`);
  return c;
}

export function createRig(): Rig {
  const { root, bones } = build();
  const holders: Record<string, THREE.Group> = {};
  return {
    root,
    bones,
    holder(bone) {
      let h = holders[bone];
      if (!h) {
        h = new THREE.Group();
        h.quaternion.copy(REST_INV[bone]);
        bones[bone].add(h);
        holders[bone] = h;
      }
      return h;
    },
  };
}

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const va = new THREE.Vector3();

/** Apply a world-space rotation on top of a bone's current pose. */
export function rotateWorld(bone: THREE.Object3D, qWorld: THREE.Quaternion): void {
  bone.parent!.getWorldQuaternion(qa);
  // local' = P⁻¹ · R · P · local
  qb.copy(qa).invert().multiply(qWorld).multiply(qa);
  bone.quaternion.premultiply(qb);
}

/** Swing a bone so that it points from its joint along `dir` (world space), by `weight`. */
export function aimBone(bone: THREE.Object3D, child: THREE.Object3D, dir: THREE.Vector3, weight: number): void {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(qa);
  va.copy(child.position).normalize().applyQuaternion(qa);
  qb.setFromUnitVectors(va, dir);
  if (weight < 1) qb.slerp(qa.identity(), 1 - weight);
  rotateWorld(bone, qb);
}
