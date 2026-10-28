import * as THREE from 'three';
import type { Env } from './env';
import { softSprite, type Rng } from '../util';
import { applyLightmap, applyOpenSky } from './baked';
import { loadModel, trackMaterials } from './props';
import { riverMaterial } from './water';
import { Sway, Waterfall, waterBrightness, type Stage } from './kit';

/**
 * 땅에 놓인 디오라마 테마(드라이브·도시·성·숲)의 공통 틀. 모양은 Blender 에서 직접 모델링한 public/models/<이름>.glb
 * (만드는 법: tools/blender/<이름>.py, 공용 바닥: tools/blender/tile.py)이고 빛은 구운 라이트맵에 하늘빛을 곱해 쓴다.
 * 가운데 네모 땅은 구운 빛, 그 둘레를 지평선까지 잇는 먼 풍경(far_*)은 탁 트인 하늘빛을 받는다.
 * 여기서는 그 위에 물(liquid_*), 폭포, 나무 흔들림, 계절 색, 밤 불빛을 입히고,
 * 움직이는 것(mover_*)은 테마별 하위 클래스가 onLoad/tick 에서 움직인다.
 */

/** 모델과 함께 오는 자리(tools/blender 의 layout). 좌표는 앱 좌표(x, y, z) */
export interface Layout {
  lights?: [number, number, number][];
  falls?: { origin: [number, number, number]; outward: [number, number, number]; width: number; length: number; reach: number }[];
  /** 움직이는 것이 따라갈 길(이름 → 점들) */
  paths?: Record<string, [number, number, number][]>;
  /** 굴뚝 연기가 피어오르는 점 */
  smoke?: [number, number, number];
  /** 땅 높이 격자(카메라가 땅속으로 들어가지 않게). h[i * n + j] = 높이(x_i, z_j), x·z 는 -half ~ half */
  ground?: { half: number; n: number; h: number[] };
}

/** 굴뚝 연기: 부드러운 점들이 바람 따라 기울며 피어오른다 */
export class Smoke {
  readonly points: THREE.Points;
  private readonly mat: THREE.PointsMaterial;
  private readonly puffs: { age: number; life: number; dx: number; dz: number }[] = [];

