import * as THREE from 'three';
import type { Rng } from '../util';
import { Diorama, type Layout } from './diorama';

/**
 * 숲 테마: 숲속 호숫가 통나무집 디오라마(모델: tools/blender/forest.py).
 * 뒤쪽 바위 언덕과 전나무 숲, 개울이 흘러드는 호수, 들꽃 풀밭의 사슴·토끼, 선착장과 카누, 모닥불과 텐트.
 */
export class Forest extends Diorama {
  private readonly rabbits: { obj: THREE.Object3D; z: number; phase: number }[] = [];

  constructor(rng: Rng) {
    super(rng, 'forest', 30);
  }

  protected onLoad(_root: THREE.Object3D, _layout: Layout, movers: THREE.Object3D[]): void {
    for (const [k, m] of movers.filter((m) => m.name.startsWith('mover_rabbit')).entries()) {
      this.rabbits.push({ obj: m, z: m.position.y, phase: k * 1.7 });
    }
  }

  protected tick(_dt: number, t: number): void {
    // 토끼: 몇 초에 한 번 두세 번 깡충 뛰고 쉰다
    for (const r of this.rabbits) {
      const c = (t * 0.8 + r.phase) % 4;
      const hop = c < 1.5 ? Math.abs(Math.sin(c * Math.PI * 2)) : 0;
      r.obj.position.y = r.z + hop * 0.12;
    }
  }
}
