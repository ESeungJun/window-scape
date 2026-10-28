import * as THREE from 'three';
import type { Env } from './env';
import { hash3, jitter, softSprite, type Rng } from '../util';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hasProps, prop, propParts, updateProps } from './props';
import { fallMaterial, riverMaterial } from './water';

/**
 * 테마들이 함께 쓰는 재료와 소품. 떠 있는 땅(잔디·흙·바위 받침), 나무·집·가로등,
 * 강 띠·폭포, 계절과 밤에 따라 바뀌는 공용 재질이 여기 있다.
 */
export const R = 6;
export const TOP = 0.25;

/** 섬 가장자리의 반지름 배율. 원이 아니라 울퉁불퉁한 윤곽을 만든다. */
export function rimFactor(a: number): number {
  return 1 + 0.1 * Math.sin(3 * a + 0.7) + 0.06 * Math.sin(5 * a + 2.1) + 0.04 * Math.sin(7 * a + 4);
}

export const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });

export const MATS = {
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
  bush: std('#4f8a3c'),
  sheep: std('#f5f2ea'),
  sheepHead: std('#3a3436'),
  window: std('#3a3946', { emissive: '#ffbf66', emissiveIntensity: 0 }),
  lamp: std('#4a4038', { emissive: '#ffcf80', emissiveIntensity: 0 }),
};

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
}

/** 원기둥·원뿔 정점을 rimFactor 로 늘려 섬 윤곽에 맞춘다. */
export function shapeRim(geo: THREE.BufferGeometry, noise: number): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = rimFactor(Math.atan2(z, x)) * (1 + (hash3(x, y, z) - 0.5) * noise);
    p.setXYZ(i, x * f, y, z * f);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildRockBase(radius = R): THREE.Mesh {
  const h = 8;
  const top = -0.95;
  const geo = new THREE.ConeGeometry(radius * 0.93, h, 36, 9);
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
/** y 를 주면 그 높이에 평평하게, null 이면 곡선의 높이를 따라(lift 만큼 띄워) 깐다 */
export function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, segs: number, y: number | null, lift = 0): THREE.BufferGeometry {
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
    const py = (y ?? p.y) + lift;
    pos.push(p.x + side.x, py, p.z + side.z, p.x - side.x, py, p.z - side.z);
    uv.push(0, len, 1, len);
    if (i < segs) {
      // 위(+y)를 향하는 감김 순서
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export interface Fall {
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

const TRUNK_GEO = new THREE.CylinderGeometry(0.07, 0.11, 0.5, 8).translate(0, 0.25, 0);
const PINE_GEOS = [
  [0.55, 0.75, 0.55],
  [0.44, 0.65, 0.9],
  [0.3, 0.55, 1.2],
].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 12).translate(0, y, 0));
/** 둥근 나무 잎: 매끈한 공 여러 개를 겹쳐 뭉게뭉게한 덩어리로(모양 3가지) */
const CROWN_GEOS = [0, 1, 2].map((i) => {
  const blob = (r: number, x: number, y: number, z: number, k: number) =>
    jitter(new THREE.SphereGeometry(r, 14, 10), r * 0.12, i * 3.1 + k).translate(x, y, z);
  const parts = [blob(0.42, 0, 0.98, 0, 0)];
  const n = 3 + i;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + i;
    const r = 0.26 + 0.06 * ((k + i) % 3) / 2;
    parts.push(blob(r, Math.cos(a) * 0.3, 0.86 + ((k * 7 + i) % 3) * 0.1, Math.sin(a) * 0.3, k + 1));
  }
  parts.push(blob(0.27, 0.05, 1.32, -0.04, 9));
  return mergeGeometries(parts);
});

function pineTree(): THREE.Object3D {
  const p = prop('tree_pine_0');
  if (p) return p;
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  for (const geo of PINE_GEOS) g.add(mesh(geo, MATS.pine));
  return g;
}

export function roundTree(variant: number, mat: THREE.Material): THREE.Object3D {
  const p = prop(`tree_leafy_${variant % 3}`, mat === MATS.foliageB);
  if (p) return p;
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  g.add(mesh(CROWN_GEOS[variant % 3], mat));
  return g;
}

