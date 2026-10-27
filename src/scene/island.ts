import * as THREE from 'three';
import type { Env } from './env';
import { hash3, jitter, softSprite, type Rng } from '../util';
import { fallMaterial, riverMaterial } from './water';

/**
 * 하늘에 떠 있는 섬. 윗면(잔디·흙)과 아래로 뾰족한 바위 받침, 섬을 가로지르는 강,
 * 가장자리에서 구름바다로 떨어지는 폭포, 마을과 나무로 이뤄진다.
 * 모양은 전부 코드로 만든다. 나중에 Blender 모델(.glb)로 바꾸려면 이 파일만 교체하면 된다.
 */
export const ISLAND_RADIUS = 6;
const R = ISLAND_RADIUS;
const TOP = 0.25;
const HILL = new THREE.Vector2(-2.2, -1.4);
const HILL_R = 2.2;
const FALL_ANGLE = 0.42;
const SPRING_FALL_ANGLE = 2.25;

/** 섬 가장자리의 반지름 배율. 원이 아니라 울퉁불퉁한 윤곽을 만든다. */
export function rimFactor(a: number): number {
  return 1 + 0.1 * Math.sin(3 * a + 0.7) + 0.06 * Math.sin(5 * a + 2.1) + 0.04 * Math.sin(7 * a + 4);
}

function surfaceY(x: number, z: number): number {
  const d = Math.hypot(x - HILL.x, z - HILL.y) / HILL_R;
  return d < 1 ? Math.max(TOP, 0.15 + 0.42 * HILL_R * Math.sqrt(1 - d * d)) : TOP;
}

const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, ...extra });

const MATS = {
  grass: std('#59a843'),
  dirt: std('#8a5a3a'),
  rock: std('#ffffff', { vertexColors: true }),
  miniRock: std('#6d5c55'),
  stone: std('#8d919b'),
  path: std('#cdbb94'),
  wood: std('#7a5236'),
  darkWood: std('#4a3426'),
  wall: std('#f3e7d3'),
  roofRed: std('#c0503c'),
  roofBlue: std('#4d6f9e'),
  sail: std('#efe6d6'),
  trunk: std('#6b4a32'),
  pine: std('#2f6443'),
  foliageA: std('#e8902f'),
  foliageB: std('#c8452e'),
  vine: std('#3d6a3a'),
  sheep: std('#f5f2ea'),
  sheepHead: std('#3a3436'),
  window: std('#3a3946', { emissive: '#ffbf66', emissiveIntensity: 0 }),
  lamp: std('#4a4038', { emissive: '#ffcf80', emissiveIntensity: 0 }),
};

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** 원기둥·원뿔 정점을 rimFactor 로 늘려 섬 윤곽에 맞춘다. */
function shapeRim(geo: THREE.BufferGeometry, noise: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = rimFactor(Math.atan2(z, x)) * (1 + (hash3(x, y, z) - 0.5) * noise);
    p.setXYZ(i, x * f, y, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildRockBase(): THREE.Mesh {
  const h = 8;
  const top = -0.95;
  const geo = new THREE.ConeGeometry(R * 0.93, h, 36, 9);
  geo.rotateX(Math.PI);
  geo.translate(0, top - h / 2, 0);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const cTop = new THREE.Color('#a8744a');
  const cMid = new THREE.Color('#957f76');
  const cBottom = new THREE.Color('#6a6a84');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const depth = Math.min(1, Math.max(0, (top - y) / h));
    const a = Math.atan2(z, x);
    const n = hash3(x, y, z);
    const inner = depth > 0.01 && depth < 0.99;
    const f = rimFactor(a) * (inner ? (1 + 0.14 * Math.sin(a * 2 + depth * 5)) * (1 + (n - 0.5) * 0.32) : 1);
    // 끝을 살짝 비틀어 똑바른 원뿔처럼 보이지 않게 한다
    p.setXYZ(
      i,
      x * f + depth * depth * 0.9,
      y + (inner ? (hash3(z, x, y) - 0.5) * 0.55 : 0),
      z * f - depth * depth * 0.5,
    );
    if (depth < 0.5) c.copy(cTop).lerp(cMid, depth * 2);
    else c.copy(cMid).lerp(cBottom, (depth - 0.5) * 2);
    c.multiplyScalar(0.85 + n * 0.3);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return mesh(geo, MATS.rock);
}

/** 곡선을 따라 납작한 띠(강)를 만든다. uv.x 는 폭, uv.y 는 누적 거리. */
function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, segs: number, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let len = 0;
  const prev = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const tan = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize().multiplyScalar(width / 2);
    if (i > 0) len += p.distanceTo(prev);
    prev.copy(p);
    pos.push(p.x + side.x, y, p.z + side.z, p.x - side.x, y, p.z - side.z);
    uv.push(0, len, 1, len);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

interface Fall {
  origin: THREE.Vector3;
  outward: THREE.Vector3;
  width: number;
  length: number;
  reach: number;
}

function fallPoint(f: Fall, s: number, out: THREE.Vector3): THREE.Vector3 {
  return out
    .copy(f.origin)
    .addScaledVector(f.outward, f.reach * (1 - Math.exp(-s * 6)))
    .setY(f.origin.y - s * f.length);
}

/** 가장자리에서 바깥으로 튀어나갔다가 아래로 떨어지는 폭포 면 */
function fallSheet(f: Fall): THREE.BufferGeometry {
  const segs = 56;
  const side = new THREE.Vector3(-f.outward.z, 0, f.outward.x);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    fallPoint(f, s, c);
    const w = (f.width * (1 + s * 1.4)) / 2;
    pos.push(c.x + side.x * w, c.y, c.z + side.z * w, c.x - side.x * w, c.y, c.z - side.z * w);
    uv.push(0, s, 1, s);
    if (i < segs) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

// ── 소품 ──────────────────────────────────────────────

const TRUNK_GEO = new THREE.CylinderGeometry(0.07, 0.11, 0.5, 5).translate(0, 0.25, 0);
const PINE_GEOS = [
  [0.55, 0.75, 0.55],
  [0.44, 0.65, 0.9],
  [0.3, 0.55, 1.2],
].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0));
const CROWN_GEOS = [0, 1, 2].map((i) => jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.18, i * 3.1).translate(0, 0.95, 0));

