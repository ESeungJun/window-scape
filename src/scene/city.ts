import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { prop } from './props';
import {
  MATS, Sway, TOP, lampPost, mesh, rimFactor, roundTree, rollingHills, shapeRim, std, terrain, vehicle, type Stage,
} from './kit';

/**
 * 도시 테마: 파스텔 장난감 도시. 강물에 둘러싸인 작은 섬에 낮은 파스텔 건물과 둥근 탑 몇 개,
 * 분수 광장과 가로수, 파스텔 자동차와 버스. 창문은 큼직하게 적게 둬 미니어처처럼 보이게 한다.
 */
const CITY_R = 9.5;
const PAVE_R = 7.7;
const BLOCK = 1.75;
const PITCH = 2.25;
const CELL = 0.3; // 창문 한 칸(월드 단위)
const TEX_CELLS = 4;

/** 건너편 강가 언덕 높이 */
function shoreHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  return r < 20 ? -2 : -0.5 + Math.min(1, (r - 20) / 5) * (1.4 + rollingHills(x, z, 1.2));
}

/** 시드 난수로 섞기(Fisher–Yates). sort 비교 함수는 엔진마다 결과가 달라 배치가 어긋난다 */
function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const PASTELS = ['#f6c1c7', '#bfe3d5', '#f9e2a7', '#cdbfe8', '#f8cfae', '#bcd9f2', '#f3efe6'];
const ROOFS = ['#d9826b', '#6fb3a8', '#5d6f9e', '#c9a56a'];

/** 큼직한 창문 텍스처: 낮에는 흰 창틀 하늘색 유리, 밤에는 일부만 켜진다 */
function windowTextures(rng: Rng): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture } {
  const px = 32;
  const size = px * TEX_CELLS;
  const canvas = () => Object.assign(document.createElement('canvas'), { width: size, height: size });
  const day = canvas();
  const night = canvas();
  const d = day.getContext('2d')!;
  const n = night.getContext('2d')!;
  d.fillStyle = '#ffffff';
  d.fillRect(0, 0, size, size);
  n.fillStyle = '#000000';
  n.fillRect(0, 0, size, size);
  for (let y = 0; y < TEX_CELLS; y++) {
    for (let x = 0; x < TEX_CELLS; x++) {
      const wx = x * px + 9, wy = y * px + 7, ww = 14, wh = 17;
      d.fillStyle = '#9cc7e6';
      d.fillRect(wx, wy, ww, wh);
      d.fillStyle = '#ffffff';
      d.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      if (rng() < 0.4) {
        n.fillStyle = '#ffd59a';
        n.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const tex = (c: HTMLCanvasElement) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: tex(day), glow: tex(night) };
}

/** 창문이 실제 크기로 반복되도록 상자 UV 를 치수에 맞춘다. 지붕·바닥은 벽 픽셀(0,0)을 쓴다 */
function boxGeo(w: number, h: number, d: number, offset: number): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const span = CELL * TEX_CELLS;
  const faceW = [d, d, 0, 0, w, w]; // +x, -x, +y, -y, +z, -z
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (faceW[f] === 0) uv.setXY(i, 0.01, 0.01);
      else uv.setXY(i, offset + (uv.getX(i) * faceW[f]) / span, (uv.getY(i) * h) / span);
    }
  }
  return geo.translate(0, h / 2, 0);
}