/** 소품 모음의 집 벽 너비(tools/blender/props.py 와 같다) */
const HOUSE_W = [1.3, 1.05, 0.95, 1.2];

export function house(w: number, d: number, h: number, roofMat: THREE.Material): THREE.Object3D {
  // 파란 지붕이면 파란 집, 아니면 빨간 집 모델을 벽 너비에 맞춰 키운다
  const tint = (roofMat as THREE.MeshStandardMaterial).color;
  const variant = tint && tint.b > tint.r ? 1 : 0;
  const p = prop(`house_${variant}`);
  if (p) {
    p.scale.setScalar(w / HOUSE_W[variant]);
    return p;
  }
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
  const win = () => new THREE.BoxGeometry(0.22, 0.22, 0.05);
  for (const x of [-w * 0.3, w * 0.3]) {
    g.add(mesh(win().translate(x, h * 0.58, d / 2 + 0.02), MATS.window, false));
  }
  g.add(mesh(win().rotateY(Math.PI / 2).translate(w / 2 + 0.02, h * 0.58, 0), MATS.window, false));
  return g;
}

export function windmill(): { group: THREE.Group; hub: THREE.Group } {
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

/** 돌 우물: 둥근 돌 둘레 + 기둥 둘 + 작은 지붕 */
export function well(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.32, 0.35, 0.34, 14, 1, true).translate(0, 0.17, 0), MATS.stone));
  g.add(mesh(new THREE.TorusGeometry(0.32, 0.05, 6, 16).rotateX(Math.PI / 2).translate(0, 0.34, 0), MATS.stone));
  g.add(mesh(new THREE.CircleGeometry(0.3, 14).rotateX(-Math.PI / 2).translate(0, 0.22, 0), std('#3f7fa8', { roughness: 0.2 }), false));
  for (const x of [-0.3, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.62, 0.05).translate(x, 0.55, 0), MATS.darkWood));
  const r = 0.3;
  const roof = new THREE.CylinderGeometry(r, r, 0.5, 3).rotateX(-Math.PI / 2).scale(1.3, 0.6, 1).translate(0, 0.92, 0);
  g.add(mesh(roof, MATS.roofRed));
  return g;
}

/** 원형 울타리(gate 방향으로 한 칸 비운다) */
export function fenceRing(radius: number, gate = 0): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(8, Math.round(radius * 9));
  if (hasProps()) {
    const len = 2 * radius * Math.sin(Math.PI / n);
    const rr = radius * Math.cos(Math.PI / n);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const post = prop('fence_post')!;
      post.position.set(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      g.add(post);
      const mid = a + Math.PI / n;
      if (Math.abs(Math.atan2(Math.sin(mid - gate), Math.cos(mid - gate))) < Math.PI / n) continue;
      for (const y of [0.13, 0.25]) {
        // 가로대(길이 1, x 방향)를 이웃 기둥 사이 접선 방향으로 늘려 놓는다
        const rail = prop('fence_rail')!;
        rail.position.set(Math.cos(mid) * rr, y, Math.sin(mid) * rr);
        rail.rotation.y = -mid - Math.PI / 2;
        rail.scale.x = len + 0.04;
        g.add(rail);
      }
    }
    return g;
  }
  const posts: THREE.Object3D[] = [];
  const rails: THREE.Object3D[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const p = new THREE.Object3D();
    p.position.set(Math.cos(a) * radius, 0.16, Math.sin(a) * radius);
    posts.push(p);
    const mid = a + Math.PI / n;
    if (Math.abs(Math.atan2(Math.sin(mid - gate), Math.cos(mid - gate))) < Math.PI / n) continue;
    for (const y of [0.13, 0.25]) {
      const r = new THREE.Object3D();
      r.position.set(Math.cos(mid) * radius * Math.cos(Math.PI / n), y, Math.sin(mid) * radius * Math.cos(Math.PI / n));
      r.rotation.y = -mid;
      rails.push(r);
    }
  }
  const len = 2 * radius * Math.sin(Math.PI / n);
  g.add(instanced(new THREE.BoxGeometry(0.05, 0.32, 0.05), MATS.wood, posts));
  g.add(instanced(new THREE.BoxGeometry(0.03, 0.035, len), MATS.wood, rails));
  return g;
}