function pineTree(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  for (const geo of PINE_GEOS) g.add(mesh(geo, MATS.pine));
  return g;
}

function roundTree(variant: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  g.add(mesh(CROWN_GEOS[variant % 3], mat));
  return g;
}

function house(w: number, d: number, h: number, roofMat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), MATS.wall));
  // 삼각 기둥 지붕: 3각 원기둥을 눕혀 꼭짓점이 위로 오게 한다
  const r = (w / 2 + 0.15) / 0.866;
  const roof = new THREE.CylinderGeometry(r, r, d + 0.25, 3);
  roof.rotateX(-Math.PI / 2);
  roof.scale(1, 0.75, 1);
  roof.translate(0, h + r * 0.375, 0);
  g.add(mesh(roof, roofMat));
  g.add(mesh(new THREE.BoxGeometry(0.18, 0.5, 0.18).translate(w * 0.25, h + r * 0.55, -d * 0.15), MATS.stone));
  g.add(mesh(new THREE.BoxGeometry(0.28, 0.48, 0.05).translate(0, 0.24, d / 2 + 0.02), MATS.darkWood));
  const win = new THREE.BoxGeometry(0.22, 0.22, 0.05);
  for (const x of [-w * 0.3, w * 0.3]) {
    g.add(mesh(win.clone().translate(x, h * 0.58, d / 2 + 0.02), MATS.window, false));
  }
  g.add(mesh(win.clone().rotateY(Math.PI / 2).translate(w / 2 + 0.02, h * 0.58, 0), MATS.window, false));
  return g;
}

function windmill(): { group: THREE.Group; hub: THREE.Group } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.62, 2.2, 8).translate(0, 1.1, 0), MATS.wall));
  g.add(mesh(new THREE.ConeGeometry(0.6, 0.8, 8).translate(0, 2.6, 0), MATS.roofRed));
  g.add(mesh(new THREE.BoxGeometry(0.3, 0.5, 0.05).translate(0, 0.25, 0.6), MATS.darkWood));
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05).translate(0, 1.5, 0.5), MATS.window, false));
  const hub = new THREE.Group();
  hub.position.set(0, 2.15, 0.62);
  hub.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.2, 6).rotateX(Math.PI / 2), MATS.darkWood));
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Group();
    blade.add(mesh(new THREE.BoxGeometry(0.06, 1.7, 0.04).translate(0, 0.85, 0.06), MATS.wood));
    blade.add(mesh(new THREE.BoxGeometry(0.3, 1.25, 0.02).translate(0.17, 1.05, 0.06), MATS.sail));
    blade.rotation.z = (i * Math.PI) / 2;
    hub.add(blade);
  }
  g.add(hub);
  return { group: g, hub };
}

