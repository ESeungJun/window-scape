import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { Diorama, Smoke, pathCurve, type Layout } from './diorama';

/**
 * 움직이는 성 테마: 초원 디오라마(모델: tools/blender/castle.py). 구리 선체 위에 돌 탑과 반목조 오두막을 얹은 성이
 * 새 다리 넷으로 지평선까지 트인 초원을 걷는다. 길은 농장 둘레 밭 사이를 크게 돌고 앞쪽에서는 연못 가까이까지 들어오며,
 * 카메라가 성 쪽으로 반쯤 따라간다. 탑 꼭대기 프로펠러가 바람 따라 돌고 굴뚝에서 연기가 오른다.
 * 특정 작품의 디자인을 옮기지 않고 '걷는 성'이라는 발상만 빌린 독자 디자인이다.
 */
const WALK_SPEED = 0.5;
/** 카메라가 성 쪽으로 다가가는 정도(0 = 가운데 농장, 1 = 성) */
const FOLLOW = 0.55;

interface Leg {
  upper: THREE.Object3D;
  lower: THREE.Object3D;
  phase: number;
}

export class MovingCastle extends Diorama {
  private loop?: THREE.CatmullRomCurve3;
  private castle?: THREE.Object3D;
  private body?: THREE.Object3D;
  private prop?: THREE.Object3D;
  private chimney?: THREE.Object3D;
  private readonly legs: Leg[] = [];
  private readonly smokeFx: Smoke;
  private readonly smokeAt = new THREE.Vector3();
  private bodyY = 0;
  private u = 0.25;
  private stride = 0;
  private readonly p = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();

  constructor(rng: Rng) {
    super(rng, 'castle', 30);
    this.smokeFx = new Smoke(rng, 60, 1.3);
    this.group.add(this.smokeFx.points);
  }

  protected onLoad(root: THREE.Object3D, layout: Layout, movers: THREE.Object3D[]): void {
    if (!layout.paths) return;
    this.loop = pathCurve(layout.paths.loop, true);
    this.castle = movers.find((m) => m.name === 'mover_castle');
    this.body = root.getObjectByName('castle_body');
    this.prop = root.getObjectByName('castle_prop');
    this.chimney = root.getObjectByName('castle_smoke');
    if (this.body) this.bodyY = this.body.position.y;
    // 대각선 다리끼리 같은 박자(앞오른쪽·뒤왼쪽 / 앞왼쪽·뒤오른쪽)
    [0, Math.PI, Math.PI, 0].forEach((phase, k) => {
      const upper = root.getObjectByName(`leg_${k}_upper`);
      const lower = root.getObjectByName(`leg_${k}_lower`);
      if (upper && lower) this.legs.push({ upper, lower, phase });
    });
  }

  focus(out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.view.target);
    if (this.castle) out.lerp(this.castle.position, FOLLOW);
    return out;
  }

  protected tick(dt: number, _t: number, env: Env): void {
    if (!this.loop || !this.castle) return;
    const speed = WALK_SPEED * (1 - 0.3 * Math.max(env.rain, env.snow));
    this.u = (this.u + (dt * speed) / this.loop.getLength()) % 1;
    this.stride += dt * speed * 6;
    this.loop.getPointAt(this.u, this.p);
    this.loop.getTangentAt(this.u, this.tan);
    this.castle.position.copy(this.p);
    this.castle.rotation.set(0, Math.atan2(-this.tan.z, this.tan.x), 0);
    for (const leg of this.legs) {
      const s = this.stride + leg.phase;
      leg.upper.rotation.z = Math.sin(s) * 0.35;
      leg.lower.rotation.z = -Math.max(0, Math.cos(s)) * 0.6;
    }
    if (this.body) {
      this.body.position.y = this.bodyY + Math.abs(Math.sin(this.stride)) * 0.04;
      this.body.rotation.x = Math.sin(this.stride) * 0.025;
    }
    this.prop?.rotateZ(-dt * (0.6 + env.wind * 4));
    if (this.chimney) {
      // getWorldPosition 이 굴뚝의 조상(성·무리)만 갱신한다. 장면 전체를 다시 계산하지 않는다
      this.group.worldToLocal(this.chimney.getWorldPosition(this.smokeAt));
      this.smokeFx.update(dt, env, this.smokeAt);
    }
  }
}