export function lampPost(): THREE.Object3D {
  const p = prop('lamp');
  if (p) return p;
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5).translate(0, 0.45, 0), MATS.darkWood));
  g.add(mesh(new THREE.OctahedronGeometry(0.1, 0).translate(0, 0.98, 0), MATS.lamp, false));
  return g;
}

export function sheep(): THREE.Object3D {
  const p = prop('sheep');
  if (p) return p;
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
  // 윗면은 둥글게 부푼 잔디 언덕
  g.add(mesh(jitter(new THREE.SphereGeometry(size, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.05, size).scale(1, 0.32, 1), MATS.grass));
  const rock = new THREE.ConeGeometry(size * 0.98, size * 2.4, 16, 6);
  rock.rotateX(Math.PI);
  rock.translate(0, -size * 1.2, 0);
  g.add(mesh(jitter(rock, size * 0.35, size + 1), MATS.miniRock));
  if (rng() > 0.35) {
    const t = rng() > 0.5 ? pineTree() : roundTree(Math.floor(rng() * 3), MATS.foliageA);
    t.scale.setScalar(size * 0.75);
    t.position.y = 0.1;
    g.add(t);
  }
  return g;
}


// ── 테마 공통 ─────────────────────────────────────────

/** 테마 하나 = 풍경 하나(떠 있는 섬 또는 지평선까지 이어진 땅). 하늘·구름·날씨·조명은 World 가 공통으로 맡는다. */
export interface Stage {
  readonly group: THREE.Group;
  /** floating: 구름바다 위에 뜬 섬 / ground: 지평선까지 이어진 땅 */
  readonly kind: 'floating' | 'ground';
  /** 카메라가 바라볼 점과 처음 거리 */
  readonly view: { target: THREE.Vector3; distance: number };
  /** 카메라가 따라갈 점(움직이는 주인공이 있는 테마만) */
  focus?(out: THREE.Vector3): THREE.Vector3;
  /** 그 위치의 땅 높이(땅 테마). 카메라가 언덕 속으로 들어가지 않게 쓴다 */
  groundHeight?(x: number, z: number): number;
  /** 빛을 구운 장면(라이트맵 + 하늘빛). 실시간 반구광·오클루전 대신 구운 빛을 쓴다 */
  readonly baked?: boolean;
  update(dt: number, t: number, env: Env): void;
}

/** 떠 있는 섬 테마의 기본 카메라 */
export const FLOATING_VIEW = { target: new THREE.Vector3(0, 0.4, 0), distance: 26 };

/** 공용 재질에 계절과 밤 불빛을 반영한다. 테마와 상관없이 프레임마다 한 번 부른다. */
export function updateSharedMaterials(env: Env): void {
  MATS.grass.color.copy(env.grass);
  MATS.foliageA.color.copy(env.foliageA);
  MATS.foliageB.color.copy(env.foliageB);
  MATS.pine.color.copy(env.pine);
  MATS.bush.color.copy(env.grass).multiplyScalar(0.72);
  MATS.window.emissiveIntensity = env.nightLights * 2.6;
  updateProps(env);
  MATS.lamp.emissiveIntensity = env.nightLights * 3;
  HEADLIGHT.emissiveIntensity = 0.4 + env.nightLights * 2.5;
  TAILLIGHT.emissiveIntensity = 0.2 + env.nightLights * 1.5;
}

/** 물·물보라 밝기: 밤에는 어둡게 */
export const waterBrightness = (env: Env) =>
  Math.min(1.1, Math.max(0.28, 0.2 + env.hemiIntensity * 0.5 + env.sunIntensity * 0.08));

/** 섬 전체가 천천히 오르내리는 높이 */
export const islandBob = (t: number) => Math.sin(t * 0.35) * 0.18;

/** 떠 있는 땅: 윗면(top) + 흙 띠 + 아래로 뾰족한 바위 받침 */
export function floatingGround(top: THREE.Material = MATS.grass): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(shapeRim(new THREE.CylinderGeometry(R, R * 0.99, 0.5, 72, 1), 0.012), top, false));
  g.add(mesh(shapeRim(new THREE.CylinderGeometry(R * 0.99, R * 0.93, 0.75, 72, 2).translate(0, -0.625, 0), 0.05), MATS.dirt, false));
  g.add(buildRockBase());
  return g;
}

