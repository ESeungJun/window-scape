import type { Rng } from '../util';
import { Diorama } from './diorama';

/**
 * 숲 테마: 숲속 호숫가 통나무집 디오라마(모델: tools/blender/forest.py).
 * 뒤쪽 바위 언덕과 전나무 숲, 개울이 흘러드는 호수, 가장자리 폭포, 선착장과 카누, 모닥불과 텐트.
 */
export class Forest extends Diorama {
  constructor(rng: Rng) {
    super(rng, 'forest', 30);
  }
}
