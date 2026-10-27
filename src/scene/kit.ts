import * as THREE from 'three';
import type { Env } from './env';
import { hash3, jitter, softSprite, type Rng } from '../util';
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
  new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.92, ...extra });

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

export function buildRockBase(radius = R): THREE.Mesh {
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

export function fallPoint(f: Fall, s: number, out: THREE.Vector3): THREE.Vector3 {
  return out
    .copy(f.origin)
    .addScaledVector(f.outward, f.reach * (1 - Math.exp(-s * 6)))
    .setY(f.origin.y - s * f.length);
}

/** 가장자리에서 바깥으로 튀어나갔다가 아래로 떨어지는 폭포 면 */
export function fallSheet(f: Fall): THREE.BufferGeometry {
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

export const TRUNK_GEO = new THREE.CylinderGeometry(0.07, 0.11, 0.5, 5).translate(0, 0.25, 0);
export const PINE_GEOS = [
  [0.55, 0.75, 0.55],
  [0.44, 0.65, 0.9],
  [0.3, 0.55, 1.2],
].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 7).translate(0, y, 0));
export const CROWN_GEOS = [0, 1, 2].map((i) => jitter(new THREE.IcosahedronGeometry(0.5, 0), 0.18, i * 3.1).translate(0, 0.95, 0));

export function pineTree(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  for (const geo of PINE_GEOS) g.add(mesh(geo, MATS.pine));
  return g;
}

export function roundTree(variant: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(TRUNK_GEO, MATS.trunk));
  g.add(mesh(CROWN_GEOS[variant % 3], mat));
  return g;
}

export function house(w: number, d: number, h: number, roofMat: THREE.Material): THREE.Group {
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

export function lampPost(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.9, 5).translate(0, 0.45, 0), MATS.darkWood));
  g.add(mesh(new THREE.OctahedronGeometry(0.1, 0).translate(0, 0.98, 0), MATS.lamp, false));
  return g;
}

export function sheep(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(jitter(new THREE.BoxGeometry(0.42, 0.28, 0.28, 2, 1, 1), 0.04).translate(0, 0.24, 0), MATS.sheep));
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.16, 0.16).translate(0.25, 0.32, 0), MATS.sheepHead));
  for (const [x, z] of [[-0.13, -0.08], [-0.13, 0.08], [0.13, -0.08], [0.13, 0.08]]) {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05).translate(x, 0.06, z), MATS.sheepHead));
  }
  return g;
}

export function miniIsland(rng: Rng, size: number): THREE.Group {
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


// ── 테마 공통 ─────────────────────────────────────────

/** 테마 하나 = 떠 있는 섬 위의 장면 하나. 하늘·구름·날씨·조명은 World 가 공통으로 맡는다. */
export interface Stage {
  readonly group: THREE.Group;
  /** floating: 구름바다 위에 뜬 섬 / ground: 지평선까지 이어진 땅 */
  readonly kind: 'floating' | 'ground';
  /** 카메라가 바라볼 점과 처음 거리 */
  readonly view: { target: THREE.Vector3; distance: number };
  /** 카메라가 따라갈 점(움직이는 주인공이 있는 테마만) */
  focus?(out: THREE.Vector3): THREE.Vector3;
  update(dt: number, t: number, env: Env): void;
}

/** 떠 있는 섬 테마의 기본 카메라 */
export const FLOATING_VIEW = { target: new THREE.Vector3(0, -1.5, 0), distance: 25.5 };

/** 공용 재질에 계절과 밤 불빛을 반영한다. 테마와 상관없이 프레임마다 한 번 부른다. */
export function updateSharedMaterials(env: Env): void {
  MATS.grass.color.copy(env.grass);
  MATS.foliageA.color.copy(env.foliageA);
  MATS.foliageB.color.copy(env.foliageB);
  MATS.pine.color.copy(env.pine);
  MATS.window.emissiveIntensity = env.nightLights * 2.6;
  MATS.lamp.emissiveIntensity = env.nightLights * 3;
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
export class Sway {
  private readonly items: { obj: THREE.Object3D; phase: number }[] = [];

  add(obj: THREE.Object3D, rng: Rng): void {
    this.items.push({ obj, phase: rng() * 10 });
  }

  update(t: number, env: Env): void {
    const amount = 0.015 + env.wind * 0.06;
    for (const s of this.items) {
      s.obj.rotation.z = Math.sin(t * (1.2 + env.wind * 1.5) + s.phase) * amount;
      s.obj.rotation.x = Math.cos(t * 0.9 + s.phase) * amount * 0.5;
    }
  }
}

export interface TreeOptions {
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

/** 빈 자리에 나무를 흩뿌린다 */
export function scatterTrees(group: THREE.Group, rng: Rng, field: Field, sway: Sway, o: TreeOptions): void {
  const [smin, smax] = o.scale ?? [0.75, 1.35];
  let placed = 0;
  for (let i = 0; i < o.count * 25 && placed < o.count; i++) {
    const [x, z] = o.area ? o.area(rng) : field.pick(rng, o.inner ?? 0.3, o.outer ?? 0.86);
    if (!field.free(x, z, o.gap ?? 0.3)) continue;
    const tree = rng() < (o.pineRatio ?? 0.5)
      ? pineTree()
      : roundTree(Math.floor(rng() * 3), rng() < 0.55 ? MATS.foliageA : MATS.foliageB);
    const s = smin + rng() * (smax - smin);
    tree.scale.setScalar(s);
    tree.position.set(x, o.heightAt ? o.heightAt(x, z) - 0.05 : TOP, z);
    tree.rotation.y = rng() * Math.PI * 2;
    group.add(tree);
    sway.add(tree, rng);
    field.block(x, z, 0.35 * s + 0.1);
    placed++;
  }
}

/** 가장자리에 늘어진 덩굴. skip 각도 근처(폭포 등)는 비운다 */
export function addVines(group: THREE.Group, rng: Rng, sway: Sway, skip: number[] = [], count = 22): void {
  for (let i = 0; i < count; i++) {
    const ang = rng() * Math.PI * 2;
    if (skip.some((s) => Math.abs(ang - s) < 0.25)) continue;
    const len = 0.6 + rng() * 2.2;
    const r = R * rimFactor(ang) * 0.985;
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
  private readonly items: { obj: THREE.Object3D; y: number; phase: number }[] = [];

  constructor(rng: Rng) {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + rng() * 0.6;
      const mini = miniIsland(rng, 0.5 + rng() * 0.9);
      const dist = 10 + rng() * 7;
      const y = -2.5 + rng() * 5;
      mini.position.set(Math.cos(ang) * dist, y, Math.sin(ang) * dist);
      mini.rotation.y = rng() * Math.PI;
      this.group.add(mini);
      this.items.push({ obj: mini, y, phase: rng() * 10 });
    }
  }

  update(dt: number, t: number): void {
    for (const f of this.items) {
      f.obj.position.y = f.y + Math.sin(t * 0.5 + f.phase) * 0.35;
      f.obj.rotation.y += dt * 0.03;
    }
  }
}

// ── 땅 테마 공통 ───────────────────────────────────────

/** 땅 테마의 기본 카메라 */
export const GROUND_VIEW = { target: new THREE.Vector3(0, 0.6, 0), distance: 21 };

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