/** 겹치지 않게 놓기 위한 자리 관리 */
export class Field {
  private readonly items: { x: number; z: number; r: number }[] = [];

  block(x: number, z: number, r: number): void {
    this.items.push({ x, z, r });
  }

  blockCurve(curve: THREE.Curve<THREE.Vector3>, r: number, samples = 32): void {
    for (let i = 0; i <= samples; i++) {
      const p = curve.getPointAt(i / samples);
      this.block(p.x, p.z, r);
    }
  }

  free(x: number, z: number, gap: number): boolean {
    return this.items.every((o) => Math.hypot(o.x - x, o.z - z) > o.r + gap);
  }

  /** 섬 안쪽 임의 위치. inner·outer 는 가장자리까지 거리의 비율 */
  pick(rng: Rng, inner: number, outer: number): [number, number] {
    const a = rng() * Math.PI * 2;
    const r = (inner + (outer - inner) * Math.sqrt(rng())) * R * rimFactor(a);
    return [Math.cos(a) * r, Math.sin(a) * r];
  }
}

/** 바람에 흔들리는 물체들 */
/**
 * 바람에 흔들리는 물체들. 흔들림 위상은 dt 로 누적한다.
 * (시간 t 에 바람 세기를 곱하면 바람이 바뀌는 순간 위상이 크게 튄다)
 */
export class Sway {
  private readonly items: { obj: THREE.Object3D; phase: number }[] = [];
  private readonly batches: TreeBatch[] = [];
  private fast = 0;
  private slow = 0;

  add(obj: THREE.Object3D, rng: Rng): void {
    // 기울기(x·z)는 월드 축 기준, y 돌림은 물체 자체 기준이 되도록 Rz·Rx·Ry 순서
    obj.rotation.order = 'ZXY';
    this.items.push({ obj, phase: rng() * 10 });
  }

  addBatch(batch: TreeBatch): void {
    this.batches.push(batch);
  }

  update(dt: number, env: Env): void {
    this.fast += dt * (1.2 + env.wind * 1.5);
    this.slow += dt * 0.9;
    const amount = 0.015 + env.wind * 0.06;
    // 바람 부는 쪽으로 기운 채 흔들린다
    const leanZ = -env.windX * env.wind * 0.07;
    const leanX = env.windZ * env.wind * 0.07;
    for (const s of this.items) {
      s.obj.rotation.z = Math.sin(this.fast + s.phase) * amount + leanZ;
      s.obj.rotation.x = Math.cos(this.slow + s.phase) * amount * 0.5 + leanX;
    }
    for (const b of this.batches) b.update(this.fast, this.slow, amount, leanX, leanZ);
  }
}

/** 나무 종류별 부품(지오메트리·재질). 부품 위치는 지오메트리에 들어 있어 나무 하나 = 행렬 하나 */
function treeParts(kind: number): [THREE.BufferGeometry, THREE.Material][] {
  if (hasProps()) {
    const parts = kind === 0 ? propParts('tree_pine_0') : propParts(`tree_leafy_${(kind - 1) % 3}`, kind > 3);
    if (parts) return parts;
  }
  if (kind === 0) return [[TRUNK_GEO, MATS.trunk], ...PINE_GEOS.map((g): [THREE.BufferGeometry, THREE.Material] => [g, MATS.pine])];
  const variant = (kind - 1) % 3;
  return [[TRUNK_GEO, MATS.trunk], [CROWN_GEOS[variant], kind <= 3 ? MATS.foliageA : MATS.foliageB]];
}

/**
 * 많은 나무를 종류별 InstancedMesh 로 묶어 그린다(메시 수천 개 → 수십 개).
 * 흔들림은 프레임마다 나무별 행렬을 다시 계산한다.
 */
export class TreeBatch {
  readonly group = new THREE.Group();
  private readonly trees: { kind: number; index: number; pos: THREE.Vector3; rotY: number; scale: number; phase: number }[] = [];
  private readonly meshes = new Map<number, THREE.InstancedMesh[]>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler(0, 0, 0, 'ZXY');
  private readonly s = new THREE.Vector3();

