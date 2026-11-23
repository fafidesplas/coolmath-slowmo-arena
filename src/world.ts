import * as THREE from 'three';

/** Circular obstacle used for player / enemy / projectile collisions. */
export interface Collider {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** Half size of the walkable courtyard (walls start just outside). */
export const ARENA = 13;

function stoneTexture(light: number, rows: number): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = `hsl(35, 10%, ${light - 18}%)`;
  g.fillRect(0, 0, size, size);
  const h = size / rows;
  for (let r = 0; r < rows; r++) {
    let x = -Math.random() * 40;
    while (x < size) {
      const w = 50 + Math.random() * 60;
      g.fillStyle = `hsl(${30 + Math.random() * 12}, ${6 + Math.random() * 8}%, ${light - 4 + Math.random() * 8}%)`;
      for (const ox of [0, -size, size]) g.fillRect(x + 2 + ox, r * h + 2, w - 4, h - 4);
      // subtle speckles
      g.fillStyle = 'rgba(0,0,0,0.04)';
      for (let i = 0; i < 6; i++) g.fillRect(x + Math.random() * w, r * h + Math.random() * h, 3, 3);
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function buildWorld(scene: THREE.Scene, mobile: boolean): { colliders: Collider[] } {
  const colliders: Collider[] = [];
  const horizon = new THREE.Color(0xf2e4cc);
  scene.background = horizon;
  scene.fog = new THREE.Fog(horizon, 28, 75);

  // Sky dome with vertical gradient
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(0x7fa6d6) }, bottom: { value: horizon } },
    vertexShader: `varying float vH; void main(){ vH = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float vH; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(0.0, 0.55, vH)), 1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 16, 10), skyMat));

  // Lights
  scene.add(new THREE.HemisphereLight(0xe8efff, 0x9a8670, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
  sun.position.set(10, 22, 7);
  if (!mobile) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = sun.shadow.camera;
    s.left = s.bottom = -20;
    s.right = s.top = 20;
    s.near = 1;
    s.far = 60;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
  }
  scene.add(sun);

  // Floor
  const floorTex = stoneTexture(84, 8);
  floorTex.repeat.set(7, 7);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallTex = stoneTexture(88, 10);
  const stone = new THREE.MeshStandardMaterial({ color: 0xf3ece0, map: wallTex, roughness: 0.92 });
  const plain = new THREE.MeshStandardMaterial({ color: 0xece4d6, roughness: 0.9, flatShading: true });
  const slate = new THREE.MeshStandardMaterial({ color: 0x4d5f80, roughness: 0.8, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6544, roughness: 0.9, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c2622, roughness: 1 });
  const banner = new THREE.MeshStandardMaterial({ color: 0x2b4a8c, roughness: 0.85, side: THREE.DoubleSide });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6aa4a, roughness: 0.5, metalness: 0.3 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast && !mobile;
    m.receiveShadow = !mobile;
    scene.add(m);
    return m;
  };

  // Walls
  const W = ARENA + 1;
  const wallH = 6;
  const len = 2 * W + 3;
  const wallGeoX = new THREE.BoxGeometry(len, wallH, 1.6);
  const wallGeoZ = new THREE.BoxGeometry(1.6, wallH, len);
  const texFor = (repeatX: number) => {
    const t = wallTex.clone();
    t.needsUpdate = true;
    t.repeat.set(repeatX, 1.6);
    return t;
  };
  const wallMat = stone.clone();
  wallMat.map = texFor(6);
  add(wallGeoX, wallMat, 0, wallH / 2, -W - 0.8, false);
  add(wallGeoX, wallMat, 0, wallH / 2, W + 0.8, false);
  add(wallGeoZ, wallMat, -W - 0.8, wallH / 2, 0, false);
  add(wallGeoZ, wallMat, W + 0.8, wallH / 2, 0, false);

  // Battlements (instanced merlons)
  const merlonGeo = new THREE.BoxGeometry(0.9, 1, 1.6);
  const merlonCount = Math.floor(len / 1.8);
  const merlons = new THREE.InstancedMesh(merlonGeo, plain, merlonCount * 4);
  const d = new THREE.Object3D();
  let k = 0;
  for (let side = 0; side < 4; side++) {
    for (let i = 0; i < merlonCount; i++) {
      const t = -len / 2 + 0.9 + i * 1.8;
      if (side < 2) {
        d.position.set(t, wallH + 0.5, side === 0 ? -W - 0.8 : W + 0.8);
        d.rotation.set(0, 0, 0);
      } else {
        d.position.set(side === 2 ? -W - 0.8 : W + 0.8, wallH + 0.5, t);
        d.rotation.set(0, Math.PI / 2, 0);
      }
      d.updateMatrix();
      merlons.setMatrixAt(k++, d.matrix);
    }
  }
  scene.add(merlons);

  // Corner towers
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (W + 0.8);
      const z = sz * (W + 0.8);
      add(new THREE.CylinderGeometry(2.4, 2.6, 10, 8), plain, x, 5, z, false);
      add(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 8), plain, x, 10.3, z, false);
      add(new THREE.ConeGeometry(3.1, 4, 8), slate, x, 12.6, z, false);
    }
  }

  // Gate on the north wall
  add(new THREE.BoxGeometry(4, 4.6, 0.3), dark, 0, 2.3, -W + 0.05, false);
  const arch = add(new THREE.CylinderGeometry(2, 2, 0.32, 12, 1, false, 0, Math.PI), dark, 0, 4.6, -W + 0.05, false);
  // cylinder axis -> world Z, half disc -> upwards
  arch.quaternion.setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
  );
  for (let i = -3; i <= 3; i++) add(new THREE.BoxGeometry(0.08, 6.2, 0.08), wood, i * 0.55, 3.1, -W + 0.3, false);
  for (let j = 0; j < 5; j++) add(new THREE.BoxGeometry(3.9, 0.08, 0.08), wood, 0, 0.6 + j * 1.15, -W + 0.32, false);

  // Banners on east / west / south walls
  const bannerGeo = new THREE.PlaneGeometry(1.3, 3.2);
  const emblemGeo = new THREE.CircleGeometry(0.32, 6);
  const banners: [number, number, number][] = [
    [-W + 0.02, -5, Math.PI / 2], [-W + 0.02, 5, Math.PI / 2],
    [W - 0.02, -5, -Math.PI / 2], [W - 0.02, 5, -Math.PI / 2],
    [-6, W - 0.02, Math.PI], [6, W - 0.02, Math.PI],
  ];
  for (const [x, z, ry] of banners) {
    const b = add(bannerGeo, banner, x, 3.6, z, false);
    b.rotation.y = ry;
    const e = add(emblemGeo, gold, x, 4.1, z, false);
    e.rotation.y = ry;
    e.translateZ(0.02);
  }

  // Pillars (cover)
  const pillarGeo = new THREE.CylinderGeometry(0.5, 0.55, 4.4, 8);
  const capGeo = new THREE.BoxGeometry(1.3, 0.35, 1.3);
  for (const [x, z] of [[-6.5, -4.5], [6.5, -4.5], [-6.5, 4.5], [6.5, 4.5]] as const) {
    add(pillarGeo, plain, x, 2.2, z);
    add(capGeo, plain, x, 0.17, z);
    add(capGeo, plain, x, 4.4, z);
    colliders.push({ x, z, r: 0.75, h: 4.6 });
  }

  // Central well
  const wx = 9.6, wz = 0;
  add(new THREE.CylinderGeometry(1.3, 1.4, 0.9, 10), plain, wx, 0.45, wz);
  add(new THREE.CylinderGeometry(1.05, 1.05, 0.92, 10), dark, wx, 0.47, wz, false);
  for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.15, 2.2, 0.15), wood, wx, 1.5, wz + sz * 1.1);
  const roof = add(new THREE.ConeGeometry(1.7, 0.9, 4), slate, wx, 2.95, wz);
  roof.rotation.y = Math.PI / 4;
  colliders.push({ x: wx, z: wz, r: 1.45, h: 1.0 });

  // Flat compass-rose inlay in the centre
  const inlay = add(new THREE.RingGeometry(1.5, 1.8, 8), slate, 0, 0.012, 0, false);
  inlay.rotation.x = -Math.PI / 2;
  const star = add(new THREE.CircleGeometry(0.9, 4), gold, 0, 0.012, 0, false);
  star.rotation.x = -Math.PI / 2;

  // Crates & barrels
  const crateGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
  const crates: [number, number, number][] = [[-10, 9.5, 2], [-8.8, 10.2, 1], [10.5, -9.5, 2], [9.3, -10.4, 1], [-10.2, -9.8, 1]];
  for (const [x, z, n] of crates) {
    for (let i = 0; i < n; i++) {
      const c = add(crateGeo, wood, x, 0.55 + i * 1.1, z);
      c.rotation.y = (x + z + i) * 0.3;
    }
    colliders.push({ x, z, r: 0.8, h: n * 1.1 });
  }
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 8);
  for (const [x, z] of [[10.2, 9.8], [9.3, 10.4], [10.6, 8.9]] as const) {
    add(barrelGeo, wood, x, 0.5, z);
    colliders.push({ x, z, r: 0.55, h: 1.0 });
  }

  return { colliders };
}
