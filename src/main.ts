import * as THREE from 'three';
import './style.css';
import { buildWorld, ARENA } from './world';
import { Sfx } from './audio';
import { Particles } from './particles';
import { Projectiles, type Projectile } from './projectiles';
import { Enemy, type EnemyKind } from './enemies';
import { Hand } from './sword';
import { Input } from './input';
import { Post } from './post';
import { Effects } from './effects';
import { loadRig } from './rig';
import { ELEMENTS, EL_COLOR, EL_CSS, EL_HEX, EL_NAME, elementMult, type Element } from './elements';
import { ITEMS, Items, itemElement, itemName, makeItem, type ItemKind, type ItemState, type WorldItem } from './items';
import { emptySkills, rollChoices, type SkillDef, type SkillId } from './skills';
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
const items = new Items(scene);
const hand = new Hand(camera);
const post = new Post(renderer, mobile);
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = new Input(renderer.domElement, $('touch'));
const fx = new Effects(scene, camera, $('fx'));

// ---------------------------------------------------------------- state
const EYE = 1.62;
const WALK = 5.2;
const REACH = 3.3;
const SPAWNS: [number, number][] = [
  [-9.5, -9.5], [0, -11.5], [9.5, -9.5], [11.5, -4], [9.5, 6], [0, 11.5], [-8.5, 7], [-11.5, 0], [-5, -11], [5, -11], [-3, -4], [3, -6],
];
const START_WEAPONS: { kind: ItemKind; uses: number; desc: string }[] = [
  { kind: 'sword', uses: 5, desc: 'Fast and balanced. One clean stroke per knight, five strokes before it breaks.' },
  { kind: 'hammer', uses: 3, desc: 'Slow, wide and brutal. Splits shields and sends survivors flying. Three blows.' },
  { kind: 'bow', uses: 4, desc: 'Four arrows. Pick spent ones up again, or take them from fallen archers.' },
];

type GameState = 'loading' | 'title' | 'armory' | 'playing' | 'paused' | 'levelup' | 'dead';
let state: GameState = 'loading';
const enemies: Enemy[] = [];
const player: PlayerState = {
  pos: new THREE.Vector3(0, 0, 9.5),
  eye: new THREE.Vector3(),
  forward: new THREE.Vector3(0, 0, -1),
  flatForward: new THREE.Vector3(0, 0, -1),
  blocking: false,
  swingActive: false,
  alive: true,
};
const vel = new THREE.Vector3();
let yaw = 0;
let pitch = 0;
let ts = 0.04;
let boost = 0;
let lookSpeed = 0;
let hitStop = 0;
let shake = 0;
let flash = 0;
let heartTimer = 0;
let heartPulse = 0;
let deadT = 0;
let kills = 0;
let runTime = 0;
let realTime = 0;

// --- the run
const skills = emptySkills();
let held: ItemState | null = null;
let heldMax = 1;
let wornSwing = -1;
let level = 1;
let xp = 0;
let hp = 3;
let maxHp = 3;
let invuln = 0;
let chill = 0;
let spawnT = 0;
let yardT = 0;
let seenElemental = false;
let seenShield = false;
let choices: SkillDef[] = [];
let target: WorldItem | null = null;
let targetShot: Projectile | null = null;
let best = Number(localStorage.getItem('slowsteel-best') ?? 0);

const xpNeed = () => 2 + level * 2;