  /** kind 0: 침엽수, 1~3: 둥근 나무(잎 A, 모양 3가지), 4~6: 둥근 나무(잎 B) */
  add(kind: number, x: number, y: number, z: number, rotY: number, scale: number, phase: number): void {
    const index = this.trees.filter((t) => t.kind === kind).length;
    this.trees.push({ kind, index, pos: new THREE.Vector3(x, y, z), rotY, scale, phase });
  }

  /** 다 모은 뒤 한 번 호출해 InstancedMesh 를 만든다 */
  build(): this {
    const counts = new Map<number, number>();
    for (const t of this.trees) counts.set(t.kind, (counts.get(t.kind) ?? 0) + 1);
    for (const [kind, count] of counts) {
      const list = treeParts(kind).map(([geo, mat]) => {
        const im = new THREE.InstancedMesh(geo, mat, count);
        im.castShadow = true;
        im.receiveShadow = true;
        this.group.add(im);
        return im;
      });
      this.meshes.set(kind, list);
    }
    this.update(0, 0, 0);
    // 흔들림은 아주 작아 경계 구는 처음 한 번만 계산한다
    for (const list of this.meshes.values()) for (const im of list) im.computeBoundingSphere();
    return this;
  }

  update(fast: number, slow: number, amount: number, leanX = 0, leanZ = 0): void {
    for (const t of this.trees) {
      this.e.set(Math.cos(slow + t.phase) * amount * 0.5 + leanX, t.rotY, Math.sin(fast + t.phase) * amount + leanZ, 'ZXY');
      this.m.compose(t.pos, this.q.setFromEuler(this.e), this.s.setScalar(t.scale));
      for (const im of this.meshes.get(t.kind)!) im.setMatrixAt(t.index, this.m);
    }
    for (const list of this.meshes.values()) {
      for (const im of list) im.instanceMatrix.needsUpdate = true;
    }
  }
}

interface TreeOptions {
  count: number;
  /** 후보 위치를 고르는 함수(땅 테마용). 없으면 섬 안쪽 inner~outer */
  area?: (rng: Rng) => [number, number];
  /** 그 위치의 땅 높이. 없으면 섬 윗면 높이 */
  heightAt?: (x: number, z: number) => number;
  pineRatio?: number;
  scale?: [number, number];
  inner?: number;
  outer?: number;
  gap?: number;
}

/** 울타리 친 양 목장 하나를 빈 자리에 놓는다 */
export function pasture(group: THREE.Group, rng: Rng, field: Field, area: (rng: Rng) => [number, number], heightAt: (x: number, z: number) => number, radius = 1.1): boolean {
  for (let i = 0; i < 300; i++) {
    const [x, z] = area(rng);
    if (!field.free(x, z, radius + 0.2)) continue;
    const fence = fenceRing(radius, rng() * Math.PI * 2);
    fence.position.set(x, heightAt(x, z) - 0.03, z);
    group.add(fence);
    field.block(x, z, radius + 0.15);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + rng(), d = 0.25 + rng() * (radius - 0.55);
      const s = sheep();
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
      s.position.set(sx, heightAt(sx, sz) - 0.02, sz);
      s.rotation.y = rng() * Math.PI * 2;
      group.add(s);
    }
    return true;
  }
  return false;
}

/** 작은 집들을 빈 자리에 모아 놓는다(소품 모음의 집 4종) */
export function village(group: THREE.Group, rng: Rng, field: Field, count: number, area: (rng: Rng) => [number, number], heightAt: (x: number, z: number) => number, facing?: (x: number, z: number) => number): void {
  let placed = 0;
  for (let i = 0; i < count * 60 && placed < count; i++) {
    const [x, z] = area(rng);
    if (!field.free(x, z, 0.9)) continue;
    const h = prop(`house_${placed % 4}`) ?? house(1, 0.8, 0.8, MATS.roofRed);
    h.scale.multiplyScalar(0.85 + rng() * 0.25);
    h.position.set(x, heightAt(x, z) - 0.05, z);
    h.rotation.y = (facing ? facing(x, z) : rng() * Math.PI * 2) + (rng() - 0.5) * 0.5;
    group.add(h);
    field.block(x, z, 1.0);
    placed++;
  }
}

