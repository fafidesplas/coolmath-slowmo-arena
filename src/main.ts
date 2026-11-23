import * as THREE from 'three';
import './style.css';
import { buildWorld, ARENA } from './world';
import { Sfx } from './audio';
import { Particles } from './particles';
import { Projectiles } from './projectiles';
import { Enemy, type EnemyKind } from './enemies';
import { Sword } from './sword';
import { Input } from './input';
import { Post } from './post';
import type { Ctx, PlayerState } from './ctx';

// ---------------------------------------------------------------- setup
const mobile = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
document.body.classList.toggle('touch', mobile);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const pixelRatio = Math.min(devicePixelRatio, mobile ? 1.25 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = !mobile;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.03, 160);
camera.rotation.order = 'YXZ';
scene.add(camera);

const { colliders } = buildWorld(scene, mobile);
const sfx = new Sfx();
const particles = new Particles(scene, mobile);
const projectiles = new Projectiles(scene);
const sword = new Sword(camera);
const post = new Post(renderer, mobile);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = new Input(renderer.domElement, $('touch'));

// push wave visual (camera space)
const pushMat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
const pushRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 40), pushMat);
pushRing.position.z = -1.2;
pushRing.visible = false;
camera.add(pushRing);

// ---------------------------------------------------------------- state
const EYE = 1.62;
const WALK = 5.2;
const MIN_TS = 0.04;
const FIRE_COST = 30;
const PUSH_COST = 50;
const WAVES: EnemyKind[][] = [
  ['archer', 'archer'],
  ['archer', 'sword', 'archer'],
  ['mage', 'sword', 'archer', 'sword'],
  ['archer', 'mage', 'sword', 'sword', 'archer'],
  ['archer', 'archer', 'mage', 'mage', 'sword', 'sword', 'sword'],
];
const SPAWNS: [number, number][] = [
  [-9.5, -9.5], [0, -11.5], [9.5, -9.5], [11.5, -4], [9.5, 6], [0, 11.5], [-8.5, 7], [-11.5, 0], [-5, -11], [5, -11], [-3, -4], [3, -6],
];

type GameState = 'title' | 'playing' | 'paused' | 'dead' | 'victory';
let state: GameState = 'title';
const enemies: Enemy[] = [];
const player: PlayerState = {
  pos: new THREE.Vector3(0, 0, 9.5),
  eye: new THREE.Vector3(),
  forward: new THREE.Vector3(0, 0, -1),
  flatForward: new THREE.Vector3(0, 0, -1),
  blocking: false,
  blockStart: 0,
  swingActive: false,
  alive: true,
};
const vel = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
let ts = MIN_TS;
let boost = 0;
let lookSpeed = 0;
let hitStop = 0;
let shake = 0;
let flash = 0;
let heartTimer = 0;
let heartPulse = 0;
let mana = 100;
let fireCd = 0;
let pushCd = 0;
let pushT = -1;
let wave = 0;
let waveClearT = -1;
let deadT = 0;
let kills = 0;
let runTime = 0;
let realTime = 0;
let wasBlocking = false;

const right = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
const SPARK = new THREE.Color(0xfff0b0);
const CYAN = new THREE.Color(0x7fd8ff);
const RED = new THREE.Color(0xff3030);

function flashColor(c: number, amount: number): void {
  post.uniforms.uFlashColor.value.setHex(c);
  flash = Math.max(flash, amount);
}

