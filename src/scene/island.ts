import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { applyLightmap } from './baked';
import { gltfLoader, trackMaterials } from './props';
import {
  FLOATING_VIEW, Sway, TOP, Waterfall, addVines, fallAt, islandBob, riverMesh, rimPoint, waterBrightness, type Stage,
} from './kit';

/**
 * 하늘섬 테마. 섬 바닥·나무·집·풍차·등대·양 같은 모양은 Blender 에서 직접 모델링한 public/models/island.glb
 * (만드는 법: tools/blender/island.py)이고, 여기서는 그 위에 흐르는 강과 폭포, 풍차 날개, 나무 흔들림,
 * 계절 색과 밤 창문 불빛만 입힌다. 빛은 Blender 에서 구운 라이트맵(island_light.webp)에 하늘빛을 곱해 쓴다.
 */
const FALL_ANGLE = 0.42;
const SPRING_FALL_ANGLE = 2.25;

export class Island implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'floating' as const;
  readonly view = FLOATING_VIEW;
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
    const edge = rimPoint(FALL_ANGLE);
    const river = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.4, TOP, 0.3),
      new THREE.Vector3(0.9, TOP, 0.9),
      new THREE.Vector3(2.3, TOP, 0.6),
      new THREE.Vector3(3.6, TOP, 1.4),
      edge.clone().multiplyScalar(0.9).setY(TOP),
      edge.clone(),
    ]);
    const rm = riverMesh(river, 0.72);
    this.river = rm.mat;
    g.add(rm.mesh);

    // 폭포: 강 끝의 큰 폭포 + 반대편 흙벽에서 나오는 작은 폭포
    const springFall = fallAt(SPRING_FALL_ANGLE, { width: 0.32, length: 11, reach: 0.7, y: -0.55, inset: 0.99 });
    for (const f of [fallAt(FALL_ANGLE, { width: 0.72, length: 15, reach: 1.4 }), springFall]) {
      const wf = new Waterfall(f, rng, f === springFall ? 0 : 150);
      this.falls.push(wf);
      g.add(wf.group);
    }

    // 밤에 고이는 따뜻한 불빛: 집 두 채 앞과 모닥불(모델의 자리, Blender (x, y) = 여기 (x, -z))
    for (const [x, z, y] of [[1.9, -2.6, 1.0], [-1.4, 2.6, 1.0], [1.35, 3.35, 0.5]]) {
      const light = new THREE.PointLight('#ffc46b', 0, 4, 2);
      light.position.set(x, y, z);
      g.add(light);
      this.lights.push(light);
    }

    addVines(g, rng, this.sway, [FALL_ANGLE, SPRING_FALL_ANGLE]);
  }

  update(dt: number, t: number, env: Env): void {
    for (const l of this.lights) l.intensity = env.nightLights * 6;
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