const right = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
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
  items,
  enemies,
  colliders,
  player,
  realTime: 0,
  level: 1,
  mobile,
  skills,
  pan(pos) {
    tmp.set(pos.x - player.pos.x, 0, pos.z - player.pos.z).normalize();
    return Math.max(-0.8, Math.min(0.8, tmp.dot(right)));
  },
  damageEnemy(e, dmg, el, dir, power, o = {}) {
    if (!e.alive) return 'none';
    const at = e.chest(new THREE.Vector3());
    // a raised shield stops anything that comes from the front
    if (o.from && !o.dot && e.blocks(o.from)) {
      sfx.clang(false);
      particles.burst(tmp.copy(at).addScaledVector(dir, -0.45), 14, SPARK, 5, 0.06, 0.5, 4);
      fx.text(at, o.heavy ? 'SHIELD SPLIT' : 'BLOCKED', '#e8e8e8');
      e.hitShield(ctx, !!o.heavy, dir);
      if (o.thrown || o.heavy) e.stun = Math.max(e.stun, 0.8);
      e.vel.addScaledVector(tmp.set(dir.x, 0, dir.z).normalize(), o.heavy ? 5 : 1.5);
      hitStop = Math.max(hitStop, 0.04);
      return 'blocked';
    }
    const mult = elementMult(el, e.element);
    if (mult === 0) {
      if (!o.dot) {
        fx.text(at, 'IMMUNE', '#c8c8c8');
        sfx.immune(ctx.pan(at));
        particles.burst(at, 6, EL_COLOR[e.element], 3, 0.05, 0.4);
      }
      return 'immune';
    }
    let d = dmg * mult;
    if (e.frozen > 0 && el !== 'ice') {
      // frozen crystal is brittle
      d *= 2;
      e.frozen = 0;
      particles.burst(at, 18, EL_COLOR.ice, 6, 0.07, 0.6, 3);
      fx.text(at, 'SHATTER', EL_CSS.ice);
    } else if (mult > 1 && !o.dot) {
      fx.text(at, 'WEAK!', EL_CSS[el]);
    }
    e.hp -= d;
    if (!o.dot || o.freeze) {
      if (el === 'fire') e.burn = 3;
      else if (el === 'ice') {
        e.frozen = Math.max(e.frozen, o.freeze ?? 1.5);
        sfx.freeze(ctx.pan(at));
      } else if (el === 'storm') e.stun = Math.max(e.stun, 0.7);
    }
    let res: 'hit' | 'kill' = 'hit';
    if (e.hp <= 0) {
      ctx.killEnemy(e, dir, power);
      res = 'kill';
    } else {
      e.hitT = 1;
      if (o.knock) {
        e.vel.addScaledVector(tmp.set(dir.x, 0, dir.z).normalize(), o.knock);
        if (o.knock > 6) e.stun = Math.max(e.stun, 0.8);
      }
      particles.burst(at, o.dot ? 4 : 10, el === 'none' ? SPARK : EL_COLOR[el], 4, 0.05, 0.4);
      if (!o.dot) {
        sfx.hit(ctx.pan(at));
        hitStop = Math.max(hitStop, 0.035);
        // a solid hit knocks the weapon out of their hand
        e.dropWeapon(ctx);
      }
    }
    // lightning leaps to the nearest knight
    if (el === 'storm' && (o.chain ?? 0) > 0) {
      const seen = o.seen ?? new Set<Enemy>();
      seen.add(e);
      let next: Enemy | null = null;
      let bestD = 6;
      for (const o2 of enemies) {
        if (!o2.alive || seen.has(o2) || o2.element === 'storm') continue;
        const dd = Math.hypot(o2.pos.x - at.x, o2.pos.z - at.z);
        if (dd < bestD) {
          bestD = dd;
          next = o2;
        }
      }
      if (next) {
        const to = next.chest(new THREE.Vector3());
        fx.bolt(at, to);
        sfx.zap(ctx.pan(to));
        ctx.damageEnemy(next, Math.max(1, dmg * 0.7), 'storm', to.clone().sub(at).normalize(), power, { chain: (o.chain ?? 0) - 1, seen });
      }
    }
    return res;
  },
  killEnemy(e, dir, power) {
    if (!e.alive) return;
    e.alive = false;
    const i = enemies.indexOf(e);
    if (i >= 0) enemies.splice(i, 1);
    // whatever they carried is yours to catch
    e.dropAll(ctx);
    for (const m of e.parts) particles.shatter(m, dir, power);
    const at = e.chest(new THREE.Vector3());
    particles.burst(at, 16, e.element === 'none' ? RED : EL_COLOR[e.element], 4, 0.06, 0.8);
    scene.remove(e.group);
    e.dispose();
    sfx.shatter(ctx.pan(e.pos));
    hitStop = Math.max(hitStop, 0.075);
    flashColor(0xffffff, 0.22);
    shake = Math.max(shake, 0.12);
    kills++;
    xp += e.element === 'none' ? 1 : 2;
    // elementals release their element when they break
    const el = e.element;
    if (el !== 'none') {
      fx.ring(at, 3.2, EL_HEX[el], 0.45);
      for (const o of [...enemies]) {
        if (!o.alive) continue;
        const dd = Math.hypot(o.pos.x - at.x, o.pos.z - at.z);
        if (dd > 3.2) continue;
        if (el === 'storm') fx.bolt(at, o.chest(tmp2.clone()));
        ctx.damageEnemy(o, 1, el, o.pos.clone().sub(e.pos).setY(0.3).normalize(), 6, { freeze: 2.5 });
      }
      if (el === 'storm') sfx.zap(ctx.pan(at));
      if (el === 'ice') sfx.freeze(ctx.pan(at));
    }
  },
  playerHit(from, el) {
    if (!player.alive || state !== 'playing' || invuln > 0) return;
    hp--;
    renderHearts();
    particles.burst(from, 30, RED, 5, 0.07, 1.2, 2);
    if (hp <= 0) {
      player.alive = false;
      state = 'dead';
      deadT = 0;
      hitStop = 0.2;
      flashColor(0xff2020, 0.75);
      shake = 0.5;
      sfx.death();
      hud.classList.add('hidden');
      touchLayer.classList.add('hidden');
      return;
    }
    invuln = 1.3;
    hitStop = 0.14;
    shake = 0.38;
    flashColor(el === 'ice' ? 0x9fe8ff : 0xff2020, 0.6);
    sfx.hurt();
    if (el === 'ice') {
      chill = 3.5;
      showBanner('CHILLED', 700, 'small');
    }
    // the blow throws everything back a step: a breath to recover
    for (const e of enemies) {
      tmp.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z);
      const d = tmp.length();
      if (d < 3.5 && d > 0.01) {
        e.vel.copy(tmp.divideScalar(d)).multiplyScalar(7);
        e.stun = Math.max(e.stun, 0.8);
        if (e.state !== 'spawn') { e.state = 'recover'; e.t = 0.4; }
      }
    }
    for (const p of [...projectiles.list]) {
      if (p.owner === 'enemy' && p.pos.distanceTo(player.eye) < 3) projectiles.remove(p);
    }
  },
  blocked(pos, magic, shield) {
    sfx.clang(false);
    if (magic) sfx.fizz(ctx.pan(pos));
    particles.burst(pos, 14, magic ? CYAN : SPARK, 4, 0.06, 0.5, magic ? 0 : 4);
    hitStop = Math.max(hitStop, 0.04);
    hand.recoil = 1;
    boost = Math.max(boost, 0.25);
    if (shield) wear();
  },
  burst(pos, el, big) {
    const R = (big ? 3.4 : 2.6) * (skills.alchemist ? 1.3 : 1);
    const at = pos.clone();
    fx.ring(at, R, EL_HEX[el], 0.5);
    particles.burst(at, 40, EL_COLOR[el], 8, 0.09, 0.8, el === 'fire' ? 1.5 : 0);
    if (el === 'fire') ctx.explosion(at);
    else {
      if (el === 'ice') sfx.freeze(ctx.pan(at));
      else sfx.zap(ctx.pan(at));
      flashColor(EL_HEX[el], 0.2);
      shake = Math.max(shake, 0.1);
    }
    for (const e of [...enemies]) {
      if (!e.alive) continue;
      tmp.set(e.pos.x - at.x, 0, e.pos.z - at.z);
      if (tmp.length() > R) continue;
      const dir = tmp.clone().setY(0.4).normalize();
      if (el === 'storm') fx.bolt(at, e.chest(new THREE.Vector3()));
      ctx.damageEnemy(e, el === 'fire' ? 3 : el === 'storm' ? 2 : 1, el, dir, 8, { freeze: 3.2, knock: el === 'fire' ? 4 : 0 });
    }
    for (const p of [...projectiles.list]) {
      if (p.owner === 'enemy' && p.pos.distanceTo(at) < R) {
        particles.burst(p.pos, 8, EL_COLOR[el], 2.5, 0.06, 0.6, 5);
        projectiles.remove(p);
      }
    }
  },
  enemyBlocked(e) {
    sfx.clang(true);
    tmp2.copy(e.pos).lerp(player.pos, 0.5).setY(1.3);
    particles.burst(tmp2, 22, SPARK, 6, 0.06, 0.5);
    e.stun = 1.6;
    e.state = 'recover';
    e.t = 0.2;
    e.vel.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z).normalize().multiplyScalar(4.5);
    hand.recoil = 1;
    hitStop = Math.max(hitStop, 0.09);
    shake = Math.max(shake, 0.2);
    flashColor(0x9fe6ff, 0.2);
    wear();
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
items.ctx = ctx;

