import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Env } from './env';
import { jitter, smoothstep, softSprite, type Rng } from '../util';
import {
  Field, MATS, Sway, distantMountains, mesh, ribbon, ringArea, rollingHills, scatterTrees, std, terrain,
  waterBrightness, type Stage,
} from './kit';
import { riverMaterial } from './water';

/**
 * 숲 테마. 끝없이 이어지는 키 큰 숲 사이로 시냇물이 굽이쳐 흐르고,
 * 버섯·덤불·쓰러진 통나무와 풀 뜯는 사슴이 있다. 낮에는 햇살 줄기, 밤에는 반딧불이와 빛나는 버섯.
 */
const CAP_RED = std('#c8382c');
const CAP_GLOW = std('#2a4a6a', { emissive: '#5fd0ff', emissiveIntensity: 0 });
const STEM = std('#efe6d2');
const MOSS = std('#4f7a3a');
const BARK = std('#5e4330');
const DEER = std('#a8703f');
const DEER_DARK = std('#5a3a22');
/** 숲 바닥: 계절 잔디색보다 짙은 이끼색 */
const FLOOR = std('#4f7a3a');

// 버섯 부품은 모두 같은 지오메트리를 쓰고 크기만 바꾼다
const STEM_GEO = new THREE.CylinderGeometry(0.025, 0.035, 0.12, 6).translate(0, 0.06, 0);
const CAP_GEO = new THREE.SphereGeometry(0.08, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.12, 0);
const SPOTS_GEO = mergeGeometries(
  [0, 1.7, 3.4, 5.1].map((a) => new THREE.IcosahedronGeometry(0.012, 0).translate(Math.cos(a) * 0.045, 0.16, Math.sin(a) * 0.045)),
)!;

function mushroom(rng: Rng, glow: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(STEM_GEO, STEM, false));
  g.add(mesh(CAP_GEO, glow ? CAP_GLOW : CAP_RED, false));
  if (!glow) g.add(mesh(SPOTS_GEO, STEM, false));
  g.scale.set(1, 0.7 + rng() * 0.6, 1);
  g.rotation.y = rng() * Math.PI * 2;
  return g;
}

/** 앞이 +x 인 사슴. 머리를 숙였다 드는 neck 을 돌려 받는다 */
function deer(): { group: THREE.Group; neck: THREE.Group } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.16).translate(0, 0.38, 0), DEER));
  for (const [x, z] of [[0.15, 0.05], [0.15, -0.05], [-0.15, 0.05], [-0.15, -0.05]]) {
    g.add(mesh(new THREE.BoxGeometry(0.035, 0.3, 0.035).translate(x, 0.15, z), DEER_DARK));
  }
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.08, 0.06).translate(-0.23, 0.44, 0), STEM, false));
  const neck = new THREE.Group();
  neck.position.set(0.18, 0.44, 0);
  neck.add(mesh(new THREE.BoxGeometry(0.07, 0.22, 0.07).translate(0.02, 0.1, 0), DEER));
  neck.add(mesh(new THREE.BoxGeometry(0.15, 0.08, 0.08).translate(0.08, 0.22, 0), DEER));
  for (const z of [-0.03, 0.03]) {
    neck.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 4).rotateX(z * 8).translate(0.02, 0.32, z * 2), DEER_DARK, false));
  }
  g.add(neck);
  return { group: g, neck };
}

/** 숲 바닥: 완만한 기복, 바깥은 언덕. 시냇물 자리는 파낸다 */
function baseHeight(x: number, z: number): number {
  return rollingHills(x, z, 0.6) + smoothstep(12, 30, Math.hypot(x, z)) * (rollingHills(x, z, 1.5) + 2.2);
}

function streamCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 14; i++) {
    const x = -34 + i * (68 / 14);
    const z = 2.2 * Math.sin(x * 0.22 + 0.6) + 1.2 * Math.sin(x * 0.53) - 0.6;
    pts.push(new THREE.Vector3(x, baseHeight(x, z) - 0.12, z));
  }
  return new THREE.CatmullRomCurve3(pts);
}

