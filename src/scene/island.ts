import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { applyLightmap } from './baked';
import { gltfLoader, trackMaterials } from './props';
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
/** 이 섬은 다른 떠 있는 테마(반지름 R)보다 1.5 배 넓다(Blender lib.R = 9) */
const RS = 1.5;
// 아래 자리들은 tools/blender/island.py 가 끝에 찍는 값(Blender (x, y) = 여기 (x, -z))
const RIVER: [number, number][] = [[-4.092, 3.851], [-1.452, 2.988], [-0.149, 1.071], [2.067, 0.232], [4.723, -0.349]];
const LAKE = { x: 4.723, y: -0.349, rx: 2.0, ry: 1.5, rot: 0.7266 };

export class Island implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'floating' as const;
  readonly view = { target: FLOATING_VIEW.target, distance: 30 };
  readonly baked = true;
  private readonly sway = new Sway();
  private readonly river: THREE.ShaderMaterial;
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

    gltfLoader.load('models/island.glb', (gltf) => {
      const root = gltf.scene;
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
      g.add(root);
    });

    // 강: 샘에서 가장자리 폭포까지(모델의 강바닥 경로와 같다)
    const edge = rimPoint(FALL_ANGLE, RS);
    const river = new THREE.CatmullRomCurve3([
      ...RIVER.map(([x, y]) => new THREE.Vector3(x, TOP, -y)),
      edge.clone().multiplyScalar(0.9).setY(TOP),
      edge.clone(),
    ]);
    const rm = riverMesh(river, 0.72);
    this.river = rm.mat;
    g.add(rm.mesh);

    // 호수: 강이 지나가는 앞쪽 타원 물. 강물 재질을 쓰되 폭 방향(vUv.x)을 중심에서 둘레까지로 줘 물가가 밝게
    const lakeGeo = new THREE.CircleGeometry(1, 48);
    const lp = lakeGeo.getAttribute('position');
    const luv = lakeGeo.getAttribute('uv');
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i) * LAKE.rx, y = lp.getY(i) * LAKE.ry;
      luv.setXY(i, 0.5 + 0.5 * Math.hypot(lp.getX(i), lp.getY(i)), (x + y) * 0.3);
    }
    lakeGeo.scale(LAKE.rx, LAKE.ry, 1).rotateZ(LAKE.rot).rotateX(-Math.PI / 2).translate(LAKE.x, TOP + 0.03, -LAKE.y);
    const lake = new THREE.Mesh(lakeGeo, this.river);
    lake.receiveShadow = true;
    g.add(lake);

    // 폭포: 강 끝의 큰 폭포 + 반대편 흙벽에서 나오는 작은 폭포
    const springFall = fallAt(SPRING_FALL_ANGLE, { width: 0.32, length: 12, reach: 0.7, y: -0.55, inset: 0.99 * RS });
    for (const f of [fallAt(FALL_ANGLE, { width: 0.72, length: 17, reach: 1.4, inset: RS }), springFall]) {
      const wf = new Waterfall(f, rng, f === springFall ? 0 : 150);
      this.falls.push(wf);
      g.add(wf.group);
    }

    // 밤에 고이는 따뜻한 불빛: 앞쪽 집 셋의 문 앞, 모닥불, 낚시 오두막(뒤쪽 집은 생략해 불빛 수를 아낀다)
    for (const [x, y, z] of [[-2.51, 1.0, 4.1], [0.19, 1.0, 5.18], [2.14, 1.0, 3.31], [4.33, 0.5, 3.37], [6.1, 1.1, -1.34]]) {
      const light = new THREE.PointLight('#ffc46b', 0, 4.5, 2);
      light.position.set(x, y, z);
      g.add(light);
      this.lights.push(light);
    }

    addVines(g, rng, this.sway, [FALL_ANGLE, SPRING_FALL_ANGLE], 34, R * RS);
  }

  update(dt: number, t: number, env: Env): void {
    for (const l of this.lights) l.intensity = env.nightLights * 3.5;
    for (const [m, fn] of this.seasonal) fn(env, m.color);
    for (const m of this.glass) m.emissiveIntensity = 0.15 + env.nightLights * 2.6;
    const bright = waterBrightness(env);
    this.river.uniforms.time.value = t;
    this.river.uniforms.bright.value = bright;
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