// ---------------------------------------------------------------- HUD
const hud = $('hud');
const screen = $('screen');
const banner = $('banner');
const timeFill = $('timefill');
const xpFill = $('xpfill');
const lvlEl = $('lvl');
const heartsEl = $('hearts');
const heldEl = $('held');
const promptEl = $('prompt');
const hintEl = $('hint');
const touchLayer = $('touch');
const grabBtn = touchLayer.querySelector<HTMLElement>('[data-act="grab"]')!;
const throwBtn = touchLayer.querySelector<HTMLElement>('[data-act="throw"]')!;
let bannerTimer = 0;
let hintTimer = 0;
let promptText = '';

function showBanner(text: string, ms: number, cls = ''): void {
  banner.textContent = text;
  banner.className = `show ${cls}`;
  clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => (banner.className = ''), ms);
}

function showHint(text: string, ms = 6000): void {
  hintEl.textContent = text;
  hintEl.classList.add('show');
  clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => hintEl.classList.remove('show'), ms);
}

function renderHearts(): void {
  heartsEl.innerHTML = Array.from({ length: maxHp }, (_, i) => `<i class="${i < hp ? 'on' : ''}"></i>`).join('');
}

/** What is in the hand, and how much of it is left. */
function renderHeld(): void {
  if (!held) {
    heldEl.innerHTML = '<b>Bare hands</b><span class="sub">punch to stagger and disarm</span>';
    heldEl.style.setProperty('--c', '#fff');
    return;
  }
  const h = held;
  const d = ITEMS[h.kind];
  const n = Math.max(heldMax, h.uses);
  const pips = d.unit ? `<div class="pips">${Array.from({ length: n }, (_, i) => `<i class="${i < h.uses ? 'on' : ''}"></i>`).join('')}</div>` : '';
  const coat = h.imbueUses > 0 ? `<span class="sub">${EL_NAME[h.imbue]} coating · ${h.imbueUses}</span>` : '';
  heldEl.innerHTML = `<b>${itemName(h)}</b>${pips}${coat}`;
  heldEl.style.setProperty('--c', EL_CSS[itemElement(h)]);
}

function equip(s: ItemState | null): void {
  held = s;
  heldMax = s ? s.uses : 1;
  hand.setItem(s);
  // only a coating glows; staffs and flasks already show their element
  hand.setTint(s && s.imbueUses > 0 ? EL_HEX[s.imbue] : null);
  renderHeld();
}

const controlsHtml = mobile
  ? `<p class="controls">Left thumb: move · Right thumb: look<br>ATTACK · THROW what you hold · GRAB what you aim at</p>`
  : `<p class="controls">WASD move · Mouse look · <b>Left click</b> attack / use · <b>Right click</b> throw what you hold<br><b>E</b> grab or swap the thing you are looking at</p>`;

function setScreen(html: string): void {
  screen.innerHTML = html;
  screen.classList.remove('hidden');
}

function titleScreen(): void {
  state = 'title';
  setScreen(`
    <h1>SLOW<span>STEEL</span></h1>
    <p class="tag">Time moves only when you move.</p>
    <p>Stand still and the arrows hang in the air. Walk and the world wakes up.<br>Nothing lasts: weapons break, so take the next one out of the air, off the ground, or out of a knight's hands.</p>
    ${controlsHtml}
    <button class="go">${mobile ? 'TAP TO PLAY' : 'CLICK TO PLAY'}</button>
    ${best ? `<p class="small">Best run: level ${best}</p>` : mobile ? '<p class="small">Best in landscape</p>' : ''}`);
}

