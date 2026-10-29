import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { Diorama, pathCurve, type Layout } from './diorama';

/**
 * 드라이브 테마: 바닷가 해안도로 디오라마(모델: tools/blender/drive.py).
 * 자동차가 지평선 끝까지 쭉 뻗은 2차로 해안도로를 달린다(양쪽 끝은 안개 속이라 끝에 닿으면 처음으로 돌아간다).
 * 모래사장과 바다, 바위섬 등대, 바다를 도는 돛단배, 바람 따라 도는 언덕 위 풍력 발전기.
 */
const LANE = 0.55;

interface Car {
  obj: THREE.Object3D;
  u: number;
  dir: 1 | -1;
  speed: number;
}

export class Drive extends Diorama {
  private readonly cars: Car[] = [];
  private readonly rotors: THREE.Object3D[] = [];
  private road?: THREE.CatmullRomCurve3;
  private sea?: THREE.CatmullRomCurve3;
  private sail?: THREE.Object3D;
  private sailU = 0;
  private readonly p = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();

  constructor(rng: Rng) {
    super(rng, 'drive', 30);
  }

  protected onLoad(_root: THREE.Object3D, layout: Layout, movers: THREE.Object3D[]): void {
    if (!layout.paths) return;
    this.road = pathCurve(layout.paths.road, false);
    this.sea = pathCurve(layout.paths.sea, true);
    let k = 0;
    for (const m of movers) {
      if (m.name.startsWith('mover_car')) {
        // 같은 차로는 같은 속도(서로 겹치지 않게)
        this.cars.push({ obj: m, u: Math.floor(k / 2) * 0.25 + (k % 2) * 0.11, dir: k % 2 ? -1 : 1, speed: k % 2 ? 2.2 : 2.6 });
        k++;
      } else if (m.name.startsWith('mover_rotor')) this.rotors.push(m);
      else if (m.name === 'mover_sailboat') this.sail = m;
    }
  }

  protected tick(dt: number, _t: number, env: Env): void {
    const { p, tan } = this;
    if (this.road) {
      const len = this.road.getLength();
      for (const c of this.cars) {
        // 끝(안개 속)에 닿으면 처음(반대편 안개 속)으로
        c.u = (c.u + (c.speed * dt) / len) % 1;
        const u = c.dir > 0 ? c.u : 1 - c.u;
        this.road.getPointAt(u, p);
        this.road.getTangentAt(u, tan).multiplyScalar(c.dir);
        c.obj.position.set(p.x - tan.z * LANE, p.y, p.z + tan.x * LANE);
        c.obj.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      }
    }
    if (this.sea && this.sail) {
      this.sailU = (this.sailU + (0.18 * dt) / this.sea.getLength()) % 1;
      this.sea.getPointAt(this.sailU, p);
      this.sea.getTangentAt(this.sailU, tan);
      this.sail.position.copy(p);
      // 바람에 살짝 기운다
      this.sail.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      this.sail.rotateX(0.04 + env.wind * 0.1);
    }
    for (const r of this.rotors) r.rotateZ(-dt * (0.4 + env.wind * 3));
  }
}
