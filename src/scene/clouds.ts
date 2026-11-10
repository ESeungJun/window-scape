import * as THREE from 'three';
import type { Env } from './env';
import { smoothstep, type Rng } from '../util';

interface SkyCloud {
  /** 이 구름을 이루는 덩이들의 자리(구름 기준) */
  puffs: THREE.Matrix4[];
  /** instanceMatrix 에서 이 구름이 차지하는 첫 칸 */
  first: number;
  y: number;
  threshold: number;
  base: number;
  angle: number;
  radius: number;
  speed: number;
}

const WHITE = new THREE.Color('#ffffff');
const STORM_GREY = new THREE.Color('#596170');
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * 섬 주변을 도는 구름과 섬 아래 깔린 구름바다.
 * 구름 양(cloudCover)이 늘면 구름이 하나씩 부풀어 나타난다. 투명도를 쓰지 않아 정렬 문제가 없다.
 * 덩이는 낱개 메시가 아니라 인스턴스로 그린다(하늘 구름 한 번, 구름바다 한 번).
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly sky: SkyCloud[] = [];
  private readonly seaMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  private readonly skyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
  private readonly sea: THREE.InstancedMesh;
  private readonly skyMesh: THREE.InstancedMesh;
  /** 섬 주변을 도는 구름 묶음. 땅 테마에서는 높이 띄운다 */
  private readonly skyLayer = new THREE.Group();
  private readonly cloudMatrix = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly pos = new THREE.Vector3();
  private readonly quat = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);

  constructor(rng: Rng) {
    const count = 18;
    let total = 0;
    for (let i = 0; i < count; i++) {
      const n = 4 + Math.floor(rng() * 4);
      const puffs: THREE.Matrix4[] = [];
      for (let j = 0; j < n; j++) {
        const s = 0.7 + rng() * 0.7;
        const p = new THREE.Vector3((j / (n - 1) - 0.5) * 3.2 + (rng() - 0.5) * 0.6, rng() * 0.5, (rng() - 0.5) * 1.2);
        puffs.push(new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s * 0.8, s)));
      }
      this.sky.push({
        puffs,
        first: total,
        y: 11 + rng() * 5,
        threshold: (i + 0.5) / count,
        base: 0.8 + rng() * 0.9,
        angle: rng() * Math.PI * 2,
        radius: 7 + rng() * 8,
        speed: 0.6 + rng() * 0.8,
      });
      total += n;
    }
    this.skyMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 3), this.skyMat, total);
    this.skyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // 구름마다 자리가 계속 바뀌므로 묶음 전체의 경계를 다시 계산하지 않고 늘 그린다
    this.skyMesh.frustumCulled = false;
    for (let i = 0; i < total; i++) this.skyMesh.setMatrixAt(i, HIDDEN);
    this.skyLayer.add(this.skyMesh);

    // 구름바다는 멀리 깔려 윤곽만 보이므로 한 단계 거친 공을 쓴다
    const seaCount = 110;
    this.sea = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), this.seaMat, seaCount);
    for (let i = 0; i < seaCount; i++) {
      const a = rng() * Math.PI * 2;
      const r = 3 + Math.sqrt(rng()) * 60;
      const s = 2 + rng() * 3.5;
      this.pos.set(Math.cos(a) * r, -13.5 + rng() * 1.6, Math.sin(a) * r);
      this.sea.setMatrixAt(i, this.m.compose(this.pos, this.quat.identity(), this.scale.set(s, s * (0.35 + rng() * 0.2), s)));
    }
    this.sea.instanceMatrix.needsUpdate = true;
    this.sea.computeBoundingSphere();
    this.sea.receiveShadow = true;
    this.group.add(this.sea, this.skyLayer);
  }

  /** 섬 아래 구름바다. 땅에 붙은 테마에서는 숨긴다 */
  setSea(visible: boolean, scale = 1): void {
    this.sea.visible = visible;
    // 땅 테마에서는 언덕에 걸리지 않게 하늘 구름을 띄운다. 큰 섬(scale > 1)은 카메라가 높고 멀어서 구름도 넓고 높게
    this.skyLayer.scale.setScalar(scale);
    this.skyLayer.position.y = visible ? (scale - 1) * 20 : 5;
  }

  /**
   * @param castShadow 구름이 그림자 맵에 그림자를 드리울지. 구름 그늘을 셰이더로 그릴 때는 끈다(baked.ts)
   */
  update(dt: number, env: Env, blueSea = false, castShadow = false): void {
    this.skyMat.color.copy(WHITE).lerp(STORM_GREY, env.cloudDark);
    // 밤·뇌우에 구름이 검은 덩어리가 되지 않게 하늘빛을 조금 머금는다
    this.skyMat.emissive.copy(env.skyBottom).multiplyScalar(0.16 * env.nightLights);
    this.skyMesh.castShadow = castShadow;
    for (const c of this.sky) {
      const vis = smoothstep(c.threshold - 0.12, c.threshold + 0.12, env.cloudCover);
      c.angle += dt * c.speed * (0.012 + env.wind * 0.07);
      if (vis <= 0.01) {
        for (let j = 0; j < c.puffs.length; j++) this.skyMesh.setMatrixAt(c.first + j, HIDDEN);
        continue;
      }
      this.pos.set(Math.cos(c.angle) * c.radius, c.y, Math.sin(c.angle) * c.radius);
      this.quat.setFromAxisAngle(Clouds.UP, -c.angle);
      this.cloudMatrix.compose(this.pos, this.quat, this.scale.setScalar(c.base * (0.25 + 0.75 * vis)));
      for (let j = 0; j < c.puffs.length; j++) this.skyMesh.setMatrixAt(c.first + j, this.m.multiplyMatrices(this.cloudMatrix, c.puffs[j]));
    }
    this.skyMesh.instanceMatrix.needsUpdate = true;
    this.seaMat.color.copy(WHITE).lerp(STORM_GREY, env.cloudDark * 0.55);
    if (blueSea) this.seaMat.color.lerp(env.skyTop, 0.6);
    this.sea.rotation.y += dt * (0.004 + env.wind * 0.012);
  }
}
