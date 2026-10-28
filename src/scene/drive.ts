import * as THREE from 'three';
import type { Env } from './env';
import { jitter, smoothstep, type Rng } from '../util';
import {
  Field, MATS, Sway, alongCurve, distantMountains, house, instanced, lampPost, mesh, pasture, ribbon, rollingHills, scatterProps,
  scatterTrees, std, terrain, vehicle, village, type Stage,
} from './kit';

/**
 * 드라이브 테마: 해안도로. 바닷가 언덕을 따라 굽이치는 2차선 도로를 자동차들이 한가롭게 오간다.
 * 바다 쪽(+z)은 모래사장과 파도, 바위섬 위 등대, 먼바다의 돛단배. 육지 쪽(-z)은 숲 언덕과 설산.
 * 길 양 끝은 안개 너머라 차가 끝없이 이어진다.
 */
const ROAD_WIDTH = 1.0;
const LANE = 0.26;
const ROAD_HALF = 72;

/** 길이 지나는 z 위치. 해안선을 따라 완만하게 굽이친다 */
const roadZ = (x: number) => 3 * Math.sin(x * 0.08 + 0.5) + 1.5 * Math.sin(x * 0.19);
/** 길 높이: 바다 위 언덕을 오르내린다 */
const roadY = (x: number) => 1.5 + 0.9 * Math.sin(x * 0.11 + 1) + 0.5 * Math.sin(x * 0.27);
/** 길에서 모래사장 시작까지, 모래사장 너비 */
const beachFrom = (x: number) => 4.5 + 1.8 * Math.sin(x * 0.07 + 2);
const BEACH = 2.6;

function height(x: number, z: number): number {
  const d = z - roadZ(x); // + 바다 쪽, - 육지 쪽
  const ry = roadY(x) - 0.06;
  if (d < -1.2) {
    // 육지: 길에서 멀어질수록 숲 언덕이 솟는다
    return ry + smoothstep(1.2, 22, -d) * (4 + rollingHills(x, z, 1.5)) + rollingHills(x, z, 0.15);
  }
  if (d < 1.2) return ry;
  const b = beachFrom(x);
  // 길 → 모래사장으로 내려가는 비탈
  if (d < b) return THREE.MathUtils.lerp(ry, 0.08, smoothstep(1.2, b, d));
  if (d < b + BEACH) return 0.08 - (d - b) * 0.04;
  // 바닷속으로
  return -0.02 - (d - b - BEACH) * 0.35;
}

function roadCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let x = -ROAD_HALF; x <= ROAD_HALF; x += 3) pts.push(new THREE.Vector3(x, roadY(x), roadZ(x)));
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal');
}

const ASPHALT = std('#4a4d55', { flatShading: false, roughness: 0.85 });
const SHOULDER = std('#bfae8a');
const PAINT = std('#f4f0e2');
const RAIL = std('#e2e4e8', { metalness: 0.4, roughness: 0.5 });
const SAND = std('#e8d6a8');
const SEA = std('#5aa6cc', { flatShading: false, roughness: 0.3 });
const FOAM = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false });
const SEA_ROCK = std('#9c9c9e');
const WHITE = std('#f4f2ec');
const STRIPE = std('#c8463a');
const BEAM_LAMP = std('#fff3c4', { emissive: '#fff0b0', emissiveIntensity: 0.3 });

interface Car {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  light: THREE.SpotLight;
  u: number;
  /** +1: 길 방향, -1: 반대 방향(반대 차선) */
  dir: 1 | -1;
  speed: number;
}