function lampPost(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5).translate(0, 0.45, 0), MATS.darkWood));
  g.add(mesh(new THREE.OctahedronGeometry(0.1, 0).translate(0, 0.98, 0), MATS.lamp, false));
  return g;
}

function sheep(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(jitter(new THREE.BoxGeometry(0.42, 0.28, 0.28, 2, 1, 1), 0.04).translate(0, 0.24, 0), MATS.sheep));
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.16, 0.16).translate(0.25, 0.32, 0), MATS.sheepHead));
  for (const [x, z] of [[-0.13, -0.08], [-0.13, 0.08], [0.13, -0.08], [0.13, 0.08]]) {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05).translate(x, 0.06, z), MATS.sheepHead));
  }
  return g;
}

function miniIsland(rng: Rng, size: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(jitter(new THREE.CylinderGeometry(size, size * 0.92, 0.22, 9), 0.06, size), MATS.grass));
  const rock = new THREE.ConeGeometry(size * 0.92, size * 2.4, 9, 3);
  rock.rotateX(Math.PI);
  rock.translate(0, -0.11 - size * 1.2, 0);
  g.add(mesh(jitter(rock, size * 0.35, size + 1), MATS.miniRock));
  if (rng() > 0.35) {
    const t = rng() > 0.5 ? pineTree() : roundTree(Math.floor(rng() * 3), MATS.foliageA);
    t.scale.setScalar(size * 0.75);
    t.position.y = 0.1;
    g.add(t);
  }
  return g;
}

// ── 섬 ────────────────────────────────────────────────

interface Obstacle { x: number; z: number; r: number }