const ctx: Ctx = {
  scene,
  sfx,
  particles,
  projectiles,
  enemies,
  colliders,
  player,
  realTime: 0,
  wave: 0,
  mobile,
  pan(pos) {
    tmp.set(pos.x - player.pos.x, 0, pos.z - player.pos.z).normalize();
    return Math.max(-0.8, Math.min(0.8, tmp.dot(right)));
  },
  killEnemy(e, dir, power) {
    if (!e.alive) return;
    e.alive = false;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    for (const m of e.parts) particles.shatter(m, dir, power);
    particles.burst(e.chest(tmp2), 16, RED, 4, 0.06, 0.8);
    scene.remove(e.group);
    e.dispose();
    sfx.shatter(ctx.pan(e.pos));
    hitStop = Math.max(hitStop, 0.075);
    flashColor(0xffffff, 0.22);
    shake = Math.max(shake, 0.12);
    mana = Math.min(100, mana + 20);
    kills++;
  },
  playerHit(from) {
    if (!player.alive || state !== 'playing') return;
    player.alive = false;
    state = 'dead';
    deadT = 0;
    hitStop = 0.2;
    flashColor(0xff2020, 0.75);
    shake = 0.5;
    sfx.death();
    particles.burst(from, 30, RED, 5, 0.07, 1.2, 2);
    hud.classList.add('hidden');
  },
  deflected(pos, perfect) {
    sfx.clang(perfect);
    particles.burst(pos, perfect ? 26 : 14, perfect ? CYAN : SPARK, perfect ? 7 : 4, 0.06, 0.5);
    hitStop = Math.max(hitStop, perfect ? 0.11 : 0.05);
    flashColor(0x9fe6ff, perfect ? 0.3 : 0.14);
    sword.recoil = 1;
    boost = Math.max(boost, 0.35);
    if (perfect) showBanner('PARRY', 600, 'small');
  },
  enemyBlocked(e) {
    sfx.clang(true);
    tmp2.copy(e.pos).lerp(player.pos, 0.5).setY(1.3);
    particles.burst(tmp2, 22, SPARK, 6, 0.06, 0.5);
    e.stun = 1.6;
    e.state = 'recover';
    e.t = 0.2;
    e.vel.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z).normalize().multiplyScalar(4.5);
    sword.recoil = 1;
    hitStop = Math.max(hitStop, 0.09);
    shake = Math.max(shake, 0.2);
    flashColor(0x9fe6ff, 0.2);
  },
  explosion(pos) {
    sfx.explosion(ctx.pan(pos));
    const d = pos.distanceTo(player.eye);
    shake = Math.max(shake, Math.max(0.05, 0.4 - d * 0.03));
    flashColor(0xffb060, 0.25);
    hitStop = Math.max(hitStop, 0.06);
  },
};
projectiles.ctx = ctx;

// ---------------------------------------------------------------- HUD
const hud = $('hud');
const screen = $('screen');
const banner = $('banner');
const timeFill = $('timefill');
const manaFill = $('manafill');
const waveInfo = $('waveinfo');
const spFire = $('sp-fire');
const spPush = $('sp-push');
const touchLayer = $('touch');
let bannerTimer = 0;

function showBanner(text: string, ms: number, cls = ''): void {
  banner.textContent = text;
  banner.className = `show ${cls}`;
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (banner.className = ''), ms);
}

const controlsHtml = mobile
  ? `<p class="controls">Left thumb: move · Right thumb: look<br>SWORD slash · BLOCK hold (deflects arrows) · FIRE · PUSH</p>`
  : `<p class="controls">WASD move · Mouse look · <b>Left click</b> slash · <b>Right click / Shift</b> block &amp; parry<br><b>Q</b> fireball · <b>E</b> force push · <b>R</b> restart</p>`;

function setScreen(html: string): void {
  screen.innerHTML = html;
  screen.classList.remove('hidden');
}

function titleScreen(): void {
  setScreen(`
    <h1>SLOW<span>STEEL</span></h1>
    <p class="tag">Time moves only when you move.</p>
    <p>Stand still and the arrows hang in the air. Walk and the world wakes up.<br>One hit and you shatter. Clear 5 waves of crystal knights.</p>
    ${controlsHtml}
    <button class="go">${mobile ? 'TAP TO PLAY' : 'CLICK TO PLAY'}</button>
    ${mobile ? '<p class="small">Best in landscape</p>' : ''}`);
}

