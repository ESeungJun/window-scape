import * as THREE from 'three';
import type { Env } from './env';
import type { Rng } from '../util';
import { jitter } from '../util';
import {
  FLOATING_VIEW, Field, MATS, R, Sway, TOP, Waterfall, addVines, fallAt, floatingGround, house, islandBob, lampPost, mesh,
  rimFactor, rimPoint, riverMesh, scatterTrees, sheep, std, waterBrightness, windmill, type Stage,
} from './kit';

/**
 * 하늘섬 테마. 언덕 위 풍차, 섬을 가로지르는 강과 가장자리 폭포, 집 두 채와 양이 있는 마을.
 * 모양은 전부 코드로 만든다. 나중에 Blender 모델(.glb)로 바꾸려면 이 파일만 교체하면 된다.
 */
const HILL = new THREE.Vector2(-2.2, -1.4);
const HILL_R = 2.2;
const FALL_ANGLE = 0.42;
const SPRING_FALL_ANGLE = 2.25;

function surfaceY(x: number, z: number): number {
  const d = Math.hypot(x - HILL.x, z - HILL.y) / HILL_R;
  return d < 1 ? Math.max(TOP, 0.15 + 0.42 * HILL_R * Math.sqrt(1 - d * d)) : TOP;
}

export class Island implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'floating' as const;
  readonly view = FLOATING_VIEW;
  private readonly hub: THREE.Group;
  private readonly sway = new Sway();
  private readonly river: THREE.ShaderMaterial;
  private readonly falls: Waterfall[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private readonly flowers = new THREE.Group();

  constructor(rng: Rng) {
    const g = this.group;
    const field = new Field();

    // 땅
    g.add(floatingGround());
    const hill = jitter(new THREE.IcosahedronGeometry(HILL_R, 2), 0.08);
    hill.scale(1, 0.42, 1).translate(HILL.x, 0.15, HILL.y);
    g.add(mesh(hill, MATS.grass));

    // 강: 언덕 아래 샘에서 시작해 가장자리 폭포로 이어진다
    const edge = rimPoint(FALL_ANGLE);
    const river = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.4, TOP, 0.3),
      new THREE.Vector3(0.9, TOP, 0.9),
      new THREE.Vector3(2.3, TOP, 0.6),
      new THREE.Vector3(3.6, TOP, 1.4),
      edge.clone().multiplyScalar(0.9).setY(TOP),
      edge.clone(),
    ]);
    const rm = riverMesh(river, 0.7);
    this.river = rm.mat;
    g.add(rm.mesh);
    field.blockCurve(river, 0.75, 24);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.6;
      const s = mesh(new THREE.DodecahedronGeometry(0.22, 0), MATS.stone);
      s.position.set(-0.4 + Math.cos(a) * 0.42 - 0.2, TOP + 0.05, 0.3 + Math.sin(a) * 0.42 - 0.1);
      s.scale.set(1, 0.7, 1);
      g.add(s);
    }

    // 폭포: 강 끝의 큰 폭포 + 반대편 흙벽에서 나오는 작은 폭포
    const springFall = fallAt(SPRING_FALL_ANGLE, { width: 0.32, length: 11, reach: 0.7, y: -0.55, inset: 0.99 });
    for (const f of [fallAt(FALL_ANGLE, { width: 0.72, length: 15, reach: 1.4 }), springFall]) {
      const wf = new Waterfall(f, rng, f === springFall ? 0 : 150);
      this.falls.push(wf);
      g.add(wf.group);
    }
    g.add(mesh(new THREE.DodecahedronGeometry(0.28, 0).translate(springFall.origin.x, -0.45, springFall.origin.z), MATS.stone));

    // 마을
    const place = (obj: THREE.Object3D, x: number, z: number, rotY: number, r: number) => {
      obj.position.set(x, surfaceY(x, z), z);
      obj.rotation.y = rotY;
      g.add(obj);
      field.block(x, z, r);
      return obj;
    };
    const h1 = place(house(1.3, 0.95, 1.05, MATS.roofRed), 1.5, -2.4, 0.75, 1.35);
    const h2 = place(house(1.0, 0.8, 0.9, MATS.roofBlue), -1.6, 2.7, 1.1, 1.15);
    const mill = windmill();
    this.hub = mill.hub;
    mill.group.position.set(HILL.x, surfaceY(HILL.x, HILL.y) - 0.08, HILL.y);
    mill.group.rotation.y = 0.85;
    g.add(mill.group);
    field.block(HILL.x, HILL.y, HILL_R * 0.95);

    const doorOf = (h: THREE.Object3D, d: number) =>
      new THREE.Vector3(0, 0, d / 2 + 0.45).applyAxisAngle(THREE.Object3D.DEFAULT_UP, h.rotation.y).add(h.position);
    const door1 = doorOf(h1, 0.95);
    const door2 = doorOf(h2, 0.8);

    // 다리
    const bt = 0.3;
    const bp = river.getPointAt(bt);
    const btan = river.getTangentAt(bt);
    const bside = new THREE.Vector3(-btan.z, 0, btan.x).normalize();
    const bridge = new THREE.Group();
    bridge.add(mesh(new THREE.BoxGeometry(0.55, 0.08, 1.35).translate(0, 0.06, 0), MATS.wood));
    for (const z of [-0.6, 0.6]) {
      bridge.add(mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06).translate(-0.24, 0.2, z), MATS.darkWood));
      bridge.add(mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06).translate(0.24, 0.2, z), MATS.darkWood));
    }
    bridge.position.set(bp.x, TOP, bp.z);
    bridge.rotation.y = Math.atan2(-btan.z, btan.x);
    g.add(bridge);

    // 오솔길 징검돌
    const a = bp.clone().addScaledVector(bside, -0.95);
    const b = bp.clone().addScaledVector(bside, 0.95);
    const [near1, near2] = a.distanceTo(door1) < b.distanceTo(door1) ? [a, b] : [b, a];
    const millDoor = new THREE.Vector3(0, 0, 1.0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, mill.group.rotation.y).add(mill.group.position);
    const paths = [
      new THREE.CatmullRomCurve3([door1, near1, near2, door2].map((v) => v.clone().setY(0))),
      new THREE.CatmullRomCurve3([door1, new THREE.Vector3(-0.2, 0, -1.4), millDoor].map((v) => v.clone().setY(0))),
    ];
    const stoneGeo = new THREE.CylinderGeometry(0.16, 0.18, 0.05, 6);
    const bridgeAt = new THREE.Vector3(bp.x, 0, bp.z);
    for (const curve of paths) {
      const n = Math.floor(curve.getLength() / 0.38);
      for (let i = 1; i < n; i++) {
        const p = curve.getPointAt(i / n);
        if (p.distanceTo(bridgeAt) < 0.8) continue;
        const s = mesh(stoneGeo, MATS.path, false);
        s.position.set(p.x + (rng() - 0.5) * 0.12, surfaceY(p.x, p.z) + 0.01, p.z + (rng() - 0.5) * 0.12);
        s.rotation.y = rng() * Math.PI;
        s.scale.setScalar(0.8 + rng() * 0.4);
        g.add(s);
        field.block(p.x, p.z, 0.3);
      }
    }

    // 가로등과 창문 불빛
    for (const [x, z] of [[0.2, -1.2], [-0.9, 1.6], [3.0, -1.2]]) {
      place(lampPost(), x, z, 0, 0.3);
    }
    for (const d of [door1, door2]) {
      const light = new THREE.PointLight('#ffb35c', 0, 6, 2);
      light.position.set(d.x, 0.9, d.z);
      g.add(light);
      this.lights.push(light);
    }

    scatterTrees(g, rng, field, this.sway, { count: 40 });

    // 양, 바위, 꽃
    let flock = 0;
    for (let i = 0; i < 300 && flock < 4; i++) {
      const x = (rng() - 0.5) * 7, z = (rng() - 0.5) * 7;
      if (!field.free(x, z, 0.4)) continue;
      place(sheep(), x, z, rng() * Math.PI * 2, 0.4);
      flock++;
    }
    for (let i = 0; i < 14; i++) {
      const [x, z] = field.pick(rng, 0.8, 0.95);
      if (!field.free(x, z, 0.1)) continue;
      const s = mesh(new THREE.DodecahedronGeometry(0.3, 0), MATS.stone);
      s.position.set(x, TOP + 0.05, z);
      s.scale.set(0.6 + rng() * 0.9, 0.4 + rng() * 0.6, 0.6 + rng() * 0.9);
      s.rotation.set(rng(), rng() * 3, rng());
      g.add(s);
    }
    const flowerGeo = new THREE.IcosahedronGeometry(0.05, 0);
    const flowerMats = ['#ffffff', '#ffd84a', '#ff9ec4', '#b9a2ff'].map((c) => std(c));
    for (let i = 0; i < 400 && this.flowers.children.length < 60; i++) {
      const x = (rng() - 0.5) * 10, z = (rng() - 0.5) * 10;
      if (Math.hypot(x, z) > R * rimFactor(Math.atan2(z, x)) * 0.9 || !field.free(x, z, 0.05)) continue;
      const f = mesh(flowerGeo, flowerMats[i % 4], false);
      f.position.set(x, surfaceY(x, z) + 0.04, z);
      this.flowers.add(f);
    }
    g.add(this.flowers);

    addVines(g, rng, this.sway, [FALL_ANGLE, SPRING_FALL_ANGLE]);
  }

  update(dt: number, t: number, env: Env): void {
    for (const l of this.lights) l.intensity = env.nightLights * 6;
    const bright = waterBrightness(env);
    this.river.uniforms.time.value = t;
    this.river.uniforms.bright.value = bright;
    for (const f of this.falls) f.update(dt, t, bright);

    this.hub.rotation.z -= dt * (0.35 + env.wind * 2.8);
    this.sway.update(t, env);
    this.flowers.scale.y = Math.max(0.001, 1 - env.snowCover);
    this.flowers.visible = env.snowCover < 0.95;
    this.group.position.y = islandBob(t);
  }
}
