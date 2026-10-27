import * as THREE from 'three';
import type { Env } from './env';
import { smoothstep, type Rng } from '../util';

interface SkyCloud {
  obj: THREE.Group;
  mat: THREE.MeshStandardMaterial;
  threshold: number;
  base: number;
  angle: number;
  radius: number;
  speed: number;
}

const WHITE = new THREE.Color('#ffffff');
const STORM_GREY = new THREE.Color('#596170');

/**
 * 섬 주변을 도는 구름과 섬 아래 깔린 구름바다.
 * 구름 양(cloudCover)이 늘면 구름이 하나씩 부풀어 나타난다. 투명도를 쓰지 않아 정렬 문제가 없다.
 */
export class Clouds {
  readonly group = new THREE.Group();
  private readonly sky: SkyCloud[] = [];
  private readonly sea = new THREE.Group();
  private readonly seaMat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });

  constructor(rng: Rng) {
    const puff = new THREE.IcosahedronGeometry(1, 1);
    const count = 18;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', flatShading: true, roughness: 1 });
      const cloud = new THREE.Group();
      const puffs = 4 + Math.floor(rng() * 4);
      for (let j = 0; j < puffs; j++) {
        const m = new THREE.Mesh(puff, mat);
        const s = 0.7 + rng() * 0.7;
        m.position.set((j / (puffs - 1) - 0.5) * 3.2 + (rng() - 0.5) * 0.6, rng() * 0.5, (rng() - 0.5) * 1.2);
        m.scale.set(s, s * 0.8, s);
        m.castShadow = true;
        cloud.add(m);
      }
      cloud.position.y = 6 + rng() * 7;
      this.group.add(cloud);
      this.sky.push({
        obj: cloud,
        mat,
        threshold: (i + 0.5) / count,
        base: 0.8 + rng() * 0.9,
        angle: rng() * Math.PI * 2,
        radius: 9 + rng() * 10,
        speed: 0.6 + rng() * 0.8,
      });
    }

    for (let i = 0; i < 110; i++) {
      const m = new THREE.Mesh(puff, this.seaMat);
      const a = rng() * Math.PI * 2;
      const r = 3 + Math.sqrt(rng()) * 60;
      m.position.set(Math.cos(a) * r, -13.5 + rng() * 1.6, Math.sin(a) * r);
      const s = 2 + rng() * 3.5;
      m.scale.set(s, s * (0.35 + rng() * 0.2), s);
      m.receiveShadow = true;
      this.sea.add(m);
    }
    this.group.add(this.sea);
  }

  update(dt: number, env: Env): void {
    const color = WHITE.clone().lerp(STORM_GREY, env.cloudDark);
    for (const c of this.sky) {
      const vis = smoothstep(c.threshold - 0.12, c.threshold + 0.12, env.cloudCover);
      c.obj.visible = vis > 0.01;
      c.obj.scale.setScalar(c.base * (0.25 + 0.75 * vis));
      c.mat.color.copy(color);
      c.angle += dt * c.speed * (0.012 + env.wind * 0.07);
      c.obj.position.x = Math.cos(c.angle) * c.radius;
      c.obj.position.z = Math.sin(c.angle) * c.radius;
      c.obj.rotation.y = -c.angle;
    }
    this.seaMat.color.copy(WHITE).lerp(STORM_GREY, env.cloudDark * 0.55);
    this.sea.rotation.y += dt * (0.004 + env.wind * 0.012);
  }
}