  constructor(rng: Rng, count = 50, private readonly size = 1) {
    for (let i = 0; i < count; i++) this.puffs.push({ age: rng() * 3, life: 2.6 + rng() * 1.4, dx: rng() - 0.5, dz: rng() - 0.5 });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mat = new THREE.PointsMaterial({ map: softSprite(), size: 0.6 * size, transparent: true, opacity: 0.45, depthWrite: false, color: '#dcd8d0' });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  /** origin: 굴뚝 끝(부모 좌표) */
  update(dt: number, env: Env, origin: THREE.Vector3): void {
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const drift = (0.15 + env.wind * 0.6) * this.size;
    this.puffs.forEach((p, i) => {
      p.age = (p.age + dt) % p.life;
      const k = p.age / p.life;
      pos.setXYZ(i, origin.x + (p.dx * 0.3 * k + env.windX * drift * k * 1.3) * this.size, origin.y + k * 1.3 * this.size,
        origin.z + (p.dz * 0.3 * k + env.windZ * drift * k * 1.3) * this.size);
    });
    pos.needsUpdate = true;
    // 밤에는 어둡게
    this.mat.color.set('#dcd8d0').multiplyScalar(waterBrightness(env));
    this.mat.opacity = 0.45 * (1 - env.rain * 0.5);
  }
}

export abstract class Diorama implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'ground' as const;
  readonly baked = true;
  readonly view: { target: THREE.Vector3; distance: number };
  protected readonly sway = new Sway();
  private readonly water = riverMaterial();
  private readonly falls: Waterfall[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly seasonal: [THREE.MeshStandardMaterial, (env: Env, out: THREE.Color) => void][] = [];
  private readonly glass: THREE.MeshStandardMaterial[] = [];
  private flowers: THREE.Object3D[] = [];
  private smoke?: { fx: Smoke; at: THREE.Vector3 };
  private ground?: Layout['ground'];

  constructor(rng: Rng, name: string, distance: number) {
    this.view = { target: new THREE.Vector3(0, 0.6, 0), distance };
    loadModel(`models/${name}.glb`, (root) => {
      // 먼 풍경은 라이트맵 자리가 없으므로 재질을 따로 둔다(가운데 땅과 같은 재질을 쓰면 라이트맵 엉뚱한 곳을 읽는다)
      const far = new Map<THREE.Material, THREE.MeshStandardMaterial>();
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh || !o.name.startsWith('far_')) return;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (!far.has(m)) far.set(m, m.clone());
        mesh.material = far.get(m)!;
      });
      for (const m of far.values()) applyOpenSky(m);
      trackMaterials(root, this.seasonal, this.glass);
      // 그림자 범위 밖 먼 풍경과 먼 땅은 그림자를 드리우지 않는다(그림자 그리기 비용을 아낀다)
      root.traverse((o) => {
        if (o.name.startsWith('far_ground') || o.name.includes('distant')) o.castShadow = false;
      });
      const movers: THREE.Object3D[] = [];
      root.traverse((o) => {
        if (o.name.startsWith('tree_')) this.sway.add(o, rng);
        if (o.name.startsWith('flowers_')) this.flowers.push(o);
        // 재질이 여럿인 물체는 이름이 같은 묶음 + 부품(mover_x_1 …)으로 들어온다. 묶음만 움직인다
        if (o.name.startsWith('mover_') && !o.parent?.name.startsWith('mover_')) movers.push(o);
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && o.name.startsWith('liquid_')) {
          mesh.material = this.water;
          mesh.castShadow = false;
        }
      });
      applyLightmap(root, `models/${name}_light.webp`);
      const raw = root.getObjectByName('layout')?.userData.layout;
      const layout = (raw ? JSON.parse(raw) : {}) as Layout;
      for (const f of layout.falls ?? []) {
        const wf = new Waterfall({ ...f, origin: new THREE.Vector3(...f.origin), outward: new THREE.Vector3(...f.outward) }, rng, 120);
        this.falls.push(wf);
        this.group.add(wf.group);
      }
      // 밤에 고이는 따뜻한 불빛
      for (const [x, y, z] of layout.lights ?? []) {
        const light = new THREE.PointLight('#ffc46b', 0, 4.5, 2);
        light.position.set(x, y, z);
        this.group.add(light);
        this.lights.push(light);
      }
      this.ground = layout.ground;
      if (layout.smoke) {
        this.smoke = { fx: new Smoke(rng, 60, 1.4), at: new THREE.Vector3(...layout.smoke) };
        this.group.add(this.smoke.fx.points);
      }
      this.group.add(root);
      this.onLoad(root, layout, movers);
    });
  }

  /** 모델을 다 불러온 뒤 한 번(움직이는 것 준비) */
  protected onLoad(_root: THREE.Object3D, _layout: Layout, _movers: THREE.Object3D[]): void {}

  /** 프레임마다(움직이는 것) */
  protected tick(_dt: number, _t: number, _env: Env): void {}

  update(dt: number, t: number, env: Env): void {
    for (const l of this.lights) l.intensity = env.nightLights * 3.5;
    for (const [m, fn] of this.seasonal) fn(env, m.color);
    for (const m of this.glass) m.emissiveIntensity = 0.15 + env.nightLights * 2.6;
    const bright = waterBrightness(env);
    this.water.uniforms.time.value = t;
    this.water.uniforms.bright.value = bright;
    for (const f of this.falls) f.update(dt, t, bright);
    this.sway.update(dt, env);
    for (const f of this.flowers) f.visible = env.snowCover < 0.6;
    this.smoke?.fx.update(dt, env, this.smoke.at);
    this.tick(dt, t, env);
  }

  groundHeight(x: number, z: number): number {
    const g = this.ground;
    if (!g) return 0;
    const f = (v: number) => THREE.MathUtils.clamp(((v + g.half) / (2 * g.half)) * (g.n - 1), 0, g.n - 1.001);
    const fx = f(x);
    const fz = f(z);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const a = fx - i;
    const b = fz - j;
    const h = (ii: number, jj: number) => g.h[ii * g.n + jj];
    return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b;
  }
}

/** 점들을 잇는 닫힌(또는 열린) 길 */
export function pathCurve(points: [number, number, number][], closed: boolean): THREE.CatmullRomCurve3 {
  return new THREE.CatmullRomCurve3(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)), closed, 'centripetal');
}