function armoryScreen(): void {
  state = 'armory';
  hud.classList.add('hidden');
  touchLayer.classList.add('hidden');
  const cards = START_WEAPONS.map((w, i) => `<button class="card" data-weapon="${i}"><span class="kind">START WITH</span><b>${ITEMS[w.kind].name}</b><span>${w.desc}</span></button>`).join('');
  setScreen(`<h2>CHOOSE YOUR FIRST WEAPON</h2><div class="cards">${cards}</div><p class="small">It will not last. The rest you take from the yard.</p>`);
}

function levelUpScreen(): void {
  const cards = choices
    .map((s, i) => {
      const lvl = s.max > 1 ? ` ${'I'.repeat(skills[s.id] + 1)}` : '';
      return `<button class="card" data-pick="${i}"><span class="kind">UPGRADE</span><b>${s.name}${lvl}</b><span>${s.desc}</span>${mobile ? '' : `<i>${i + 1}</i>`}</button>`;
    })
    .join('');
  setScreen(`<h2>LEVEL ${level}</h2><p class="tag">Choose an upgrade</p><div class="cards">${cards}</div>`);
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
  items.clear();
  fx.clear();
}

function spawnEnemy(kind?: EnemyKind, element?: Element, shield?: boolean): Enemy {
  if (!kind) {
    const r = Math.random();
    kind = level < 2 ? (r < 0.55 ? 'archer' : 'sword') : r < 0.4 ? 'archer' : r < 0.75 ? 'sword' : 'mage';
  }
  if (!element) {
    const chance = level < 3 ? 0 : Math.min(0.55, 0.18 + 0.07 * (level - 3));
    element = Math.random() < chance ? ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)] : 'none';
  }
  if (shield === undefined) shield = kind === 'sword' && Math.random() < 0.6;
  // prefer mid-range spots in front of the player, never right next to them
  const spots = SPAWNS.map((s) => {
    const dx = s[0] - player.pos.x, dz = s[1] - player.pos.z;
    const d = Math.hypot(dx, dz);
    const front = (dx * player.flatForward.x + dz * player.flatForward.z) / (d || 1);
    return { s, d, score: Math.abs(d - 12) - front * 4 + Math.random() * 6 };
  })
    .filter((o) => o.d > 7.5 && !enemies.some((e) => Math.hypot(e.pos.x - o.s[0], e.pos.z - o.s[1]) < 1.5))
    .sort((a, b) => a.score - b.score);
  const [x, z] = (spots[0] ?? { s: SPAWNS[Math.floor(Math.random() * SPAWNS.length)] }).s;
  const hpMax = 2 + Math.floor((level - 1) / 4) + (element === 'none' ? 0 : 2);
  const e = new Enemy(kind, x + (Math.random() - 0.5), z + (Math.random() - 0.5), element, hpMax, shield);
  e.yaw = Math.atan2(player.pos.x - x, player.pos.z - z);
  scene.add(e.group);
  enemies.push(e);
  sfx.spawn(ctx.pan(e.pos));
  if (element !== 'none' && !seenElemental) {
    seenElemental = true;
    showHint('Elemental knights shrug off their own element · fire melts frost · frost quenches fire and storm', 9000);
  } else if (shield && !seenShield && kills > 0) {
    seenShield = true;
    showHint('A raised shield stops blows from the front · throw something, or strike while they attack', 9000);
  }
  return e;
}

/** A free spot of floor, away from walls, pillars and the player. */
function freeSpot(out: THREE.Vector3): THREE.Vector3 {
  for (let i = 0; i < 20; i++) {
    out.set((Math.random() - 0.5) * 2 * (ARENA - 2.5), 0.62, (Math.random() - 0.5) * 2 * (ARENA - 2.5));
    if (out.distanceTo(player.pos) < 3) continue;
    if (colliders.some((c) => Math.hypot(out.x - c.x, out.z - c.z) < c.r + 0.7)) continue;
    if (items.list.some((it) => it.pos.distanceTo(out) < 1.5)) continue;
    break;
  }
  return out;
}

/** Leave something useful lying in the yard. */
function seedItem(s: ItemState, announce: boolean): void {
  const p = freeSpot(new THREE.Vector3());
  items.spawn(s, p, 'rest');
  if (announce) {
    particles.burst(p, 16, EL_COLOR[itemElement(s)], 3, 0.06, 0.8);
    sfx.spawn(ctx.pan(p));
  }
}

function randomYardItem(): ItemState {
  const r = Math.random();
  const el = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];
  if (r < 0.55) return makeItem('potion', el);
  if (r < 0.7) return makeItem('hammer');
  if (r < 0.82) return makeItem('shield');
  if (r < 0.92) return makeItem('staff', el);
  return makeItem('bow');
}

