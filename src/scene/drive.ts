import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { Diorama, TILE_HALF, pathCurve, type Layout } from './diorama';

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
  /** 받침 안에 드는 도로 구간(길이 단위). 디오라마 모양에서 차가 이 구간을 U턴하며 돈다 */
  private span: [number, number] = [0, 0];
  private loopU = 0;
  private readonly p = new THREE.Vector3();
  private readonly tan = new THREE.Vector3();
  private readonly q = new THREE.Vector3();

  constructor(rng: Rng) {
    super(rng, 'drive', 30);
  }

  protected onLoad(_root: THREE.Object3D, layout: Layout, movers: THREE.Object3D[]): void {
    if (!layout.paths) return;
    this.road = pathCurve(layout.paths.road, false);
    this.sea = pathCurve(layout.paths.sea, true);
    // 길을 잘게 따라가며 받침 안(가장자리에서 조금 안쪽)에 드는 처음과 끝
    const len = this.road.getLength();
    const ins: number[] = [];
    for (let i = 0; i <= 400; i++) {
      this.road.getPointAt(i / 400, this.p);
      if (Math.max(Math.abs(this.p.x), Math.abs(this.p.z)) < TILE_HALF - 0.6) ins.push((i / 400) * len);
    }
    if (ins.length) this.span = [ins[0], ins[ins.length - 1]];
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
      if (this.cased) this.loopCars(dt);
      else this.runCars(dt);
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

  /** 지평선 모양: 차로마다 길 끝(안개 속)까지 달리고 처음(반대편 안개 속)으로 돌아간다 */
  private runCars(dt: number): void {
    const road = this.road!;
    const { p, tan } = this;
    const len = road.getLength();
    for (const c of this.cars) {
      // 순간이동이 보이지 않게 길 끝 가까이에서 작아졌다 커진다
      c.u = (c.u + (c.speed * dt) / len) % 1;
      const u = c.dir > 0 ? c.u : 1 - c.u;
      road.getPointAt(u, p);
      road.getTangentAt(u, tan).multiplyScalar(c.dir);
      c.obj.position.set(p.x - tan.z * LANE, p.y, p.z + tan.x * LANE);
      c.obj.rotation.set(0, Math.atan2(-tan.z, tan.x), 0);
      c.obj.scale.setScalar(THREE.MathUtils.clamp((Math.min(u, 1 - u) * len) / 4, 0, 1));
    }
  }

  /**
   * 디오라마 모양: 받침 안 구간을 한 바퀴 도는 길(한 차로로 가서 끝에서 U턴해 다른 차로로 돌아온다).
   * 모든 차가 같은 속도로 같은 고리를 돌아 서로 겹치지 않고, 받침 밖으로 나가지 않는다
   */
  private loopCars(dt: number): void {
    const [a, b] = this.span;
    const r = LANE;
    const straight = Math.max(0, b - a - 2 * r);
    const loop = 2 * straight + 2 * Math.PI * r;
    const n = this.cars.length;
    // 한 박자를 같이 쓰고 차마다 고리 길이의 1/n 씩 벌린다
    this.loopU = (this.loopU + (2.2 * dt) / loop) % 1;
    this.cars.forEach((c, k) => {
      const s = (this.loopU + k / n) % 1;
      this.loopAt(s * loop, straight, this.p);
      this.loopAt(s * loop + 0.05, straight, this.q);
      c.obj.position.copy(this.p);
      c.obj.rotation.set(0, Math.atan2(-(this.q.z - this.p.z), this.q.x - this.p.x), 0);
      c.obj.scale.setScalar(1);
    });
  }

  /** 고리 위 거리 d 의 자리(길 위 거리 + 옆으로 비킨 만큼을 세계 좌표로) */
  private loopAt(d: number, straight: number, out: THREE.Vector3): THREE.Vector3 {
    const road = this.road!;
    const [a] = this.span;
    const r = LANE;
    const turn = Math.PI * r;
    d %= 2 * straight + 2 * turn;
    let along: number;
    let side: number;
    if (d < straight) [along, side] = [a + r + d, r];
    else if (d < straight + turn) {
      const f = (d - straight) / r;
      [along, side] = [a + r + straight + r * Math.sin(f), r * Math.cos(f)];
    } else if (d < 2 * straight + turn) [along, side] = [a + r + straight - (d - straight - turn), -r];
    else {
      const f = (d - 2 * straight - turn) / r;
      [along, side] = [a + r - r * Math.sin(f), -r * Math.cos(f)];
    }
    const u = THREE.MathUtils.clamp(along / road.getLength(), 0, 1);
    road.getPointAt(u, out);
    road.getTangentAt(u, this.tan);
    return out.set(out.x - this.tan.z * side, out.y, out.z + this.tan.x * side);
  }
}
