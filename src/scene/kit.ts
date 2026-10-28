import * as THREE from 'three';
import type { Env } from './env';
import { jitter, softSprite, type Rng } from '../util';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fallMaterial, riverMaterial } from './water';

/**
 * 테마들이 함께 쓰는 것: 하늘섬 윤곽, 강 띠·폭포, 바람 흔들림, 둘레를 떠다니는 작은 섬, 계절 공용 재질.
 * 섬과 디오라마 모양은 Blender 모델(tools/blender)이 맡는다.
 */
export const R = 6;
export const TOP = 0.25;

/** 섬 가장자리의 반지름 배율. 원이 아니라 울퉁불퉁한 윤곽을 만든다. */
export function rimFactor(a: number): number {
  return 1 + 0.1 * Math.sin(3 * a + 0.7) + 0.06 * Math.sin(5 * a + 2.1) + 0.04 * Math.sin(7 * a + 4);
}

export const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });

// 떠다니는 작은 섬과 하늘섬 덩굴이 쓰는 공용 재질(계절 따라 색이 바뀐다)
export const MATS = {
  grass: std('#59a843'),
  miniRock: std('#8f7a66'),
  trunk: std('#7a5a42'),
  pine: std('#4f7a57'),
  foliageA: std('#e8902f'),
  vine: std('#5f7f4a'),
};

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = true;
  return m;
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

/** 떠다니는 작은 섬: 둥근 잔디 언덕 + 아래로 뾰족한 바위, 가끔 나무 한 그루 */
function miniIsland(rng: Rng, size: number): THREE.Group {
  const g = new THREE.Group();
  // 윗면은 둥글게 부푼 잔디 언덕
  g.add(mesh(jitter(new THREE.SphereGeometry(size, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0.05, size).scale(1, 0.32, 1), MATS.grass));
  const rock = new THREE.ConeGeometry(size * 0.98, size * 2.4, 16, 6);
  rock.rotateX(Math.PI);
  rock.translate(0, -size * 1.2, 0);
  g.add(mesh(jitter(rock, size * 0.35, size + 1), MATS.miniRock));
  if (rng() > 0.35) {
    const t = new THREE.Group();
    t.add(mesh(TRUNK_GEO, MATS.trunk));
    if (rng() > 0.5) for (const geo of PINE_GEOS) t.add(mesh(geo, MATS.pine));
    else t.add(mesh(CROWN_GEOS[Math.floor(rng() * 3)], MATS.foliageA));
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

/** 공용 재질에 계절을 반영한다. 테마와 상관없이 프레임마다 한 번 부른다. */
export function updateSharedMaterials(env: Env): void {
  MATS.grass.color.copy(env.grass);
  MATS.foliageA.color.copy(env.foliageA);
  MATS.pine.color.copy(env.pine);
}

/** 물·물보라 밝기: 밤에는 어둡게 */
export const waterBrightness = (env: Env) =>
  Math.min(1.1, Math.max(0.28, 0.2 + env.hemiIntensity * 0.5 + env.sunIntensity * 0.08));

/** 섬 전체가 천천히 오르내리는 높이 */
export const islandBob = (t: number) => Math.sin(t * 0.35) * 0.18;

/**
 * 바람에 흔들리는 물체들. 흔들림 위상은 dt 로 누적한다.
 * (시간 t 에 바람 세기를 곱하면 바람이 바뀌는 순간 위상이 크게 튄다)
 */
export class Sway {
  private readonly items: { obj: THREE.Object3D; phase: number }[] = [];
  private fast = 0;
  private slow = 0;

  add(obj: THREE.Object3D, rng: Rng): void {
    // 기울기(x·z)는 월드 축 기준, y 돌림은 물체 자체 기준이 되도록 Rz·Rx·Ry 순서
    obj.rotation.order = 'ZXY';
    this.items.push({ obj, phase: rng() * 10 });
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
  }
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