/** 소품(덤불·바위·건초…)을 빈 자리에 흩뿌린다. 소품 모양별로 인스턴스로 그린다 */
export function scatterProps(
  group: THREE.Group, rng: Rng, field: Field, names: string[], count: number,
  area: (rng: Rng) => [number, number], heightAt: (x: number, z: number) => number,
  [smin, smax]: [number, number] = [1, 1], footprint = 0.3,
): void {
  if (!hasProps()) return;
  const lists = names.map(() => [] as THREE.Object3D[]);
  let placed = 0;
  for (let i = 0; i < count * 15 && placed < count; i++) {
    const [x, z] = area(rng);
    const s = smin + rng() * (smax - smin);
    if (!field.free(x, z, footprint * s)) continue;
    const o = new THREE.Object3D();
    o.position.set(x, heightAt(x, z) - 0.02, z);
    o.rotation.y = rng() * Math.PI * 2;
    o.scale.setScalar(s);
    lists[Math.floor(rng() * names.length)].push(o);
    field.block(x, z, footprint * s);
    placed++;
  }
  names.forEach((n, k) => {
    if (!lists[k].length) return;
    for (const [geo, mat] of propParts(n)!) group.add(instanced(geo, mat, lists[k]));
  });
}

/** 빈 자리에 나무를 흩뿌린다 */
export function scatterTrees(group: THREE.Group, rng: Rng, field: Field, sway: Sway, o: TreeOptions): void {
  const [smin, smax] = o.scale ?? [0.75, 1.35];
  const batch = new TreeBatch();
  let placed = 0;
  for (let i = 0; i < o.count * 25 && placed < o.count; i++) {
    const [x, z] = o.area ? o.area(rng) : field.pick(rng, o.inner ?? 0.3, o.outer ?? 0.86);
    if (!field.free(x, z, o.gap ?? 0.3)) continue;
    const kind = rng() < (o.pineRatio ?? 0.5) ? 0 : 1 + Math.floor(rng() * 3) + (rng() < 0.55 ? 0 : 3);
    const s = smin + rng() * (smax - smin);
    batch.add(kind, x, o.heightAt ? o.heightAt(x, z) - 0.05 : TOP, z, rng() * Math.PI * 2, s, rng() * 10);
    field.block(x, z, 0.35 * s + 0.1);
    placed++;
  }
  group.add(batch.build().group);
  sway.addBatch(batch);
}

/** 가장자리에 늘어진 덩굴. skip 각도 근처(폭포 등)는 비운다 */
export function addVines(group: THREE.Group, rng: Rng, sway: Sway, skip: number[] = [], count = 22, radius = R): void {
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    if (skip.some((s) => Math.abs(ang - s) < 0.25)) continue;
    const len = 0.6 + rng() * 2.2;
    const r = radius * rimFactor(ang) * 0.985;
    const v = mesh(new THREE.CylinderGeometry(0.035, 0.015, len, 4).translate(0, -len / 2, 0), MATS.vine, false);
    v.position.set(Math.cos(ang) * r, 0.1, Math.sin(ang) * r);
    group.add(v);
    sway.add(v, rng);
  }
}

/** 섬 가장자리 각도 a 의 바깥쪽 끝 점(윗면 높이) */
export function rimPoint(a: number, scale = 1): THREE.Vector3 {
  const r = R * rimFactor(a) * scale;
  return new THREE.Vector3(Math.cos(a) * r, TOP, Math.sin(a) * r);
}

/** 땅 위를 흐르는 강 띠 */
export function riverMesh(curve: THREE.Curve<THREE.Vector3>, width: number): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = riverMaterial();
  const m = new THREE.Mesh(ribbon(curve, width, 90, TOP + 0.015), mat);
  m.receiveShadow = true;
  return { mesh: m, mat };
}

