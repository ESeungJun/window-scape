import * as THREE from 'three';
import type { Rng } from '../util';
import { Diorama, pathCurve, type Layout } from './diorama';

/**
 * 도시 테마: 피렌체를 모티브로 한 강변 옛 도시 디오라마(모델: tools/blender/city.py).
 * 가게가 얹힌 옛 다리, 붉은 돔 성당과 종탑, 탑이 선 시청 궁전과 광장, 강을 따라 늘어선 팔라초.
 * 자동차들이 강을 두 번 건너는 순환 도로를 오른쪽 차선으로 돌고, 나룻배 한 척이 강을 오르내린다.
 * 강변 대관람차가 천천히 돌고, 곤돌라는 늘 아래로 매달린다.
 */
const LANE = 0.27;

interface Car {
  obj: THREE.Object3D;
  u: number;
  /** +1: 길 방향, -1: 반대 방향 */
  dir: 1 | -1;
  speed: number;
}

export class City extends Diorama {
  private readonly cars: Car[] = [];
  private ring?: THREE.CatmullRomCurve3;
  private river?: THREE.CatmullRomCurve3;
  private boat?: THREE.Object3D;
  private boatU = 0.2;
  private boatDir = 1;
  private wheel?: THREE.Object3D;
  /** 바퀴 축(바퀴의 로컬 x, 카메라 쪽을 본다)과 곤돌라의 처음 자리(축에서 본 거리) */
  private readonly axis = new THREE.Vector3(1, 0, 0);
  private readonly gondolas: { obj: THREE.Object3D; from: THREE.Vector3 }[] = [];
  private spin = 0;
  private readonly p = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();

  constructor(rng: Rng) {
    super(rng, 'city', 30);
  }

  protected onLoad(_root: THREE.Object3D, layout: Layout, movers: THREE.Object3D[]): void {
    if (!layout.paths) return;
    this.ring = pathCurve(layout.paths.ring, true);
    this.river = pathCurve(layout.paths.river, false);
    let k = 0;
    for (const m of movers) {
      if (m.name.startsWith('mover_car')) {
        // 같은 차선끼리는 같은 속도라 겹치지 않는다
        const dir = k % 2 ? 1 : -1;
        this.cars.push({ obj: m, u: k * 0.27, dir, speed: 0.75 });
        k++;
      } else if (m.name === 'mover_boat') this.boat = m;
      else if (m.name === 'mover_wheel') this.wheel = m;
    }
    if (this.wheel) {
      this.axis.applyQuaternion(this.wheel.quaternion);
      for (const m of movers.filter((m) => m.name.startsWith('mover_gondola'))) {
        this.gondolas.push({ obj: m, from: m.position.clone().sub(this.wheel.position) });
      }
    }
  }

  protected tick(dt: number): void {
    const { p, tan } = this;
    if (this.wheel) {
      const step = dt * 0.12;
      this.spin += step;
      this.wheel.rotateOnWorldAxis(this.axis, step);
      // 곤돌라는 바퀴와 같은 각도만큼 축을 돈 자리로 옮기기만 한다(돌리지 않아 늘 아래로 매달린다)
      for (const g of this.gondolas) g.obj.position.copy(g.from).applyAxisAngle(this.axis, this.spin).add(this.wheel.position);
    }
    if (this.ring) {
      const len = this.ring.getLength();
      for (const c of this.cars) {
        c.u = (c.u + (c.dir * c.speed * dt) / len + 1) % 1;
        this.ring.getPointAt(c.u, p);
        this.ring.getTangentAt(c.u, tan).multiplyScalar(c.dir);
        // 진행 방향의 오른쪽 차선
        c.obj.position.set(p.x - tan.z * LANE, p.y, p.z + tan.x * LANE);
        c.obj.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      }
    }
    if (this.river && this.boat) {
      // 강 끝에 닿으면 돌아선다
      this.boatU += (this.boatDir * 0.22 * dt) / this.river.getLength();
      if (this.boatU > 0.93 || this.boatU < 0.07) {
        this.boatDir = -this.boatDir;
        this.boatU = THREE.MathUtils.clamp(this.boatU, 0.07, 0.93);
      }
      this.river.getPointAt(this.boatU, p);
      this.river.getTangentAt(this.boatU, tan).multiplyScalar(this.boatDir);
      this.boat.position.copy(p);
      this.boat.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
    }
  }
}