function startRun(weapon: number): void {
  clearArena();
  player.pos.set(0, 0, 9.5);
  player.alive = true;
  vel.set(0, 0, 0);
  yaw = 0;
  pitch = 0;
  ts = 0.04;
  boost = 0;
  hitStop = 0;
  flash = 0;
  deadT = 0;
  kills = 0;
  runTime = 0;
  for (const k of Object.keys(skills) as SkillId[]) skills[k] = 0;
  level = 1;
  ctx.level = 1;
  xp = 0;
  hp = maxHp = 3;
  invuln = chill = 0;
  seenElemental = seenShield = false;
  target = null;
  targetShot = null;
  hand.reset();
  const w = START_WEAPONS[weapon] ?? START_WEAPONS[0];
  const first = makeItem(w.kind, 'none', w.uses);
  first.fresh = false;
  equip(first);
  renderHearts();
  input.resetTouch();
  state = 'playing';
  screen.classList.add('hidden');
  hud.classList.remove('hidden');
  touchLayer.classList.toggle('hidden', !mobile);
  for (const el of ELEMENTS) seedItem(makeItem('potion', el), false);
  seedItem(makeItem('shield'), false);
  seedItem(makeItem(w.kind === 'hammer' ? 'sword' : 'hammer'), false);
  yardT = 20;
  spawnEnemy('archer', 'none');
  spawnEnemy('sword', 'none', true);
  spawnT = 2.5;
  showBanner('SURVIVE', 1400);
  sfx.waveStart();
  showHint(mobile ? 'Move to make time flow · THROW what you hold · GRAB what they drop' : 'Move to make time flow · Right-click throws what you hold · E grabs what they drop', 8000);
}

function applySkill(id: SkillId): void {
  skills[id]++;
  if (id === 'vitality') {
    maxHp++;
    hp = maxHp;
    renderHearts();
  }
  if (id === 'catch') showHint(mobile ? 'GRAB an arrow as it passes to snatch it from the air' : 'Press E on an arrow as it passes to snatch it from the air');
}

function levelUp(): void {
  xp -= xpNeed();
  level++;
  ctx.level = level;
  if (level > best) {
    best = level;
    localStorage.setItem('slowsteel-best', String(best));
  }
  choices = rollChoices(skills, 3);
  sfx.levelUp();
  flashColor(0xfff0b0, 0.35);
  if (!choices.length) {
    hp = Math.min(maxHp, hp + 1);
    renderHearts();
    showBanner(`LEVEL ${level}`, 900, 'small');
    return;
  }
  state = 'levelup';
  input.resetTouch();
  touchLayer.classList.add('hidden');
  if (!mobile && document.pointerLockElement) document.exitPointerLock();
  levelUpScreen();
}

function pickSkill(i: number): void {
  const s = choices[i];
  if (state !== 'levelup' || !s) return;
  sfx.click();
  applySkill(s.id);
  state = 'playing';
  screen.classList.add('hidden');
  touchLayer.classList.toggle('hidden', !mobile);
  lockPointer();
  showBanner(s.name.toUpperCase(), 900, 'small');
}