/** 가장자리에서 구름바다로 떨어지는 폭포 면과 물보라 */
export class Waterfall {
  readonly group = new THREE.Group();
  private readonly mat = fallMaterial();
  private readonly mist?: THREE.Points;
  private readonly mistMat?: THREE.PointsMaterial;
  private readonly mistState: { s: number; a: number; b: number; speed: number }[] = [];
  private readonly side: THREE.Vector3;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly fall: Fall, rng: Rng, mistCount = 150) {
    const sheet = new THREE.Mesh(fallSheet(fall), this.mat);
    sheet.renderOrder = 2;
    this.group.add(sheet);
    this.side = new THREE.Vector3(-fall.outward.z, 0, fall.outward.x);
    if (mistCount > 0) {
      for (let i = 0; i < mistCount; i++) {
        this.mistState.push({ s: rng(), a: rng() - 0.5, b: rng(), speed: 0.05 + rng() * 0.05 });
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(mistCount * 3), 3));
      this.mistMat = new THREE.PointsMaterial({
        map: softSprite(), size: 2.2, transparent: true, opacity: 0.16, depthWrite: false, color: '#ffffff',
      });
      this.mist = new THREE.Points(geo, this.mistMat);
      this.mist.frustumCulled = false;
      this.group.add(this.mist);
    }
  }

  update(dt: number, t: number, bright: number): void {
    this.mat.uniforms.time.value = t;
    this.mat.uniforms.bright.value = bright;
    if (!this.mist || !this.mistMat) return;
    this.mistMat.color.setScalar(bright);
    // 물보라: 폭포를 따라 내려가며 바깥으로 퍼진다
    const pos = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
    const f = this.fall;
    const p = this.tmp;
    for (let i = 0; i < this.mistState.length; i++) {
      const m = this.mistState[i];
      m.s += dt * m.speed;
      if (m.s > 1) m.s -= 1;
      fallPoint(f, m.s, p)
        .addScaledVector(this.side, m.a * f.width * (1 + m.s * 2.5))
        .addScaledVector(f.outward, 0.15 + m.b * 0.5 + m.s * 1.2);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
  }
}

/** 가장자리 각도에서 떨어지는 폭포 정의 */
export function fallAt(angle: number, opts: { width: number; length: number; reach: number; y?: number; inset?: number }): Fall {
  const outward = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const origin = rimPoint(angle, opts.inset ?? 1).addScaledVector(outward, 0.04).setY(opts.y ?? TOP + 0.01);
  return { origin, outward, width: opts.width, length: opts.length, reach: opts.reach };
}

/** 모든 테마 주변을 떠다니는 작은 섬들 */
export class Floaters {
  readonly group = new THREE.Group();
  private readonly items: { obj: THREE.Object3D; x: number; z: number; y: number; phase: number }[] = [];

  constructor(rng: Rng) {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + rng() * 0.6;
      const mini = miniIsland(rng, 0.45 + rng() * 0.5);
      const dist = 10 + rng() * 7;
      const y = -2.5 + rng() * 5;
      mini.position.set(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
      mini.rotation.y = rng() * Math.PI;
      this.group.add(mini);
      this.items.push({ obj: mini, x: mini.position.x, z: mini.position.z, y, phase: rng() * 10 });
    }
  }

  /** 큰 섬과 겹치지 않게 떠다니는 섬들을 k 배 바깥으로 */
  spread(k: number): void {
    for (const f of this.items) f.obj.position.set(f.x * k, f.obj.position.y, f.z * k);
  }

  update(dt: number, t: number): void {
    for (const f of this.items) {
      f.obj.position.y = f.y + Math.sin(t * 0.5 + f.phase) * 0.35;
      f.obj.rotation.y += dt * 0.03;
    }
  }
}

// ── 땅 테마 공통 ───────────────────────────────────────

/** 부드럽게 굽이치는 언덕 높이 */
export function rollingHills(x: number, z: number, amp = 1): number {
  return amp * (
    0.9 * Math.sin(x * 0.17 + 1.3) * Math.cos(z * 0.13 + 0.4) +
    0.45 * Math.sin(x * 0.31 - z * 0.27 + 2.1) +
    0.2 * Math.cos(x * 0.6 + z * 0.55)
  );
}

/** 지평선까지 이어지는 지형. height 로 정점 높이를 정한다 */
export function terrain(height: (x: number, z: number) => number, mat: THREE.Material = MATS.grass, size = 140, seg = 110): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, height(x, z) + (hash3(x, 0, z) - 0.5) * 0.06);
  }
  geo.computeVertexNormals();
  const m = mesh(geo, mat, false);
  return m;
}

const MOUNTAIN = std('#7a8796');
const SNOWCAP = std('#eef2f6');