export class Drive implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'ground' as const;
  readonly view = { target: new THREE.Vector3(0, 1.4, 2.5), distance: 24 };
  private readonly road = roadCurve();
  private readonly roadLength: number;
  private readonly cars: Car[] = [];
  private readonly sway = new Sway();
  private readonly foam: THREE.Mesh;
  private readonly beam: THREE.Group;
  private readonly boat: THREE.Group;
  private readonly side = new THREE.Vector3();
  private boatX = -40;

  constructor(rng: Rng) {
    const g = this.group;
    const field = new Field();
    this.roadLength = this.road.getLength();

    g.add(terrain(height));
    const sea = mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), SEA, false);
    sea.position.y = 0;
    g.add(sea);
    // 산은 육지 쪽(-z)에만
    g.add(distantMountains(rng, 50, 26, (a) => Math.sin(a) < -0.15));

    // 모래사장과 파도 거품: 해안선을 따라 까는 띠
    const shore = (offset: number) => new THREE.CatmullRomCurve3(
      Array.from({ length: 50 }, (_, i) => {
        const x = -ROAD_HALF + (i / 49) * ROAD_HALF * 2;
        return new THREE.Vector3(x, 0, roadZ(x) + beachFrom(x) + offset);
      }),
    );
    g.add(mesh(ribbon(shore(BEACH * 0.5), BEACH + 0.4, 300, 0.07), SAND, false));
    this.foam = new THREE.Mesh(ribbon(shore(BEACH + 0.25), 0.35, 300, 0.03), FOAM);
    g.add(this.foam);

    // 도로: 갓길 → 아스팔트 → 가운데 점선
    g.add(mesh(ribbon(this.road, ROAD_WIDTH + 0.3, 500, null, 0.02), SHOULDER, false));
    g.add(mesh(ribbon(this.road, ROAD_WIDTH, 500, null, 0.035), ASPHALT, false));
    const dashes = Math.floor(this.roadLength / 0.55);
    const dashSpots = Array.from({ length: dashes }, (_, i) => {
      const o = new THREE.Object3D();
      alongCurve(o, this.road, i / dashes, 0.045);
      return o;
    });
    g.add(instanced(new THREE.BoxGeometry(0.24, 0.01, 0.045), PAINT, dashSpots, false));
    field.blockCurve(this.road, ROAD_WIDTH * 0.5 + 0.8, 400);

    // 바다 쪽 가드레일, 육지 쪽 가로등
    const posts = 260;
    const out = new THREE.Vector3();
    const postSpots: THREE.Object3D[] = [];
    const railSpots: THREE.Object3D[] = [];
    for (let i = 0; i < posts; i++) {
      const u = i / posts;
      const p = this.road.getPointAt(u);
      const tan = this.road.getTangentAt(u);
      out.set(tan.z, 0, -tan.x).normalize();
      if (out.z < 0) out.negate();
      const x = p.x + out.x * (ROAD_WIDTH / 2 + 0.3);
      const z = p.z + out.z * (ROAD_WIDTH / 2 + 0.3);
      const post = new THREE.Object3D();
      post.position.set(x, p.y, z);
      postSpots.push(post);
      const rail = new THREE.Object3D();
      rail.position.set(x, p.y + 0.2, z);
      rail.rotation.y = Math.atan2(tan.x, tan.z);
      railSpots.push(rail);
      if (i % 14 === 7) {
        const lamp = lampPost();
        const lx = p.x - out.x * (ROAD_WIDTH / 2 + 0.25);
        const lz = p.z - out.z * (ROAD_WIDTH / 2 + 0.25);
        lamp.position.set(lx, p.y, lz);
        lamp.scale.setScalar(1.3);
        g.add(lamp);
      }
    }
    g.add(instanced(new THREE.BoxGeometry(0.05, 0.24, 0.05).translate(0, 0.12, 0), RAIL, postSpots));
    g.add(instanced(new THREE.BoxGeometry(0.03, 0.06, 0.6), RAIL, railSpots, false));

    // 바위섬 위 등대: 밤에는 불빛이 돈다
    const lhx = -13, lhz = roadZ(-13) + beachFrom(-13) + BEACH + 7;
    const islet = mesh(jitter(new THREE.IcosahedronGeometry(2.2, 1), 0.3).scale(1, 0.5, 1), SEA_ROCK);
    islet.position.set(lhx, 0.2, lhz);
    g.add(islet);
    const lighthouse = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      lighthouse.add(mesh(new THREE.CylinderGeometry(0.34 - k * 0.04, 0.38 - k * 0.04, 0.5, 10).translate(0, 0.25 + k * 0.5, 0), k % 2 ? STRIPE : WHITE));
    }
    lighthouse.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 8).translate(0, 2.65, 0), BEAM_LAMP, false));
    lighthouse.add(mesh(new THREE.ConeGeometry(0.28, 0.32, 8).translate(0, 2.96, 0), STRIPE));
    lighthouse.position.set(lhx, 1.1, lhz);
    g.add(lighthouse);
    this.beam = new THREE.Group();
    this.beam.position.set(lhx, 1.1 + 2.65, lhz);
    const beamMat = new THREE.MeshBasicMaterial({ color: '#fff2c0', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.beam.add(new THREE.Mesh(new THREE.ConeGeometry(0.9, 9, 12, 1, true).rotateZ(Math.PI / 2).translate(4.5, 0, 0), beamMat));
    g.add(this.beam);

    // 바다 바위와 먼바다 돛단배
    for (let i = 0; i < 18; i++) {
      const x = (rng() - 0.5) * 70;
      const r = mesh(jitter(new THREE.DodecahedronGeometry(0.3 + rng() * 0.5, 0), 0.1, i), SEA_ROCK);
      r.position.set(x, 0, roadZ(x) + beachFrom(x) + BEACH + 1 + rng() * 6);
      g.add(r);
    }
    this.boat = new THREE.Group();
    this.boat.add(mesh(new THREE.BoxGeometry(1.2, 0.22, 0.4).translate(0, 0.11, 0), std('#8a5a3a')));
    this.boat.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5).translate(0, 1, 0), MATS.darkWood, false));
    const sail = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0.05, 0.3, 0), new THREE.Vector3(0.05, 1.75, 0), new THREE.Vector3(0.75, 0.35, 0),
    ]);
    sail.computeVertexNormals();
    this.boat.add(mesh(sail, std('#f7f4ec', { side: THREE.DoubleSide }), false));
    this.boat.position.set(0, 0, 22);
    g.add(this.boat);

    // 육지 쪽 바닷가 집
    const home = house(1.2, 0.95, 0.95, std('#6f8496'));
    home.position.set(-5, height(-5, roadZ(-5) - 3), roadZ(-5) - 3);
    home.rotation.y = 0.15;
    g.add(home);
    field.block(-5, roadZ(-5) - 3, 1.2);

    // 길가 마을과 양 목장(육지 쪽 비탈)
    const nearRoad = (r: Rng): [number, number] => { const x = -12 + r() * 26; return [x, roadZ(x) - 2.4 - r() * 5]; };
    village(g, rng, field, 7, nearRoad, height, () => (rng() - 0.5) * 0.4);
    pasture(g, rng, field, (r) => { const x = -16 + r() * 32; return [x, roadZ(x) - 4 - r() * 6]; }, height);

    // 숲은 육지 쪽에만
    scatterTrees(g, rng, field, this.sway, {
      count: 230,
      area: (r) => { const x = (r() - 0.5) * 84; return [x, roadZ(x) - 2.4 - r() * 28]; },
      heightAt: height,
      pineRatio: 0.5,
      scale: [0.9, 1.8],
      gap: 0.2,
    });
    // 덤불·바위·건초로 빈 땅을 채운다
    const land = (r: Rng): [number, number] => { const x = (r() - 0.5) * 60; return [x, roadZ(x) - 1.4 - r() * 16]; };
    scatterProps(g, rng, field, ['bush_0', 'bush_1', 'bush_2'], 240, land, height, [0.8, 1.6], 0.3);
    scatterProps(g, rng, field, ['rock_0', 'rock_1', 'rock_2'], 40, land, height, [0.6, 1.5], 0.3);
    scatterProps(g, rng, field, ['hay'], 10, nearRoad, height, [1, 1.3], 0.25);

    // 차 다섯 대: 같은 차선끼리는 같은 속도로 간격을 두고 달려 서로 부딪히지 않는다
    const fleet: [string, boolean, number, 1 | -1][] = [
      ['#d94c3d', false, 0.02, 1], ['#7fc8b5', true, 0.35, 1], ['#f2c230', false, 0.7, 1],
      ['#3f6fb5', false, 0.2, -1], ['#f4f1e6', true, 0.62, -1],
    ];
    for (const [color, tall, u, dir] of fleet) {
      const v = vehicle(color, tall);
      v.group.scale.setScalar(1.3);
      const light = new THREE.SpotLight('#fff1cc', 0, 5, 0.55, 0.6, 1.5);
      light.position.set(0.33, 0.2, 0);
      light.target.position.set(1.5, -0.1, 0);
      v.group.add(light, light.target);
      g.add(v.group);
      this.cars.push({ ...v, light, u, dir, speed: dir === 1 ? 2.2 : 2.6 });
    }
  }

  update(dt: number, t: number, env: Env): void {
    BEAM_LAMP.emissiveIntensity = 0.3 + env.nightLights * 3;
    ((this.beam.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = env.nightLights * 0.18;
    this.beam.rotation.y += dt * 0.8;

    // 파도: 거품 띠가 밀려왔다 빠진다
    this.foam.position.z = Math.sin(t * 0.9) * 0.25;
    FOAM.opacity = 0.35 + Math.sin(t * 0.9 + 1) * 0.2 + env.wind * 0.15;

    // 바람이 셀수록 빨리 간다. 위치는 dt 로 누적해야 바람이 바뀌어도 튀지 않는다
    this.boatX += dt * 0.4 * (1 + env.wind);
    if (this.boatX > 40) this.boatX -= 80;
    this.boat.position.x = this.boatX;
    this.boat.rotation.z = Math.sin(t * 1.2) * (0.03 + env.wind * 0.05);

    // 비·눈이 오면 조금 천천히 달린다. 길 끝(안개 너머)에 닿으면 반대쪽 끝에서 다시 나온다
    const slow = 1 - 0.35 * Math.max(env.rain, env.snow);
    for (const c of this.cars) {
      const v = c.speed * slow;
      c.u = (((c.u + (c.dir * dt * v) / this.roadLength) % 1) + 1) % 1;
      alongCurve(c.group, this.road, c.u, 0.04 + Math.abs(Math.sin(t * 9 + c.u * 40)) * 0.006);
      // 진행 방향의 오른쪽 차선으로 비키고, 반대 방향 차는 뒤돌아 선다
      // (접선 (x,z) 의 오른쪽은 (-z, x). 반대 방향 차는 dir 로 뒤집는다)
      const tan = this.road.getTangentAt(c.u);
      this.side.set(-tan.z, 0, tan.x).normalize().multiplyScalar(LANE * c.dir);
      c.group.position.add(this.side);
      if (c.dir === -1) {
        c.group.rotation.y += Math.PI;
        c.group.rotation.z = -c.group.rotation.z;
      }
      for (const w of c.wheels) w.rotation.z -= (dt * v) / (0.075 * 1.3);
      c.light.intensity = env.nightLights * 8;
    }
    this.sway.update(dt, env);
  }

  groundHeight(x: number, z: number): number {
    return height(x, z);
  }
}
