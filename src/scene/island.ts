import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { applyLightmap } from './baked';
import { loadModel, trackMaterials } from './props';
import {
  FLOATING_VIEW, R, Sway, TOP, Waterfall, addVines, fallAt, islandBob, riverMesh, rimPoint, waterBrightness, type Stage,
} from './kit';

/**
 * 하늘섬 테마. 섬 바닥·나무·집·풍차·등대·양 같은 모양은 Blender 에서 직접 모델링한 public/models/island.glb
 * (만드는 법: tools/blender/island.py)이고, 여기서는 그 위에 흐르는 강과 폭포, 풍차 날개, 나무 흔들림,
 * 계절 색과 밤 창문 불빛만 입힌다. 빛은 Blender 에서 구운 라이트맵(island_light.webp)에 하늘빛을 곱해 쓴다.
 */
const FALL_ANGLE = 0.42;
const SPRING_FALL_ANGLE = 2.25;
/** 이 섬은 kit 의 기본 섬 반지름 R 보다 1.5 배 넓다(Blender lib.R = 9) */
const RS = 1.5;

/** 모델과 함께 오는 자리(tools/blender/island.py 의 layout). 좌표는 앱 좌표(x, y, z) */
interface Layout {
  river: [number, number, number][];
  lake: { center: [number, number, number]; rx: number; ry: number; rot: number };
  lights: [number, number, number][];
}

export class Island implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'floating' as const;
  readonly view = { target: FLOATING_VIEW.target, distance: 30 };
  readonly baked = true;
  private readonly sway = new Sway();
  private river?: THREE.ShaderMaterial;
  private readonly falls: Waterfall[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly seasonal: [THREE.MeshStandardMaterial, (env: Env, out: THREE.Color) => void][] = [];
  private readonly glass: THREE.MeshStandardMaterial[] = [];
  private flowers: THREE.Object3D[] = [];
  private mill?: THREE.Object3D;
  private hub?: THREE.Object3D;
  /** 날개 회전축(날개 물체 기준) */
  private readonly hubAxis = new THREE.Vector3();

  constructor(rng: Rng) {
    const g = this.group;

    loadModel('models/island.glb', (root) => {
      trackMaterials(root, this.seasonal, this.glass);
      applyLightmap(root, 'models/island_light.webp');
      root.traverse((o) => {
        if (o.name.startsWith('tree_')) this.sway.add(o, rng);
      });
      this.flowers = root.children.filter((o) => o.name.startsWith('flowers_'));
      this.mill = root.getObjectByName('mill_body');
      this.hub = root.getObjectByName('mill_hub');
      // 날개는 풍차 몸체의 앞(+z) 방향 축으로 돈다
      if (this.hub) this.hubAxis.set(0, 0, 1).applyQuaternion(this.hub.quaternion.clone().invert());
      const layout = root.getObjectByName('layout')?.userData.layout;
      if (layout) this.addLayout(JSON.parse(layout) as Layout);
      g.add(root);
    });

    // 폭포: 강 끝의 큰 폭포 + 반대편 흙벽에서 나오는 작은 폭포
    const springFall = fallAt(SPRING_FALL_ANGLE, { width: 0.32, length: 12, reach: 0.7, y: -0.55, inset: 0.99 * RS });
    for (const f of [fallAt(FALL_ANGLE, { width: 0.72, length: 17, reach: 1.4, inset: RS }), springFall]) {
      const wf = new Waterfall(f, rng, f === springFall ? 0 : 150);
      this.falls.push(wf);
      g.add(wf.group);
    }

    addVines(g, rng, this.sway, [FALL_ANGLE, SPRING_FALL_ANGLE], 34, R * RS);
  }

  /** 모델이 알려 준 자리에 강·호수·밤 불빛을 놓는다 */
  private addLayout(layout: Layout): void {
    const g = this.group;
    // 강: 샘에서 호수를 지나 가장자리 폭포까지
    const edge = rimPoint(FALL_ANGLE, RS);
    const river = new THREE.CatmullRomCurve3([
      ...layout.river.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
      edge.clone().multiplyScalar(0.9).setY(TOP),
      edge.clone(),
    ]);
    const rm = riverMesh(river, 0.72);
    this.river = rm.mat;
    g.add(rm.mesh);

    // 호수: 강물 재질을 쓰되 폭 방향(vUv.x)을 중심에서 둘레까지로 줘 물가가 밝게.
    // 원을 Blender 평면(x, y)에서 늘이고 돌린 뒤 눕힌다(Blender (x, y) = 앱 (x, -z))
    const { center, rx, ry, rot } = layout.lake;
    const lakeGeo = new THREE.CircleGeometry(1, 48);
    const lp = lakeGeo.getAttribute('position');
    const luv = lakeGeo.getAttribute('uv');
    for (let i = 0; i < lp.count; i++) {
      luv.setXY(i, 0.5 + 0.5 * Math.hypot(lp.getX(i), lp.getY(i)), (lp.getX(i) * rx + lp.getY(i) * ry) * 0.3);
    }
    lakeGeo.scale(rx, ry, 1).rotateZ(rot).rotateX(-Math.PI / 2).translate(center[0], TOP + 0.03, center[2]);
    const lake = new THREE.Mesh(lakeGeo, this.river);
    lake.receiveShadow = true;
    g.add(lake);

    // 밤에 고이는 따뜻한 불빛
    for (const [x, y, z] of layout.lights) {
      const light = new THREE.PointLight('#ffc46b', 0, 4.5, 2);
      light.position.set(x, y, z);
      g.add(light);
      this.lights.push(light);
    }
  }

  update(dt: number, t: number, env: Env): void {
    for (const l of this.lights) l.intensity = env.nightLights * 3.5;
    for (const [m, fn] of this.seasonal) fn(env, m.color);
    for (const m of this.glass) m.emissiveIntensity = 0.15 + env.nightLights * 2.6;
    const bright = waterBrightness(env);
    if (this.river) {
      this.river.uniforms.time.value = t;
      this.river.uniforms.bright.value = bright;
    }
    for (const f of this.falls) f.update(dt, t, bright);

    if (this.hub) this.hub.rotateOnAxis(this.hubAxis, -dt * (0.35 + env.wind * 2.8));
    // 날개(+z 쪽)가 바람이 불어오는 쪽을 보도록 천천히 돌아선다
    if (this.mill && Math.hypot(env.windX, env.windZ) > 0.1) {
      const want = Math.atan2(-env.windX, -env.windZ);
      const diff = Math.atan2(Math.sin(want - this.mill.rotation.y), Math.cos(want - this.mill.rotation.y));
      this.mill.rotation.y += diff * Math.min(1, dt * 0.4);
    }
    this.sway.update(dt, env);
    for (const f of this.flowers) f.visible = env.snowCover < 0.6;
    this.group.position.y = islandBob(t);
  }
}