function lockPointer(): void {
  if (mobile) return;
  try {
    const r = renderer.domElement.requestPointerLock() as unknown;
    if (r instanceof Promise) r.catch(() => undefined);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- flow
function clearArena(): void {
  for (const e of enemies) {
    scene.remove(e.group);
    e.dispose();
  }
  enemies.length = 0;
  projectiles.clear();
  particles.clear();
}

function startWave(i: number): void {
  wave = i;
  ctx.wave = i;
  waveClearT = -1;
  const kinds = WAVES[i];
  // prefer mid-range spots in front of the player, never right next to them
  const spots = SPAWNS.map((s) => {
    const dx = s[0] - player.pos.x, dz = s[1] - player.pos.z;
    const d = Math.hypot(dx, dz);
    const front = (dx * player.flatForward.x + dz * player.flatForward.z) / (d || 1);
    return { s, d, score: Math.abs(d - 12) - front * 4 + Math.random() * 4 };
  })
    .filter((o) => o.d > 7.5)
    .sort((a, b) => a.score - b.score);
  kinds.forEach((k, j) => {
    const [x, z] = spots[j % spots.length].s;
    const e = new Enemy(k, x + (Math.random() - 0.5), z + (Math.random() - 0.5));
    e.yaw = Math.atan2(player.pos.x - x, player.pos.z - z);
    scene.add(e.group);
    enemies.push(e);
    sfx.spawn(ctx.pan(e.pos));
  });
  showBanner(`WAVE ${i + 1} / ${WAVES.length}`, 1600);
  sfx.waveStart();
  waveInfo.textContent = `WAVE ${i + 1}/${WAVES.length}`;
}

function startRun(fromWave: number): void {
  clearArena();
  player.pos.set(0, 0, 9.5);
  player.alive = true;
  vel.set(0, 0, 0);
  yaw = 0;
  pitch = 0;
  ts = MIN_TS;
  boost = 0;
  mana = 100;
  fireCd = pushCd = 0;
  hitStop = 0;
  flash = 0;
  deadT = 0;
  sword.reset();
  input.resetTouch();
  if (fromWave === 0) {
    kills = 0;
    runTime = 0;
  }
  state = 'playing';
  screen.classList.add('hidden');
  hud.classList.remove('hidden');
  touchLayer.classList.toggle('hidden', !mobile);
  startWave(fromWave);
  if (fromWave === 0) {
    $('hint').textContent = mobile ? 'Move to make time flow · Block to deflect arrows' : 'Move to make time flow · Right-click to deflect arrows';
    $('hint').classList.add('show');
    setTimeout(() => $('hint').classList.remove('show'), 6000);
  }
}

function onScreenAction(): void {
  sfx.init();
  sfx.click();
  if (state === 'title') {
    lockPointer();
    startRun(0);
  } else if (state === 'paused') {
    lockPointer();
    state = 'playing';
    screen.classList.add('hidden');
    hud.classList.remove('hidden');
  } else if (state === 'dead' && deadT > 0.5) {
    lockPointer();
    startRun(wave);
  } else if (state === 'victory' && deadT > 0.8) {
    lockPointer();
    startRun(0);
  }
}
screen.addEventListener('click', onScreenAction);

document.addEventListener('pointerlockchange', () => {
  if (!mobile && !input.locked && state === 'playing') {
    state = 'paused';
    hud.classList.add('hidden');
    setScreen(`<h2>PAUSED</h2>${controlsHtml}<button class="go">CLICK TO RESUME</button>`);
  }
});

function die(): void {
  setScreen(`
    <h2 class="red">SHATTERED</h2>
    <p>Wave ${wave + 1} / ${WAVES.length} · ${kills} knights broken</p>
    <button class="go">${mobile ? 'TAP' : 'CLICK / R'} TO RETRY WAVE</button>`);
}

function win(): void {
  state = 'victory';
  deadT = 0;
  sfx.victory();
  hud.classList.add('hidden');
  touchLayer.classList.add('hidden');
  setTimeout(() => {
    if (state !== 'victory') return;
    setScreen(`
      <h2>THE KEEP IS STILL</h2>
      <p>All ${WAVES.length} waves cleared · ${kills} knights shattered · ${runTime.toFixed(1)}s</p>
      <button class="go">${mobile ? 'TAP' : 'CLICK / R'} TO PLAY AGAIN</button>`);
  }, 1400);
}

// ---------------------------------------------------------------- actions
function castFireball(): void {
  if (fireCd > 0) return;
  if (mana < FIRE_COST) {
    sfx.empty();
    return;
  }
  mana -= FIRE_COST;
  fireCd = 0.45;
  boost = Math.max(boost, 0.6);
  const from = tmp.copy(player.eye).addScaledVector(player.forward, 0.8).addScaledVector(right, 0.12).add(tmp2.set(0, -0.12, 0));
  const dir = projectiles.aimAssist(from, player.forward, 0.97);
  projectiles.spawn('fireball', 'player', from, dir.multiplyScalar(24));
  sfx.fireball();
  shake = Math.max(shake, 0.05);
}

function castPush(): void {
  if (pushCd > 0) return;
  if (mana < PUSH_COST) {
    sfx.empty();
    return;
  }
  mana -= PUSH_COST;
  pushCd = 1;
  pushT = 0;
  boost = Math.max(boost, 0.7);
  sfx.push();
  shake = Math.max(shake, 0.22);
  flashColor(0x9fe6ff, 0.18);
  hitStop = Math.max(hitStop, 0.05);
  const fwd = player.flatForward;
  for (const e of [...enemies]) {
    tmp.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z);
    const d = tmp.length();
    if (d > 8 || d < 0.01) continue;
    tmp.divideScalar(d);
    if (tmp.dot(fwd) < 0.45 && d > 1.5) continue;
    if (d < 2.6) {
      ctx.killEnemy(e, tmp.clone().setY(0.4).normalize(), 10);
    } else {
      e.vel.copy(tmp).multiplyScalar(16 - d);
      e.stun = 1.8;
      e.state = e.state === 'spawn' ? 'spawn' : 'recover';
      e.t = 0.3;
    }
  }
  for (const p of [...projectiles.list]) {
    if (p.owner !== 'enemy' || p.stuck) continue;
    tmp.copy(p.pos).sub(player.eye);
    const d = tmp.length();
    if (d > 8) continue;
    tmp.divideScalar(d);
    if (tmp.dot(player.forward) < 0.3 && d > 2.5) continue;
    p.vel.copy(tmp).multiplyScalar(Math.max(14, p.vel.length() * 1.3));
    p.owner = 'player';
    p.origin.copy(p.pos);
    p.trailMat.color.setHex(0x2fa8ff);
  }
  // force wave sparks (world time → they hang in the air too)
  for (let i = 0; i < (mobile ? 24 : 44); i++) {
    tmp.copy(player.forward)
      .add(tmp2.set((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 1.2))
      .normalize()
      .multiplyScalar(10 + Math.random() * 8);
    particles.spark(tmp2.copy(player.eye).addScaledVector(player.forward, 0.8), tmp.x, tmp.y, tmp.z, CYAN, 0.05, 0.7, 0, 2.5);
  }
}

function swingHits(): void {
  const fwd = player.flatForward;
  for (const e of [...enemies]) {
    tmp.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z);
    const d = tmp.length();
    if (d > 2.7) continue;
    if (d > 0.9 && tmp.divideScalar(d).dot(fwd) < 0.4) continue;
    tmp2.copy(fwd).addScaledVector(right, -0.7 * sword.side).setY(0.25).normalize();
    ctx.killEnemy(e, tmp2, 7);
  }
}

// ---------------------------------------------------------------- loop
function resize(): void {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h);
  post.setSize(Math.floor(w * pixelRatio), Math.floor(h * pixelRatio));
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const realDt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  realTime += realDt;
  ctx.realTime = realTime;
  const playing = state === 'playing';

  // --- look
  if (playing) {
    yaw -= input.lookDX;
    pitch = Math.max(-1.45, Math.min(1.45, pitch - input.lookDY));
    const ls = Math.hypot(input.lookDX, input.lookDY) / Math.max(realDt, 0.001);
    lookSpeed += (ls - lookSpeed) * (1 - Math.exp(-14 * realDt));
  } else {
    lookSpeed *= 0.8;
  }

  // --- movement (always real time: you are never slowed)
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  player.flatForward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  player.blocking = playing && input.block;
  if (player.blocking && !wasBlocking) player.blockStart = realTime;
  wasBlocking = player.blocking;
  const want = tmp.set(0, 0, 0);
  if (playing) {
    want.addScaledVector(player.flatForward, input.moveY).addScaledVector(right, input.moveX);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(player.blocking ? WALK * 0.55 : WALK);
  }
  vel.lerp(want, 1 - Math.exp(-11 * realDt));
  player.pos.addScaledVector(vel, realDt);
  for (const c of colliders) {
    const dx = player.pos.x - c.x, dz = player.pos.z - c.z;
    const min = c.r + 0.35;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min) {
      const d = Math.sqrt(d2) || 0.001;
      player.pos.x = c.x + (dx / d) * min;
      player.pos.z = c.z + (dz / d) * min;
    }
  }
  const lim = ARENA - 0.35;
  player.pos.x = Math.max(-lim, Math.min(lim, player.pos.x));
  player.pos.z = Math.max(-lim, Math.min(lim, player.pos.z));
  const moveI = Math.min(1, vel.length() / WALK);

  // --- actions
  if (playing) {
    if (input.attack && sword.startSwing()) {
      sfx.swing();
      boost = Math.max(boost, 0.5);
    }
    if (input.fire) castFireball();
    if (input.push) castPush();
  } else if ((state === 'dead' && deadT > 0.5) || (state === 'victory' && deadT > 0.8)) {
    if (input.restart || input.attack) onScreenAction();
  }
  if (input.restart && playing) startRun(wave);
  fireCd -= realDt;
  pushCd -= realDt;

  // --- time scale: the heart of the game
  boost = Math.max(0, boost - realDt * 2.2);
  let target = Math.max(MIN_TS, moveI, Math.min(1, lookSpeed / 5) * 0.32, boost);
  if (state === 'dead') target = 0.015;
  if (state === 'victory') target = 0.25;
  if (state === 'title') target = 0.12;
  if (state === 'paused') target = 0;
  ts += (target - ts) * (1 - Math.exp(-(target > ts ? 6 : 3) * realDt));

  let worldDt = realDt * ts;
  const swordDt = hitStop > 0 ? realDt * 0.15 : realDt;
  if (hitStop > 0) {
    hitStop -= realDt;
    worldDt = 0;
  }
  if (state === 'paused') worldDt = 0;

  // --- camera / player state
  camera.position.set(player.pos.x, EYE, player.pos.z);
  if (playing) camera.position.y += Math.abs(Math.sin(realTime * 9)) * 0.05 * moveI;
  let roll = 0;
  if (state === 'dead') {
    deadT += realDt;
    const k = Math.min(1, deadT / 1.1);
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.y = EYE - e * 1.1;
    roll = e * 0.5;
    if (deadT - realDt < 1.0 && deadT >= 1.0) die();
  } else if (state === 'victory') {
    deadT += realDt;
  }
  camera.rotation.set(pitch, yaw, roll);
  if (shake > 0) {
    shake = Math.max(0, shake - realDt * 1.6);
    const s = shake * shake;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.rotation.z += (Math.random() - 0.5) * s * 0.3;
  }
  camera.fov = 75 + moveI * 4 - (1 - ts) * 3;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  player.eye.copy(camera.position);
  camera.getWorldDirection(player.forward);

  // --- simulate
  sword.update(playing || state === 'title' ? swordDt : 0, moveI, player.blocking);
  player.swingActive = sword.active;
  if (playing && sword.active) swingHits();
  for (const e of [...enemies]) e.update(worldDt, hitStop > 0 ? 0 : realDt, ctx);
  projectiles.update(worldDt, realDt);
  particles.update(worldDt);

  if (playing) {
    runTime += realDt;
    mana = Math.min(100, mana + worldDt * 7);
    if (enemies.length === 0 && waveClearT < 0) {
      waveClearT = 1.6;
      if (wave >= WAVES.length - 1) win();
      else showBanner('CLEARED', 1200, 'small');
    }
    if (waveClearT > 0) {
      waveClearT -= realDt;
      if (waveClearT <= 0) startWave(wave + 1);
    }
  }

  // push ring anim (real time)
  if (pushT >= 0) {
    pushT += realDt;
    const k = pushT / 0.4;
    pushRing.visible = k < 1;
    pushRing.scale.setScalar(0.5 + k * 3.5);
    pushMat.opacity = 0.7 * (1 - k);
    if (k >= 1) pushT = -1;
  }

  // --- heartbeat
  heartTimer -= realDt;
  const slowness = 1 - ts;
  if (heartTimer <= 0 && playing) {
    heartTimer = 0.9 - 0.2 * slowness;
    const v = Math.pow(slowness, 1.5) * 0.9;
    if (v > 0.06) {
      sfx.heartbeat(v);
      heartPulse = v;
    }
  }
  heartPulse = Math.max(0, heartPulse - realDt * 3);

  // --- audio + post
  sfx.setTimeScale(state === 'paused' ? 0.3 : ts);
  flash = Math.max(0, flash - realDt * 3.2);
  const u = post.uniforms;
  u.uSlow.value = state === 'title' ? 0.3 : slowness;
  u.uFlash.value = flash;
  u.uHeart.value = heartPulse;
  u.uDead.value = state === 'dead' ? Math.min(1, deadT * 1.5) : 0;

  // --- HUD
  if (playing) {
    timeFill.style.transform = `scaleX(${ts.toFixed(3)})`;
    manaFill.style.transform = `scaleX(${(mana / 100).toFixed(3)})`;
    spFire.classList.toggle('ready', mana >= FIRE_COST && fireCd <= 0);
    spPush.classList.toggle('ready', mana >= PUSH_COST && pushCd <= 0);
    touchLayer.querySelector('[data-act="fire"]')?.classList.toggle('dim', mana < FIRE_COST);
    touchLayer.querySelector('[data-act="push"]')?.classList.toggle('dim', mana < PUSH_COST);
  }

  // title screen: slow orbit
  if (state === 'title') {
    yaw = Math.sin(realTime * 0.1) * 0.6;
    pitch = 0.05;
  }

  post.render(renderer, scene, camera);
  input.endFrame();
}

titleScreen();
requestAnimationFrame(frame);

// tiny debug handle for automated testing
(window as unknown as { __slowsteel: object }).__slowsteel = {
  get state() { return state; },
  get timeScale() { return ts; },
  get enemies() { return enemies.length; },
  get projectiles() { return projectiles.list.length; },
  get wave() { return wave; },
};
