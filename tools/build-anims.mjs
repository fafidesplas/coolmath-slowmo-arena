// Extracts the skeleton and a handful of clips from Quaternius' Universal Animation Library (CC0)
// into a compact rig.json + rig.bin that the game loads at start.
//   node tools/build-anims.mjs
// Source: https://quaternius.itch.io/universal-animation-library  (Standard, Unreal-Godot/UAL1_Standard.glb)
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const SRC = new URL('./src-assets/UAL1_Standard.glb', import.meta.url);
const OUT = new URL('../public/anim/', import.meta.url);
const FPS = 30;
const BONES = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r'];
const CLIPS = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sword_Idle', 'Sword_Attack',
  'Spell_Simple_Enter', 'Spell_Simple_Idle_Loop', 'Spell_Simple_Shoot', 'Spell_Simple_Exit', 'Hit_Chest', 'Hit_Head', 'Punch_Cross'];
const POS_BONES = new Set(['root', 'pelvis']);

const buf = fs.readFileSync(SRC);
const gltf = await new Promise((res, rej) => new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const scene = gltf.scene;
scene.updateMatrixWorld(true);
const byName = {};
scene.traverse((o) => { byName[o.name] = o; });

// rest pose, with everything above `root` baked into it
const rootParent = byName.root.parent;
const bones = BONES.map((name) => {
  const b = byName[name];
  if (!b) throw new Error('missing bone ' + name);
  const m = b.matrix.clone();
  if (name === 'root') m.premultiply(rootParent.matrixWorld);
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  let parent = -1;
  if (name !== 'root') {
    let a = b.parent;
    while (a && !BONES.includes(a.name)) a = a.parent;
    parent = BONES.indexOf(a.name);
    if (a !== b.parent) throw new Error('skipped parent for ' + name);
  }
  return { name, parent, p: p.toArray(), q: q.toArray(), s: s.toArray() };
});

const floats = [];
const clips = [];
const mixer = new THREE.AnimationMixer(scene);
const wp = new THREE.Vector3();
for (const name of CLIPS) {
  const clip = gltf.animations.find((c) => c.name === name);
  if (!clip) throw new Error('missing clip ' + name);
  mixer.stopAllAction();
  const action = mixer.clipAction(clip);
  action.play();
  const frames = Math.max(2, Math.round(clip.duration * FPS) + 1);
  const offset = floats.length;
  let peak = 0, peakT = 0; const prev = new THREE.Vector3();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration - 1e-4, (f / (frames - 1)) * clip.duration);
    mixer.setTime(t);
    for (const bn of BONES) {
      const b = byName[bn];
      if (POS_BONES.has(bn)) {
        if (bn === 'root') { wp.copy(b.position).applyMatrix4(rootParent.matrixWorld); floats.push(wp.x, wp.y, wp.z); }
        else floats.push(b.position.x, b.position.y, b.position.z);
      }
      if (bn === 'root') {
        const q = new THREE.Quaternion().setFromRotationMatrix(rootParent.matrixWorld.clone().multiply(b.matrix));
        floats.push(q.x, q.y, q.z, q.w);
      } else floats.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
    scene.updateMatrixWorld(true);
    byName.hand_r.getWorldPosition(wp);
    if (f > 0) { const v = wp.distanceTo(prev); if (v > peak) { peak = v; peakT = t; } }
    prev.copy(wp);
  }
  clips.push({ name, duration: +clip.duration.toFixed(4), frames, offset, peakHandR: +peakT.toFixed(3) });
  action.stop();
}

// handy facts for laying pieces on the rig
mixer.stopAllAction();
for (const b of bones) { const o = byName[b.name]; if (b.name !== 'root') { o.position.fromArray(b.p); o.quaternion.fromArray(b.q); } }
scene.updateMatrixWorld(true);
const rest = {};
for (const bn of BONES) { byName[bn].getWorldPosition(wp); rest[bn] = wp.toArray().map((v) => +v.toFixed(3)); }
console.log('rest world positions', rest);
console.log(clips);

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(new URL('rig.json', OUT), JSON.stringify({ fps: FPS, posBones: [...POS_BONES], bones, clips }));
fs.writeFileSync(new URL('rig.bin', OUT), Buffer.from(new Float32Array(floats).buffer));
console.log('wrote', floats.length * 4, 'bytes');