export class Island {
  readonly group = new THREE.Group();
  private readonly hub: THREE.Group;
  private readonly sways: { obj: THREE.Object3D; phase: number }[] = [];
  private readonly waters: THREE.ShaderMaterial[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly floaters: { obj: THREE.Object3D; y: number; phase: number }[] = [];
  private readonly flowers = new THREE.Group();
  private readonly mist: THREE.Points;
  private readonly mistMat: THREE.PointsMaterial;
  private readonly mistState: { s: number; a: number; b: number; speed: number }[] = [];
  private readonly mainFall: Fall;

  constructor(rng: Rng) {
    const g = this.group;
    const obstacles: Obstacle[] = [];

    // 땅
    g.add(mesh(shapeRim(new THREE.CylinderGeometry(R, R * 0.99, 0.5, 72, 1), 0.012), MATS.grass, false));
    g.add(mesh(shapeRim(new THREE.CylinderGeometry(R * 0.99, R * 0.93, 0.75, 72, 2).translate(0, -0.625, 0), 0.05), MATS.dirt, false));
    const hill = jitter(new THREE.IcosahedronGeometry(HILL_R, 2), 0.08);
    hill.scale(1, 0.42, 1).translate(HILL.x, 0.15, HILL.y);
    g.add(mesh(hill, MATS.grass));
    g.add(buildRockBase());

    // 강: 언덕 아래 샘에서 시작해 가장자리 폭포로 이어진다
    const edgeR = R * rimFactor(FALL_ANGLE);
    const edge = new THREE.Vector3(Math.cos(FALL_ANGLE) * edgeR, TOP, Math.sin(FALL_ANGLE) * edgeR);
    const river = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.4, TOP, 0.3),
      new THREE.Vector3(0.9, TOP, 0.9),
      new THREE.Vector3(2.3, TOP, 0.6),
      new THREE.Vector3(3.6, TOP, 1.4),
      edge.clone().multiplyScalar(0.9).setY(TOP),
      edge.clone(),
    ]);
    const riverMat = riverMaterial();
    this.waters.push(riverMat);
    const riverMesh = new THREE.Mesh(ribbon(river, 0.7, 90, TOP + 0.015), riverMat);
    riverMesh.receiveShadow = true;
    g.add(riverMesh);
    for (let i = 0; i <= 24; i++) {
      const p = river.getPointAt(i / 24);
      obstacles.push({ x: p.x, z: p.z, r: 0.75 });
    }
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      const s = mesh(new THREE.DodecahedronGeometry(0.22, 0), MATS.stone);
      s.position.set(-0.4 + Math.cos(a) * 0.42 - 0.2, TOP + 0.05, 0.3 + Math.sin(a) * 0.42 - 0.1);
      s.scale.set(1, 0.7, 1);
      g.add(s);
    }

    // 폭포
    const outward = new THREE.Vector3(edge.x, 0, edge.z).normalize();
    this.mainFall = { origin: edge.clone().addScaledVector(outward, 0.04).setY(TOP + 0.01), outward, width: 0.72, length: 15, reach: 1.4 };
    const springA = SPRING_FALL_ANGLE;
    const springOut = new THREE.Vector3(Math.cos(springA), 0, Math.sin(springA));
    const springFall: Fall = {
      origin: springOut.clone().multiplyScalar(R * 0.99 * rimFactor(springA) + 0.05).setY(-0.55),
      outward: springOut,
      width: 0.32,
      length: 11,
      reach: 0.7,
    };
    for (const f of [this.mainFall, springFall]) {
      const mat = fallMaterial();
      this.waters.push(mat);
      const m = new THREE.Mesh(fallSheet(f), mat);
      m.renderOrder = 2;
      g.add(m);
    }
    g.add(mesh(new THREE.DodecahedronGeometry(0.28, 0).translate(springFall.origin.x, -0.45, springFall.origin.z), MATS.stone));

    // 물보라
    const mistCount = 150;
    const mistPos = new Float32Array(mistCount * 3);
    for (let i = 0; i < mistCount; i++) {
      this.mistState.push({ s: rng(), a: rng() - 0.5, b: rng(), speed: 0.05 + rng() * 0.05 });
    }
    const mistGeo = new THREE.BufferGeometry();
    mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
    this.mistMat = new THREE.PointsMaterial({
      map: softSprite(), size: 2.2, transparent: true, opacity: 0.16, depthWrite: false, color: '#ffffff',
    });
    this.mist = new THREE.Points(mistGeo, this.mistMat);
    this.mist.frustumCulled = false;
    g.add(this.mist);

    // 마을
    const place = (obj: THREE.Object3D, x: number, z: number, rotY: number, r: number) => {
      obj.position.set(x, surfaceY(x, z), z);
      obj.rotation.y = rotY;
      g.add(obj);
      obstacles.push({ x, z, r });
      return obj;
    };
    const h1 = place(house(1.3, 0.95, 1.05, MATS.roofRed), 1.5, -2.4, 0.75, 1.35);
    const h2 = place(house(1.0, 0.8, 0.9, MATS.roofBlue), -1.6, 2.7, 1.1, 1.15);
    const mill = windmill();
    this.hub = mill.hub;
    mill.group.position.set(HILL.x, surfaceY(HILL.x, HILL.y) - 0.08, HILL.y);
    mill.group.rotation.y = 0.85;
    g.add(mill.group);
    obstacles.push({ x: HILL.x, z: HILL.y, r: HILL_R * 0.95 });

    const doorOf = (h: THREE.Object3D, d: number) =>
      new THREE.Vector3(0, 0, d / 2 + 0.45).applyAxisAngle(THREE.Object3D.DEFAULT_UP, h.rotation.y).add(h.position);
    const door1 = doorOf(h1, 0.95);
    const door2 = doorOf(h2, 0.8);

    // 다리
    const bt = 0.3;
    const bp = river.getPointAt(bt);
    const btan = river.getTangentAt(bt);
    const bside = new THREE.Vector3(-btan.z, 0, btan.x).normalize();
    const bridge = new THREE.Group();
    bridge.add(mesh(new THREE.BoxGeometry(0.55, 0.08, 1.35).translate(0, 0.06, 0), MATS.wood));
    for (const z of [-0.6, 0.6]) {
      bridge.add(mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06).translate(-0.24, 0.2, z), MATS.darkWood));
      bridge.add(mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06).translate(0.24, 0.2, z), MATS.darkWood));
    }
    bridge.position.set(bp.x, TOP, bp.z);
    bridge.rotation.y = Math.atan2(-btan.z, btan.x);
    g.add(bridge);

    // 오솔길 징검돌
    const a = bp.clone().addScaledVector(bside, -0.95);
    const b = bp.clone().addScaledVector(bside, 0.95);
    const [near1, near2] = a.distanceTo(door1) < b.distanceTo(door1) ? [a, b] : [b, a];
    const millDoor = new THREE.Vector3(0, 0, 1.0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, mill.group.rotation.y).add(mill.group.position);
    const paths = [
      new THREE.CatmullRomCurve3([door1, near1, near2, door2].map((v) => v.clone().setY(0))),
      new THREE.CatmullRomCurve3([door1, new THREE.Vector3(-0.2, 0, -1.4), millDoor].map((v) => v.clone().setY(0))),
    ];
    const stoneGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 6);
    for (const curve of paths) {
      const n = Math.floor(curve.getLength() / 0.38);
      for (let i = 1; i < n; i++) {
        const p = curve.getPointAt(i / n);
        if (p.distanceTo(new THREE.Vector3(bp.x, 0, bp.z)) < 0.8) continue;
        const s = mesh(stoneGeo, MATS.path, false);
        s.position.set(p.x + (rng() - 0.5) * 0.12, surfaceY(p.x, p.z) + 0.01, p.z + (rng() - 0.5) * 0.12);
        s.rotation.y = rng() * Math.PI;
        s.scale.setScalar(0.8 + rng() * 0.4);
        g.add(s);
        obstacles.push({ x: p.x, z: p.z, r: 0.3 });
      }
    }

    // 가로등과 창문 불빛
    for (const [x, z] of [[0.2, -1.2], [-0.9, 1.6], [3.0, -1.2]]) {
      place(lampPost(), x, z, 0, 0.3);
    }
    for (const d of [door1, door2]) {
      const light = new THREE.PointLight('#ffb35c', 0, 6, 2);
      light.position.set(d.x, 0.9, d.z);
      g.add(light);
      this.lights.push(light);
    }

    // 나무
    const free = (x: number, z: number, gap: number) => obstacles.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + gap);
    let trees = 0;
    for (let i = 0; i < 900 && trees < 40; i++) {
      const ang = rng() * Math.PI * 2;
      const r = (0.3 + 0.7 * Math.sqrt(rng())) * R * rimFactor(ang) * 0.86;
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!free(x, z, 0.3)) continue;
      const pine = rng() < 0.5;
      const tree = pine ? pineTree() : roundTree(Math.floor(rng() * 3), rng() < 0.55 ? MATS.foliageA : MATS.foliageB);
      tree.scale.setScalar(0.75 + rng() * 0.6);
      tree.position.set(x, TOP, z);
      tree.rotation.y = rng() * Math.PI * 2;
      g.add(tree);
      this.sways.push({ obj: tree, phase: rng() * 10 });
      obstacles.push({ x, z, r: 0.45 });
      trees++;
    }

    // 양, 바위, 꽃
    let flock = 0;
    for (let i = 0; i < 300 && flock < 4; i++) {
      const x = (rng() - 0.5) * 7, z = (rng() - 0.5) * 7;
      if (!free(x, z, 0.4)) continue;
      place(sheep(), x, z, rng() * Math.PI * 2, 0.4);
      flock++;
    }
    for (let i = 0; i < 14; i++) {
      const ang = rng() * Math.PI * 2;
      const r = R * rimFactor(ang) * (0.8 + rng() * 0.15);
      const x = Math.cos(ang) * r, z = Math.sin(ang) * r;
      if (!free(x, z, 0.1)) continue;
      const s = mesh(new THREE.DodecahedronGeometry(0.3, 0), MATS.stone);
      s.position.set(x, TOP + 0.05, z);
      s.scale.set(0.6 + rng() * 0.9, 0.4 + rng() * 0.6, 0.6 + rng() * 0.9);
      s.rotation.set(rng(), rng() * 3, rng());
      g.add(s);
    }
    const flowerGeo = new THREE.IcosahedronGeometry(0.05, 0);
    const flowerMats = ['#ffffff', '#ffd84a', '#ff9ec4', '#b9a2ff'].map((c) => std(c));
    for (let i = 0; i < 400 && this.flowers.children.length < 60; i++) {
      const x = (rng() - 0.5) * 10, z = (rng() - 0.5) * 10;
      if (Math.hypot(x, z) > R * rimFactor(Math.atan2(z, x)) * 0.9 || !free(x, z, 0.05)) continue;
      const f = mesh(flowerGeo, flowerMats[i % 4], false);
      f.position.set(x, surfaceY(x, z) + 0.04, z);
      this.flowers.add(f);
    }
    g.add(this.flowers);

    // 가장자리에 늘어진 덩굴
    for (let i = 0; i < 22; i++) {
      const ang = rng() * Math.PI * 2;
      if (Math.abs(ang - FALL_ANGLE) < 0.25 || Math.abs(ang - SPRING_FALL_ANGLE) < 0.2) continue;
      const len = 0.6 + rng() * 2.2;
      const r = R * rimFactor(ang) * 0.985;
      const v = mesh(new THREE.CylinderGeometry(0.035, 0.015, len, 4).translate(0, -len / 2, 0), MATS.vine, false);
      v.position.set(Math.cos(ang) * r, 0.1, Math.sin(ang) * r);
      g.add(v);
      this.sways.push({ obj: v, phase: rng() * 10 });
    }

    // 주변을 떠다니는 작은 섬들
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + rng() * 0.6;
      const mini = miniIsland(rng, 0.5 + rng() * 0.9);
      const dist = 10 + rng() * 7;
      const y = -2.5 + rng() * 5;
      mini.position.set(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
      mini.rotation.y = rng() * Math.PI;
      g.add(mini);
      this.floaters.push({ obj: mini, y, phase: rng() * 10 });
    }
  }

  update(dt: number, t: number, env: Env): void {
    MATS.grass.color.copy(env.grass);
    MATS.foliageA.color.copy(env.foliageA);
    MATS.foliageB.color.copy(env.foliageB);
    MATS.pine.color.copy(env.pine);
    MATS.window.emissiveIntensity = env.nightLights * 2.6;
    MATS.lamp.emissiveIntensity = env.nightLights * 3;
    for (const l of this.lights) l.intensity = env.nightLights * 6;

    const bright = Math.min(1.1, Math.max(0.28, 0.2 + env.hemiIntensity * 0.5 + env.sunIntensity * 0.08));
    for (const m of this.waters) {
      m.uniforms.time.value = t;
      m.uniforms.bright.value = bright;
    }
    this.mistMat.color.setScalar(bright);

    this.hub.rotation.z -= dt * (0.35 + env.wind * 2.8);
    const sway = 0.015 + env.wind * 0.06;
    for (const s of this.sways) {
      s.obj.rotation.z = Math.sin(t * (1.2 + env.wind * 1.5) + s.phase) * sway;
      s.obj.rotation.x = Math.cos(t * 0.9 + s.phase) * sway * 0.5;
    }
    this.flowers.scale.y = Math.max(0.001, 1 - env.snowCover);
    this.flowers.visible = env.snowCover < 0.95;

    // 섬 전체가 천천히 오르내린다
    this.group.position.y = Math.sin(t * 0.35) * 0.18;
    for (const f of this.floaters) {
      f.obj.position.y = f.y + Math.sin(t * 0.5 + f.phase) * 0.35;
      f.obj.rotation.y += dt * 0.03;
    }

    // 물보라: 폭포를 따라 내려가며 바깥으로 퍼진다
    const pos = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
    const side = new THREE.Vector3(-this.mainFall.outward.z, 0, this.mainFall.outward.x);
    const p = new THREE.Vector3();
    this.mistState.forEach((m, i) => {
      m.s += dt * m.speed;
      if (m.s > 1) m.s -= 1;
      fallPoint(this.mainFall, m.s, p)
        .addScaledVector(side, m.a * this.mainFall.width * (1 + m.s * 2.5))
        .addScaledVector(this.mainFall.outward, 0.15 + m.b * 0.5 + m.s * 1.2);
      pos.setXYZ(i, p.x, p.y, p.z);
    });
    pos.needsUpdate = true;
  }
}