function onScreenAction(ev?: Event): void {
  sfx.init();
  const t = ev?.target as HTMLElement | undefined;
  if (state === 'title') {
    sfx.click();
    armoryScreen();
  } else if (state === 'armory') {
    const w = t?.closest<HTMLElement>('[data-weapon]')?.dataset.weapon;
    if (w === undefined) return;
    sfx.click();
    lockPointer();
    startRun(Number(w));
  } else if (state === 'levelup') {
    const p = t?.closest<HTMLElement>('[data-pick]')?.dataset.pick;
    if (p !== undefined) pickSkill(Number(p));
  } else if (state === 'paused') {
    sfx.click();
    lockPointer();
    state = 'playing';
    screen.classList.add('hidden');
    hud.classList.remove('hidden');
  } else if (state === 'dead' && deadT > 1.2) {
    sfx.click();
    armoryScreen();
  }
}
screen.addEventListener('click', onScreenAction);
renderer.domElement.addEventListener('click', () => {
  if (state === 'playing' && !input.locked) lockPointer();
});

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
    <p>Level ${level} · ${kills} knight${kills === 1 ? '' : 's'} broken · ${runTime.toFixed(0)}s${best ? ` · best: level ${best}` : ''}</p>
    <button class="go">${mobile ? 'TAP' : 'CLICK / R'} TO TRY AGAIN</button>`);
}

// ---------------------------------------------------------------- hands
/** Wear on the held item: one use gone, one coat of element gone. Breaks at zero. */
function wear(): void {
  if (!held) return;
  held.uses--;
  if (held.imbueUses > 0 && --held.imbueUses === 0) {
    held.imbue = 'none';
    hand.setTint(null);
  }
  if (held.uses <= 0 && held.kind !== 'bow') {
    const tip = hand.tip(new THREE.Vector3());
    particles.burst(tip, 22, SPARK, 5, 0.07, 0.7, 6);
    sfx.hit();
    sfx.fizz();
    showBanner('BROKEN', 500, 'small');
    hand.kick();
    equip(null);
    return;
  }
  renderHeld();
}

/** Put the held item back into the world beside the player. */
function dropHeld(): void {
  if (!held) return;
  const from = tmp.copy(player.eye).addScaledVector(player.flatForward, 0.5).setY(1.1);
  const v = tmp2.copy(player.flatForward).multiplyScalar(1.4).addScaledVector(right, 1.5).setY(2.5);
  items.spawn(held, from, 'flying', v);
}

/** First time the player takes an item, upgrades shape it. */
function tune(s: ItemState): void {
  if (!s.fresh) return;
  s.fresh = false;
  if (s.kind === 'bow' || s.kind === 'staff') s.uses += skills.pockets;
  else if (ITEMS[s.kind].damage > 0 && s.kind !== 'arrow') s.uses = Math.round(s.uses * (1 + 0.4 * skills.sturdy));
}

function grab(it: WorldItem): void {
  sfx.catchArrow();
  hand.kick(0.8);
  boost = Math.max(boost, 0.3);
  particles.burst(it.pos, 8, SPARK, 2, 0.05, 0.4);
  // arrows go straight into a bow
  if (it.state.kind === 'arrow' && held?.kind === 'bow') {
    items.remove(it);
    held.uses++;
    heldMax = Math.max(heldMax, held.uses);
    renderHeld();
    return;
  }
  const caught = it.mode === 'flying';
  items.remove(it);
  dropHeld();
  tune(it.state);
  equip(it.state);
  if (caught) {
    hitStop = Math.max(hitStop, 0.06);
    showBanner('CAUGHT', 450, 'small');
  }
}

/** Snatch an arrow in flight (Arrow Catch). */
function catchShot(p: Projectile): void {
  projectiles.remove(p);
  sfx.catchArrow();
  hand.kick(0.8);
  hitStop = Math.max(hitStop, 0.09);
  flashColor(0xfff0b0, 0.14);
  showBanner('CAUGHT', 450, 'small');
  if (held?.kind === 'bow') {
    held.uses++;
    heldMax = Math.max(heldMax, held.uses);
    renderHeld();
  } else if (!held) {
    const a = makeItem('arrow');
    a.fresh = false;
    equip(a);
  }
}

function throwHeld(): void {
  if (!held || !hand.ready) return;
  const dir = projectiles.aimAssist(player.eye, player.forward, 0.965);
  const from = tmp.copy(player.eye).addScaledVector(dir, 0.7).addScaledVector(right, 0.18).add(tmp2.set(0, -0.12, 0));
  const speed = (held.kind === 'potion' ? 17 : 23) * (1 + 0.25 * skills.arm);
  items.spawn(held, from, 'thrown', dir.multiplyScalar(speed).add(tmp2.set(0, 1.1, 0)));
  sfx.swing();
  boost = Math.max(boost, 0.5);
  equip(null);
  hand.kick();
}

/** Break a flask over the held weapon: its next hits carry the element. */
function coat(it: WorldItem): void {
  if (!held) return;
  const el = it.state.element;
  particles.burst(it.pos, 24, EL_COLOR[el], 5, 0.08, 0.7);
  items.shatter(it, player.forward);
  sfx.fizz();
  sfx.hit();
  held.imbue = el;
  held.imbueUses = 5 * (skills.alchemist ? 2 : 1);
  hand.setTint(EL_HEX[el]);
  flashColor(EL_HEX[el], 0.2);
  showBanner(`${EL_NAME[el].toUpperCase()} EDGE`, 700, 'small');
  renderHeld();
}

const canCoat = () => held !== null && held.kind !== 'potion' && held.kind !== 'staff';

function attack(): void {
  const cd = 1 - 0.18 * skills.quick;
  // breaking a flask over the weapon
  if (target && target.state.kind === 'potion' && target.mode === 'rest' && canCoat() && hand.ready) {
    hand.startSwing(cd);
    sfx.swing();
    coat(target);
    target = null;
    return;
  }
  if (!held) {
    // empty hands take what is in front of them, otherwise they punch
    if (targetShot) return catchShot(targetShot);
    if (target) return grab(target);
  } else if (held.kind === 'potion') {
    return throwHeld();
  } else if (held.kind === 'bow' && held.uses <= 0) {
    if (hand.ready) {
      sfx.empty();
      hand.kick(0.4);
    }
    return;
  }
  if (hand.startSwing(cd)) {
    if (!held || ITEMS[held.kind].damage > 0) sfx.swing();
    boost = Math.max(boost, 0.5);
  }
}

function swingHits(): void {
  const w = hand.def;
  const fwd = player.flatForward;
  const el = itemElement(held);
  const dmg = held ? w.damage : w.damage + skills.fists;
  let connected = false;
  for (const e of [...enemies]) {
    if (e.lastSwing === hand.swingId) continue;
    tmp.set(e.pos.x - player.pos.x, 0, e.pos.z - player.pos.z);
    const d = tmp.length();
    if (d > w.range) continue;
    if (d > 0.9 && tmp.divideScalar(d).dot(fwd) < w.arc) continue;
    e.lastSwing = hand.swingId;
    const dir = new THREE.Vector3().copy(fwd).addScaledVector(right, -0.7 * hand.side).setY(0.25).normalize();
    const heavy = w.knock > 10;
    if (heavy) shake = Math.max(shake, 0.25);
    const res = ctx.damageEnemy(e, dmg, el, dir, heavy ? 11 : 7, { knock: w.knock, chain: 1, from: player.pos, heavy });
    if (res === 'none') continue;
    connected = true;
    if (!held && res === 'hit') e.stun = Math.max(e.stun, 0.6 + 0.35 * skills.fists);
  }
  if (connected && held && wornSwing !== hand.swingId) {
    wornSwing = hand.swingId;
    wear();
  }
}

/** The ranged half of a swing: loose an arrow or spend a staff charge. */
function release(): void {
  if (!held) return;
  const el = itemElement(held);
  const dir = projectiles.aimAssist(player.eye, player.forward, 0.975);
  const from = tmp.copy(player.eye).addScaledVector(dir, 0.75).addScaledVector(right, 0.14).add(tmp2.set(0, -0.14, 0));
  if (held.kind === 'bow') {
    projectiles.spawn('arrow', 'player', from, dir.multiplyScalar(34), el, 2);
    sfx.arrowShot();
    boost = Math.max(boost, 0.45);
    wear();
  } else if (held.kind === 'staff') {
    boost = Math.max(boost, 0.55);
    if (el === 'fire') {
      projectiles.spawn('fireball', 'player', from, dir.multiplyScalar(24), 'fire', 4);
      sfx.fireball();
    } else if (el === 'storm') {
      lightning();
    } else {
      const p = projectiles.spawn('orb', 'player', from, dir.multiplyScalar(el === 'ice' ? 22 : 30), el, 2);
      p.burst = el === 'ice';
      sfx.orbCast();
    }
    wear();
  }
}

function lightning(): void {
  const from = hand.tip(new THREE.Vector3());
  let hit: Enemy | null = null;
  let bestDot = 0.9;
  for (const e of enemies) {
    e.chest(tmp).sub(player.eye);
    const d = tmp.length();
    if (d > 22) continue;
    const dot = tmp.divideScalar(d).dot(player.forward);
    if (dot > bestDot) {
      bestDot = dot;
      hit = e;
    }
  }
  sfx.zap();
  flashColor(0xd9c2ff, 0.22);
  shake = Math.max(shake, 0.1);
  if (!hit) {
    fx.bolt(from, tmp.copy(player.eye).addScaledVector(player.forward, 12), 0xd9c2ff, 0.06);
    return;
  }
  const to = hit.chest(new THREE.Vector3());
  fx.bolt(from, to, 0xd9c2ff, 0.08);
  fx.bolt(from, to, 0xffffff, 0.03);
  ctx.damageEnemy(hit, 3, 'storm', player.forward.clone(), 7, { chain: 3 });
}

/** Work out what the player is looking at and can take, and say so under the crosshair. */
function updateTarget(): void {
  target = items.target(player.eye, player.forward, REACH);
  targetShot = null;
  if (skills.catch) {
    let bestDot = 0.8;
    for (const p of projectiles.list) {
      if (p.owner !== 'enemy' || p.kind !== 'arrow') continue;
      tmp.copy(p.pos).sub(player.eye);
      const d = tmp.length();
      if (d > 2.6) continue;
      const dot = tmp.divideScalar(d || 1).dot(player.forward);
      if (dot > bestDot) {
        bestDot = dot;
        targetShot = p;
      }
    }
  }
  if (target) target.highlight = 1;
  let text = '';
  const key = (k: string, t: string) => `<b>${mobile ? t : k}</b>`;
  if (targetShot) {
    text = `${key('E', 'GRAB')} Catch the arrow`;
  } else if (target) {
    const s = target.state;
    const d = ITEMS[s.kind];
    const count = d.unit ? ` · ${s.uses} ${d.unit}` : '';
    const verb = target.mode === 'flying' ? 'Catch' : held ? 'Swap for' : 'Take';
    text = `${key('E', 'GRAB')} ${s.kind === 'arrow' && held?.kind === 'bow' ? 'Take arrow' : `${verb} ${itemName(s)}${count}`}`;
    if (s.kind === 'potion' && target.mode === 'rest' && canCoat()) text += ` &nbsp; ${key('Click', 'ATTACK')} Break it over your ${ITEMS[held!.kind].name.toLowerCase()}`;
  }
  if (text !== promptText) {
    promptText = text;
    promptEl.innerHTML = text;
    promptEl.classList.toggle('show', text !== '');
    grabBtn.classList.toggle('hidden', text === '');
  }
  throwBtn.classList.toggle('dim', !held);
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
  tick(now);
}
function tick(now: number): void {
  const realDt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  realTime += realDt;
  ctx.realTime = realTime;
  const playing = state === 'playing';
  const frozenUi = state === 'paused' || state === 'levelup';

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
  player.blocking = playing && held?.kind === 'shield';
  const walk = WALK * (1 + 0.12 * skills.swift) * (chill > 0 ? 0.55 : 1);
  const want = tmp.set(0, 0, 0);
  if (playing) {
    want.addScaledVector(player.flatForward, input.moveY).addScaledVector(right, input.moveX);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(walk);
  }
  vel.lerp(want, 1 - Math.exp(-11 * realDt));
  if (!frozenUi) player.pos.addScaledVector(vel, realDt);
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
    if (input.actions.has('grab')) {
      if (targetShot) catchShot(targetShot);
      else if (target) grab(target);
      target = null;
      targetShot = null;
    }
    if (input.actions.has('throw')) throwHeld();
    if (input.attack) attack();
    invuln -= realDt;
    chill -= realDt;
  } else if (state === 'levelup') {
    for (let i = 0; i < 3; i++) if (input.actions.has(`pick${i}`)) pickSkill(i);
  } else if (state === 'dead' && deadT > 1.2) {
    if (input.restart || input.attack) onScreenAction();
  }

  // --- time scale: the heart of the game
  boost = Math.max(0, boost - realDt * 2.2);
  const minTs = skills.stillness ? 0.02 : 0.04;
  let tsTarget = Math.max(minTs, moveI, Math.min(1, lookSpeed / 5) * 0.32, boost);
  if (state === 'dead') tsTarget = 0.015;
  if (state === 'title' || state === 'armory' || state === 'loading') tsTarget = 0.12;
  if (frozenUi) tsTarget = 0;
  ts += (tsTarget - ts) * (1 - Math.exp(-(tsTarget > ts ? 6 : 3) * realDt));

  let worldDt = realDt * ts;
  const handDt = hitStop > 0 ? realDt * 0.15 : realDt;
  if (hitStop > 0) {
    hitStop -= realDt;
    worldDt = 0;
  }
  if (frozenUi) worldDt = 0;

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
  hand.update(playing || state === 'title' || state === 'armory' ? handDt : 0, moveI);
  const melee = !held || ITEMS[held.kind].damage > 0;
  player.swingActive = hand.active && melee && held?.kind !== 'shield';
  if (playing && hand.justActive && !melee) release();
  if (playing && hand.active && melee) swingHits();
  for (const e of [...enemies]) e.update(worldDt, hitStop > 0 || frozenUi ? 0 : realDt, ctx);
  projectiles.update(worldDt, frozenUi ? 0 : realDt);
  items.update(worldDt, frozenUi ? 0 : realDt, realTime);
  particles.update(worldDt);
  fx.update(frozenUi ? 0 : realDt);

  if (playing) {
    runTime += realDt;
    updateTarget();
    // an archer's instinct: spent arrows underfoot go back in the quiver
    if (held?.kind === 'bow') {
      for (const it of [...items.list]) {
        if (it.state.kind === 'arrow' && it.mode === 'rest' && Math.hypot(it.pos.x - player.pos.x, it.pos.z - player.pos.z) < 1.1) grab(it);
      }
    }
    // the keep never runs dry: knights keep arriving, more and tougher with every level
    const maxAlive = Math.min(mobile ? 7 : 9, 2 + Math.floor(level * 0.75));
    spawnT -= Math.max(worldDt, realDt * 0.12);
    if (enemies.length === 0) spawnT = Math.min(spawnT, 0.35);
    if (spawnT <= 0 && enemies.length < maxAlive) {
      spawnEnemy();
      spawnT = Math.max(0.8, 2.4 - level * 0.12);
    }
    // and now and then the yard offers something
    yardT -= Math.max(worldDt, realDt * 0.2);
    if (yardT <= 0) {
      yardT = 16;
      if (items.list.filter((it) => it.mode === 'rest' && it.state.kind !== 'arrow').length < 6) seedItem(randomYardItem(), true);
    }
    if (xp >= xpNeed() && hitStop <= 0 && player.alive) levelUp();
  }

  // --- heartbeat
  heartTimer -= realDt;
  const slowness = 1 - ts;
  if (heartTimer <= 0 && playing) {
    heartTimer = 0.9 - 0.2 * slowness - (hp === 1 ? 0.25 : 0);
    const v = Math.pow(slowness, 1.5) * 0.9;
    if (v > 0.06) {
      sfx.heartbeat(v);
      heartPulse = v;
    }
  }
  heartPulse = Math.max(0, heartPulse - realDt * 3);

  // --- audio + post
  sfx.setTimeScale(frozenUi ? 0.3 : ts);
  flash = Math.max(0, flash - realDt * 3.2);
  const u = post.uniforms;
  u.uSlow.value = state === 'title' || state === 'armory' ? 0.3 : frozenUi ? 0.6 : slowness;
  u.uFlash.value = flash;
  u.uHeart.value = heartPulse;
  u.uDead.value = state === 'dead' ? Math.min(1, deadT * 1.5) : 0;

  // --- HUD
  if (playing) {
    timeFill.style.transform = `scaleX(${ts.toFixed(3)})`;
    xpFill.style.transform = `scaleX(${Math.min(1, xp / xpNeed()).toFixed(3)})`;
    lvlEl.textContent = `LEVEL ${level}`;
    hud.classList.toggle('chilled', chill > 0);
    hud.classList.toggle('hurt', invuln > 0);
  }

  // title screen: slow orbit
  if (state === 'title' || state === 'armory') {
    yaw = Math.sin(realTime * 0.1) * 0.6;
    pitch = 0.05;
  }

  post.render(renderer, scene, camera);
  input.endFrame();
}

setScreen('<p class="tag">Loading…</p>');
renderHeld();
loadRig(import.meta.env.BASE_URL)
  .then(() => {
    titleScreen();
    requestAnimationFrame(frame);
  })
  .catch((err) => {
    console.error(err);
    setScreen('<h2 class="red">Could not load the game</h2><p>Check your connection and reload.</p>');
  });

// tiny debug handle for automated testing
(window as unknown as { __slowsteel: object }).__slowsteel = {
  get state() { return state; },
  get timeScale() { return ts; },
  get enemies() { return enemies; },
  get level() { return level; },
  get hp() { return hp; },
  get held() { return held; },
  get target() { return target; },
  start: (w: number) => startRun(w),
  grant: (id: SkillId) => applySkill(id),
  spawn: (k: EnemyKind, el: Element, shield = false) => spawnEnemy(k, el, shield),
  give: (k: ItemKind, el: Element = 'none') => equip(makeItem(k, el)),
  place: (k: ItemKind, el: Element, x: number, z: number) => items.spawn(makeItem(k, el), new THREE.Vector3(x, 0.62, z), 'rest'),
  addXp: (n: number) => { xp += n; },
  pick: (i: number) => pickSkill(i),
  look: (y: number, p: number) => { yaw = y; pitch = p; },
  input, player, hand, items, shots: projectiles,
  /** advance n frames synchronously (tests in throttled/background tabs) */
  step: (n: number) => { for (let i = 0; i < n; i++) tick(last + 16.7); },
};