export class Forest implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'ground' as const;
  readonly view = { target: new THREE.Vector3(0, 1.2, 0), distance: 18 };
  private readonly sway = new Sway();
  private readonly heightAt: (x: number, z: number) => number;
  private readonly stream: THREE.ShaderMaterial;
  private readonly neck: THREE.Group;
  private readonly flies: THREE.Points;
  private readonly flyMat: THREE.PointsMaterial;
  private readonly flySeeds: { x: number; y: number; z: number; p: number }[] = [];
  private readonly rays: THREE.Mesh[] = [];
  private readonly rayMat = new THREE.MeshBasicMaterial({
    color: '#fff3c8', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });

  constructor(rng: Rng) {
    const g = this.group;
    const field = new Field();

    // 시냇물이 지나는 자리는 물길로 파낸다
    const curve = streamCurve();
    const samples = curve.getSpacedPoints(300);
    const height = (x: number, z: number) => {
      let best = Infinity, by = 0;
      for (const p of samples) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d < best) { best = d; by = p.y; }
      }
      return THREE.MathUtils.lerp(by - 0.15, baseHeight(x, z), smoothstep(0.35, 1.5, Math.sqrt(best)));
    };
    this.heightAt = height;
    g.add(terrain(height, FLOOR));
    g.add(distantMountains(rng, 48));

    this.stream = riverMaterial();
    const streamMesh = new THREE.Mesh(ribbon(curve, 0.7, 300, null, 0.04), this.stream);
    streamMesh.receiveShadow = true;
    g.add(streamMesh);
    field.blockCurve(curve, 0.75, 120);
    for (let i = 0; i < 26; i++) {
      const p = curve.getPointAt(0.3 + rng() * 0.4);
      const side = rng() < 0.5 ? -1 : 1;
      const r = mesh(new THREE.DodecahedronGeometry(0.12 + rng() * 0.15, 0), MATS.stone);
      const z = p.z + side * (0.42 + rng() * 0.2);
      r.position.set(p.x + (rng() - 0.5) * 0.4, height(p.x, z) + 0.05, z);
      g.add(r);
    }

    // 통나무 다리
    const bt = 0.5;
    const bp = curve.getPointAt(bt);
    const bt2 = curve.getTangentAt(bt);
    const bridge = mesh(new THREE.CylinderGeometry(0.09, 0.1, 1.3, 7).rotateX(Math.PI / 2), BARK);
    bridge.position.set(bp.x, bp.y + 0.22, bp.z);
    bridge.rotation.y = Math.atan2(-bt2.z, bt2.x);
    g.add(bridge);

    // 사슴: 시냇가에서 풀을 뜯는다
    const d = deer();
    d.group.position.set(1.6, height(1.6, 1.6), 1.6);
    d.group.rotation.y = -2.4;
    g.add(d.group);
    this.neck = d.neck;
    field.block(1.6, 1.6, 0.7);

    // 쓰러진 통나무와 이끼 바위
    for (const [x, z, ry] of [[-1.8, 2.6, 0.4], [2.6, -2.8, -0.8]]) {
      const y = height(x, z);
      const log = mesh(new THREE.CylinderGeometry(0.11, 0.13, 1.3, 7).rotateZ(Math.PI / 2), BARK);
      log.position.set(x, y + 0.1, z);
      log.rotation.y = ry;
      g.add(log);
      const moss = mesh(new THREE.BoxGeometry(0.6, 0.04, 0.2), MOSS, false);
      moss.position.set(x, y + 0.21, z);
      moss.rotation.y = ry;
      g.add(moss);
      field.block(x, z, 0.75);
    }

    // 키 큰 숲
    scatterTrees(g, rng, field, this.sway, {
      count: 170, area: ringArea(2.2, 30), heightAt: height, pineRatio: 0.62, scale: [1.1, 2.2], gap: 0.15,
    });

    // 덤불·버섯
    const bushGeo = jitter(new THREE.IcosahedronGeometry(0.18, 0), 0.06);
    for (let i = 0; i < 400; i++) {
      const [x, z] = ringArea(0.8, 11)(rng);
      if (!field.free(x, z, 0.02)) continue;
      const y = height(x, z);
      const roll = rng();
      if (roll < 0.35) {
        const b = mesh(bushGeo, rng() < 0.5 ? MATS.foliageA : MATS.pine);
        b.position.set(x, y + 0.08, z);
        b.scale.set(1 + rng(), 0.7, 1 + rng());
        g.add(b);
      } else if (roll < 0.5) {
        const m = mushroom(rng, rng() < 0.3);
        m.position.set(x, y, z);
        g.add(m);
      }
    }

    // 반딧불이
    const flyCount = 90;
    for (let i = 0; i < flyCount; i++) {
      const [x, z] = ringArea(0, 9)(rng);
      this.flySeeds.push({ x, y: height(x, z) + 0.3 + rng() * 1.4, z, p: rng() * 10 });
    }
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(flyCount * 3), 3));
    this.flyMat = new THREE.PointsMaterial({
      map: softSprite(), size: 0.22, color: '#d8ff7a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flies = new THREE.Points(flyGeo, this.flyMat);
    this.flies.frustumCulled = false;
    g.add(this.flies);

    // 햇살 줄기: 나무 사이로 비스듬히 내려오는 빛 기둥
    for (let i = 0; i < 6; i++) {
      const ray = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.6, 5, 8, 1, true).translate(0, 2.5, 0), this.rayMat);
      const [x, z] = ringArea(1, 7)(rng);
      ray.position.set(x, height(x, z), z);
      ray.rotation.set(0.35, rng() * Math.PI, 0.25);
      ray.renderOrder = 3;
      g.add(ray);
      this.rays.push(ray);
    }
  }

  update(dt: number, t: number, env: Env): void {
    const bright = waterBrightness(env);
    this.stream.uniforms.time.value = t;
    this.stream.uniforms.bright.value = bright;

    // 사슴: 고개를 숙여 풀을 뜯다가 가끔 든다
    const graze = Math.sin(t * 0.4) > -0.3 ? 1 : 0;
    this.neck.rotation.z += ((graze ? -1.1 + Math.sin(t * 6) * 0.05 : 0.1) - this.neck.rotation.z) * Math.min(1, dt * 3);

    // 반딧불이: 밤에만, 비가 오면 숨는다
    const night = env.nightLights * (1 - Math.max(env.rain, env.snow));
    this.flyMat.opacity = night * (0.75 + Math.sin(t * 3) * 0.25);
    this.flies.visible = night > 0.02;
    if (this.flies.visible) {
      const pos = this.flies.geometry.getAttribute('position') as THREE.BufferAttribute;
      this.flySeeds.forEach((f, i) => {
        pos.setXYZ(i, f.x + Math.sin(t * 0.7 + f.p) * 0.3, f.y + Math.sin(t * 1.3 + f.p * 2) * 0.15, f.z + Math.cos(t * 0.6 + f.p) * 0.3);
      });
      pos.needsUpdate = true;
    }
    CAP_GLOW.emissiveIntensity = env.nightLights * 1.8;
    // 이끼색은 잔디보다 어둡게, 눈이 덮이면 거의 흰색이 되도록 덜 어둡게
    FLOOR.color.copy(MATS.grass.color).multiplyScalar(0.62 + 0.33 * env.snowCover);

    // 햇살 줄기: 맑은 낮일수록 진하게
    this.rayMat.opacity = Math.max(0, (env.sunIntensity / 3.2) * (1 - env.overcast) - env.nightLights) * 0.07;
    for (const r of this.rays) r.visible = this.rayMat.opacity > 0.003;

    this.sway.update(dt, env);
  }

  groundHeight(x: number, z: number): number {
    return this.heightAt(x, z);
  }
}