/** 멀리 둘러선 산. 안개에 반쯤 묻혀 지평선을 만든다 */
export function distantMountains(rng: Rng, radius = 46, count = 22, keep: (angle: number) => boolean = () => true): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rng() * 0.2;
    if (!keep(a)) continue;
    const d = radius + rng() * 14;
    const h = 7 + rng() * 11;
    const r = 7 + rng() * 8;
    const m = new THREE.Group();
    m.add(mesh(jitter(new THREE.ConeGeometry(r, h, 7, 2), 0.8, i), MOUNTAIN, false));
    if (h > 11) m.add(mesh(new THREE.ConeGeometry(r * 0.3, h * 0.3, 7).translate(0, h * 0.36, 0), SNOWCAP, false));
    m.position.set(Math.cos(a) * d, h / 2 - 1.5, Math.sin(a) * d);
    m.rotation.y = rng() * Math.PI;
    g.add(m);
  }
  return g;
}

/** 원(반지름 inner~outer) 안의 임의 위치 */
export const ringArea = (inner: number, outer: number) => (rng: Rng): [number, number] => {
  const a = rng() * Math.PI * 2;
  const r = Math.sqrt(inner * inner + rng() * (outer * outer - inner * inner));
  return [Math.cos(a) * r, Math.sin(a) * r];
};

/** 앞이 +x 인 물체를 곡선 진행 방향(기울기 포함)으로 놓는다 */
export function alongCurve(obj: THREE.Object3D, curve: THREE.Curve<THREE.Vector3>, u: number, lift = 0): void {
  const p = curve.getPointAt(u);
  const tan = curve.getTangentAt(u);
  obj.position.set(p.x, p.y + lift, p.z);
  obj.rotation.order = 'YZX';
  obj.rotation.y = Math.atan2(-tan.z, tan.x);
  obj.rotation.z = Math.atan2(tan.y, Math.hypot(tan.x, tan.z));
}

// ── 자동차(드라이브·도시 공용) ───────────────────────────

const CAR_GLASS = std('#2b3a4a', { roughness: 0.3, metalness: 0.2 });
const CAR_TIRE = std('#222326');
/** 전조등·미등. 밤 밝기는 updateSharedMaterials 가 맞춘다 */
export const HEADLIGHT = std('#fff6d8', { emissive: '#fff3c4', emissiveIntensity: 0.4 });
export const TAILLIGHT = std('#7a1e1e', { emissive: '#ff3b2f', emissiveIntensity: 0.2 });

/** 앞이 +x 인 작은 차. tall 이면 캠핑 밴·버스 */
export function vehicle(color: THREE.ColorRepresentation, tall: boolean): { group: THREE.Group; wheels: THREE.Mesh[] } {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.5 });
  const bodyH = tall ? 0.2 : 0.15;
  g.add(mesh(new THREE.BoxGeometry(0.66, bodyH, 0.32).translate(0, 0.09 + bodyH / 2, 0), paint));
  if (tall) {
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.2, 0.31).translate(-0.06, 0.39, 0), std('#f4f1e6')));
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.13, 0.32).translate(0.21, 0.37, 0), CAR_GLASS));
  } else {
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.14, 0.28).translate(-0.04, 0.31, 0), CAR_GLASS));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.02, 0.29).translate(-0.04, 0.39, 0), paint));
  }
  for (const z of [-0.1, 0.1]) {
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06).translate(0.335, 0.17, z), HEADLIGHT, false));
    g.add(mesh(new THREE.BoxGeometry(0.02, 0.05, 0.06).translate(-0.335, 0.17, z), TAILLIGHT, false));
  }
  const wheels: THREE.Mesh[] = [];
  const wheelGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 10).rotateX(Math.PI / 2);
  for (const x of [-0.2, 0.2]) {
    for (const z of [-0.16, 0.16]) {
      const w = mesh(wheelGeo, CAR_TIRE);
      w.position.set(x, 0.075, z);
      g.add(w);
      wheels.push(w);
    }
  }
  return { group: g, wheels };
}

/** 같은 부품을 여러 곳에 놓을 때 InstancedMesh 하나로 묶는다 */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, placements: THREE.Object3D[], cast = true): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(geo, mat, placements.length);
  placements.forEach((p, i) => {
    p.updateMatrix();
    im.setMatrixAt(i, p.matrix);
  });
  im.castShadow = cast;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}