export class City implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'ground' as const;
  readonly view = { target: new THREE.Vector3(0, 0.8, 0), distance: 21 };
  private readonly walls: THREE.MeshStandardMaterial[] = [];
  private readonly pave = std('#e6dfd3');
  private readonly paveBase = new THREE.Color('#e6dfd3');
  private readonly snow = new THREE.Color('#f3f6f9');
  private readonly lampMat = std('#4a4038', { emissive: '#ffd9a0', emissiveIntensity: 0 });
  private readonly cars: { obj: THREE.Group; path: THREE.CurvePath<THREE.Vector3>; u: number; speed: number; length: number }[] = [];
  private readonly sway = new Sway();
  private readonly jet: THREE.Mesh;

  constructor(rng: Rng) {
    const g = this.group;

    // 땅: 잔디 섬 + 그 위 포장 광장, 둘레 강물, 건너편 낮은 언덕
    g.add(mesh(shapeRim(new THREE.CylinderGeometry(CITY_R, CITY_R + 0.5, 1, 72).translate(0, TOP - 0.5, 0), 0.01), MATS.grass, false));
    g.add(mesh(shapeRim(new THREE.CylinderGeometry(PAVE_R, PAVE_R, 0.04, 72).translate(0, TOP + 0.02, 0), 0.005), this.pave, false));
    const water = mesh(new THREE.PlaneGeometry(240, 240).rotateX(-Math.PI / 2), std('#5fa8cf', { flatShading: false, roughness: 0.15, metalness: 0.1 }), false);
    water.position.y = -0.2;
    g.add(water);
    g.add(terrain(shoreHeight));

    const { map, glow } = windowTextures(rng);
    for (const c of PASTELS) {
      this.walls.push(std(c, { map, emissive: '#ffffff', emissiveMap: glow, emissiveIntensity: 0, flatShading: false, roughness: 0.8 }));
    }
    const roofs = ROOFS.map((c) => std(c));
    const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

    const inside = (x: number, z: number) => Math.hypot(x, z) < PAVE_R * rimFactor(Math.atan2(z, x)) * 0.98;
    const towers = new Set(['1,0', '-1,-1', '0,1']);
    const parks = new Set(['-2,1', '1,-2']);

    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const cx = i * PITCH, cz = j * PITCH;
        const h = BLOCK / 2;
        if (![[-h, -h], [h, -h], [-h, h], [h, h]].every(([dx, dz]) => inside(cx + dx, cz + dz))) continue;
        const key = `${i},${j}`;
        if (i === 0 && j === 0) this.plaza(cx, cz, rng);
        else if (parks.has(key)) this.park(cx, cz, rng);
        else if (towers.has(key)) this.tower(cx, cz, pick(this.walls), pick(roofs), rng);
        else this.houses(cx, cz, rng, pick, roofs);
      }
    }

    // 가로등과 가로수: 교차로마다
    for (let i = -3; i < 3; i++) {
      for (let j = -3; j < 3; j++) {
        const x = (i + 0.5) * PITCH, z = (j + 0.5) * PITCH;
        if (!inside(x, z)) continue;
        const lamp = lampPost();
        lamp.position.set(x + 0.28, TOP + 0.04, z + 0.28);
        lamp.scale.setScalar(0.55);
        lamp.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.material === MATS.lamp) m.material = this.lampMat;
        });
        g.add(lamp);
        const tree = roundTree(Math.floor(rng() * 3), MATS.foliageA);
        tree.scale.setScalar(0.42);
        tree.position.set(x - 0.28, TOP + 0.04, z - 0.28);
        g.add(tree);
        this.sway.add(tree, rng);
      }
    }

    // 섬 둘레 잔디 띠의 나무
    for (let k = 0; k < 46; k++) {
      const a = (k / 46) * Math.PI * 2 + rng() * 0.08;
      const r = (PAVE_R + 0.5 + rng() * 0.9) * rimFactor(a);
      const tree = roundTree(k % 3, rng() < 0.6 ? MATS.foliageA : MATS.foliageB);
      tree.scale.setScalar(0.45 + rng() * 0.25);
      tree.position.set(Math.cos(a) * r, TOP, Math.sin(a) * r);
      g.add(tree);
      this.sway.add(tree, rng);
    }

    // 파스텔 자동차와 버스: 거리 한가운데를 따라 사각형으로 돈다
    const loop = (half: number) => {
      const path = new THREE.CurvePath<THREE.Vector3>();
      const c = [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]];
      for (let k = 0; k < 4; k++) {
        path.add(new THREE.LineCurve3(
          new THREE.Vector3(c[k][0], TOP + 0.04, c[k][1]),
          new THREE.Vector3(c[k + 1][0], TOP + 0.04, c[k + 1][1]),
        ));
      }
      return path;
    };
    for (const [half, count, speed] of [[PITCH * 0.5, 2, 0.7], [PITCH * 1.5, 4, 0.9]] as const) {
      const path = loop(half);
      const length = path.getLength();
      for (let k = 0; k < count; k++) {
        const bus = k === 0 && half > PITCH;
        const car = vehicle(bus ? '#f0b44c' : PASTELS[(k * 2 + 1) % PASTELS.length], bus).group;
        car.scale.setScalar(bus ? 0.62 : 0.5);
        g.add(car);
        this.cars.push({ obj: car, path, u: k / count + rng() * 0.05, speed, length });
      }
    }

    // 분수 물줄기
    this.jet = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.7, 8, 1, true).translate(0, 0.35, 0),
      new THREE.MeshStandardMaterial({ color: '#d8f0ff', transparent: true, opacity: 0.7, roughness: 0.1 }),
    );
    this.jet.position.set(0, TOP + 0.3, 0);
    g.add(this.jet);
  }

  /** 낮은 집 2~4채: 박공지붕 또는 평지붕 */
  private houses(cx: number, cz: number, rng: Rng, pick: <T>(a: T[]) => T, roofs: THREE.Material[]): void {
    const n = 2 + Math.floor(rng() * 3);
    const lot = (BLOCK - 0.2) / 2;
    const spots = shuffle([[-1, -1], [1, -1], [-1, 1], [1, 1]], rng).slice(0, n);
    for (const [sx, sz] of spots) {
      const x = cx + sx * lot * 0.5, z = cz + sz * lot * 0.5;
      const w = lot * (0.8 + rng() * 0.15), d = lot * (0.8 + rng() * 0.15);
      const h = 0.55 + rng() * 0.7;
      // 소품 모음의 연립주택(2·3·4층)을 블록 바깥쪽 길을 보게 놓는다
      const floors = h < 0.8 ? [0, 4] : h < 1.05 ? [1, 2] : [3, 5];
      const town = prop(`town_${pick(floors)}`);
      if (town) {
        town.scale.set(w, (w + d) / 2, d);
        town.position.set(x, TOP + 0.04, z);
        town.rotation.y = rng() < 0.5 ? (sz > 0 ? 0 : Math.PI) : (sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        this.group.add(town);
        continue;
      }
      this.group.add(mesh(boxGeo(w, h, d, rng()).translate(x, TOP + 0.04, z), pick(this.walls)));
      if (rng() < 0.6) {
        // 박공지붕: 삼각 기둥
        const r = (w / 2 + 0.06) / 0.866;
        const roof = new THREE.CylinderGeometry(r, r, d + 0.08, 3).rotateX(-Math.PI / 2).scale(1, 0.6, 1);
        this.group.add(mesh(roof.translate(x, TOP + 0.04 + h + r * 0.3, z), pick(roofs)));
      } else {
        this.group.add(mesh(new THREE.BoxGeometry(w + 0.04, 0.06, d + 0.04).translate(x, TOP + 0.04 + h + 0.03, z), pick(roofs), false));
      }
    }
  }

  /** 둥근 탑: 원통 몸체 + 돔 또는 뾰족 지붕 */
  private tower(cx: number, cz: number, wall: THREE.MeshStandardMaterial, roof: THREE.Material, rng: Rng): void {
    const g = this.group;
    const h = 2.4 + rng() * 1.2;
    const r = 0.55;
    const model = prop(`tower_${rng() < 0.5 ? 1 : 0}`);
    if (model) {
      model.scale.set(1, h / 3, 1);
      model.position.set(cx, TOP + 0.04, cz);
      g.add(model);
      // 탑 옆 낮은 건물 둘
      for (const dx of [-0.42, 0.42]) {
        const low = prop('town_4')!;
        low.scale.set(BLOCK * 0.44, 0.55, 0.5);
        low.position.set(cx + dx * BLOCK, TOP + 0.04, cz + BLOCK * 0.32);
        g.add(low);
      }
      return;
    }
    const body = new THREE.CylinderGeometry(r, r, h, 16);
    // 원통 UV 도 창문 크기에 맞춘다
    const uv = body.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * Math.PI * 2 * r) / (CELL * TEX_CELLS), (uv.getY(i) * h) / (CELL * TEX_CELLS));
    g.add(mesh(body.translate(cx, TOP + 0.04 + h / 2, cz), wall));
    const top = TOP + 0.04 + h;
    if (rng() < 0.5) {
      g.add(mesh(new THREE.SphereGeometry(r * 1.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(cx, top, cz), roof));
    } else {
      g.add(mesh(new THREE.ConeGeometry(r * 1.1, 0.9, 16).translate(cx, top + 0.45, cz), roof));
    }
    // 탑 옆 낮은 건물로 블록을 채운다
    g.add(mesh(boxGeo(BLOCK * 0.9, 0.6, 0.5, rng()).translate(cx, TOP + 0.04, cz + BLOCK * 0.32), wall));
  }

  private plaza(cx: number, cz: number, rng: Rng): void {
    const g = this.group;
    g.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.16, 20).translate(cx, TOP + 0.12, cz), std('#d9d2c4')));
    g.add(mesh(new THREE.CylinderGeometry(0.47, 0.47, 0.02, 20).translate(cx, TOP + 0.2, cz), std('#7cc3e6', { roughness: 0.1 }), false));
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8).translate(cx, TOP + 0.3, cz), std('#d9d2c4')));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const tree = roundTree(k % 3, MATS.foliageB);
      tree.scale.setScalar(0.5);
      tree.position.set(cx + Math.cos(a) * 0.75, TOP + 0.04, cz + Math.sin(a) * 0.75);
      g.add(tree);
      this.sway.add(tree, rng);
    }
  }

  private park(cx: number, cz: number, rng: Rng): void {
    const g = this.group;
    g.add(mesh(new THREE.BoxGeometry(BLOCK, 0.05, BLOCK).translate(cx, TOP + 0.045, cz), MATS.grass, false));
    for (let k = 0; k < 6; k++) {
      const tree = roundTree(k % 3, rng() < 0.5 ? MATS.foliageA : MATS.foliageB);
      tree.scale.setScalar(0.45 + rng() * 0.2);
      tree.position.set(cx + (rng() - 0.5) * BLOCK * 0.75, TOP + 0.07, cz + (rng() - 0.5) * BLOCK * 0.75);
      g.add(tree);
      this.sway.add(tree, rng);
    }
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.05, 0.12).translate(cx, TOP + 0.15, cz), MATS.wood));
  }

  update(dt: number, t: number, env: Env): void {
    this.pave.color.copy(this.paveBase).lerp(this.snow, env.snowCover * 0.7);
    for (const m of this.walls) m.emissiveIntensity = env.nightLights * 1.1;
    this.lampMat.emissiveIntensity = env.nightLights * 3;
    this.jet.scale.y = 0.85 + Math.sin(t * 5) * 0.15;
    this.jet.visible = env.snowCover < 0.9;

    for (const car of this.cars) {
      car.u = (car.u + (dt * car.speed) / car.length) % 1;
      const p = car.path.getPointAt(car.u);
      const tan = car.path.getTangentAt(car.u);
      car.obj.position.copy(p);
      car.obj.rotation.y = Math.atan2(-tan.z, tan.x);
    }
    this.sway.update(dt, env);
  }

  groundHeight(x: number, z: number): number {
    return Math.max(shoreHeight(x, z), Math.hypot(x, z) < CITY_R + 0.5 ? TOP : -0.2);
  }
}
