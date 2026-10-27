import * as THREE from 'three';
import type { Env } from './env';
import { jitter, smoothstep, softSprite, type Rng } from '../util';
import {
  Field, MATS, Sway, distantMountains, mesh, ribbon, ringArea, rollingHills, scatterTrees, std, terrain, type Stage,
} from './kit';

/**
 * 움직이는 성 테마. 구리 원통 몸체에 제각각인 탑과 굴뚝이 얹힌 성이
 * 네 개의 기계 다리로 들꽃 핀 초원 언덕을 구불구불 걸어 다닌다. 굴뚝에서는 연기가 피어오른다.
 * 특정 작품의 디자인을 옮기지 않고 '걷는 성'이라는 발상만 빌린 독자 디자인이다.
 */
const WALK_SPEED = 0.45; // 월드 단위/초
const LEG_UPPER = 0.42;
const LEG_LOWER = 0.46;
const HIP_HEIGHT = 0.86; // 땅에서 엉덩이 관절까지

const COPPER = std('#b07a4f', { metalness: 0.35, roughness: 0.55 });
const PATINA = std('#6f8f84', { metalness: 0.2, roughness: 0.7 });
const BRICK = std('#a5523f');
const SLATE = std('#4f5668');
const PLANK = std('#8a6a4a');
const IRON = std('#3c3f45', { metalness: 0.6, roughness: 0.45 });
const EYE = std('#3a3020', { emissive: '#ffcf7a', emissiveIntensity: 0.3 });
const FLAG = std('#d9493b', { side: THREE.DoubleSide });
const POND = new THREE.Vector2(2.5, -1.5);
const POND_R = 2.2;
const TUFT = std('#5f8f3e');
const tuftBase = new THREE.Color();

/** 부드럽게 굽이치는 초원 언덕. 연못 자리는 파낸다 */
function height(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = rollingHills(x, z, 1.1) + smoothstep(14, 34, r) * 2.5;
  const pr = Math.hypot(x - POND.x, z - POND.y);
  const pondLevel = rollingHills(POND.x, POND.y, 1.1) - 0.35;
  if (pr < POND_R + 0.7) h = Math.min(h, pondLevel - 0.35 * (1 - pr / (POND_R + 0.7)));
  return h;
}

/** 초원을 크게 한 바퀴 도는 구불구불한 산책길 */
function walkPath(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 9 + 2.6 * Math.sin(2 * a + 1) + 1.6 * Math.sin(5 * a + 0.3);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    pts.push(new THREE.Vector3(x, height(x, z), z));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
  phase: number;
}

/** 다리 하나: 엉덩이 → 위 다리 → 무릎 → 아래 다리 → 발. 앞쪽(+x)으로 걷는다 */
function makeLeg(): Leg {
  const hip = new THREE.Group();
  hip.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), IRON));
  hip.add(mesh(new THREE.BoxGeometry(0.07, LEG_UPPER, 0.07).translate(0, -LEG_UPPER / 2, 0), COPPER));
  const knee = new THREE.Group();
  knee.position.y = -LEG_UPPER;
  knee.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), IRON));
  knee.add(mesh(new THREE.BoxGeometry(0.055, LEG_LOWER, 0.055).translate(0, -LEG_LOWER / 2, 0), IRON));
  knee.add(mesh(new THREE.BoxGeometry(0.2, 0.04, 0.12).translate(0.03, -LEG_LOWER, 0), IRON));
  hip.add(knee);
  return { hip, knee, phase: 0 };
}

function turret(r: number, h: number, wall: THREE.Material, roof: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 8).translate(0, h / 2, 0), wall));
  g.add(mesh(new THREE.ConeGeometry(r * 1.35, r * 2.2, 8).translate(0, h + r * 1.1, 0), roof));
  g.add(mesh(new THREE.BoxGeometry(0.05, 0.07, 0.02).translate(0, h * 0.6, r + 0.005), MATS.window, false));
  return g;
}

export class MovingCastle implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'ground' as const;
  readonly view = { target: new THREE.Vector3(0, 1.0, 0), distance: 17 };
  private readonly castle = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly legs: Leg[] = [];
  private readonly flags: THREE.Mesh[] = [];
  private readonly chimneys: THREE.Object3D[] = [];
  private readonly sway = new Sway();
  private readonly smoke: THREE.Points;
  private readonly smokeMat: THREE.PointsMaterial;
  private readonly puffs: { chimney: number; age: number; life: number; dx: number; dz: number }[] = [];
  private readonly smokeOrigins: THREE.Vector3[] = [];
  private readonly path = walkPath();
  private readonly pathLength: number;
  private u = 0;
  private stride = 0;
  private readonly tmp = new THREE.Vector3();
  private readonly flowerSets: THREE.InstancedMesh[] = [];

  /** 카메라가 따라갈 점(섬 좌표) */
  focus(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.castle.position).setY(this.castle.position.y + 1.2);
  }

  constructor(rng: Rng) {
    const g = this.group;
    const field = new Field();
    g.add(terrain(height));
    g.add(distantMountains(rng, 48, 24));
    this.pathLength = this.path.getLength();

    // 걷는 길: 풀이 눌려 흙이 드러난 띠(땅 굴곡을 따른다)
    g.add(mesh(ribbon(this.path, 0.9, 260, null, 0.03), std('#a8966a'), false));
    field.blockCurve(this.path, 1.1, 160);

    // 연못과 둘레 바위
    const pondLevel = rollingHills(POND.x, POND.y, 1.1) - 0.35;
    const pond = mesh(jitter(new THREE.CircleGeometry(POND_R, 16), 0.15).rotateX(-Math.PI / 2), std('#5aa7cf', { flatShading: false, roughness: 0.15 }), false);
    pond.position.set(POND.x, pondLevel, POND.y);
    g.add(pond);
    for (let i = 0; i < 10; i++) {
      const a = rng() * Math.PI * 2;
      const x = POND.x + Math.cos(a) * (POND_R + 0.25), z = POND.y + Math.sin(a) * (POND_R + 0.25);
      const s = mesh(new THREE.DodecahedronGeometry(0.14 + rng() * 0.16, 0), MATS.stone);
      s.position.set(x, height(x, z) + 0.04, z);
      g.add(s);
    }
    field.block(POND.x, POND.y, POND_R + 0.8);

    // 언덕 위 외딴 나무 몇 그루
    scatterTrees(g, rng, field, this.sway, { count: 9, area: ringArea(3, 26), heightAt: height, pineRatio: 0.3, scale: [1.3, 2.0], gap: 2.5 });

    // 풀포기와 들꽃 무리: 개수가 많아 인스턴스로 그린다
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const tuftGeo = new THREE.ConeGeometry(0.045, 0.22, 3).translate(0, 0.09, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, TUFT, 2600);
    for (let i = 0; i < tufts.count; i++) {
      const [x, z] = ringArea(0, 24)(rng);
      pos.set(x, height(x, z), z);
      q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.4, rng() * 3, (rng() - 0.5) * 0.4));
      sc.setScalar(0.6 + rng() * 0.6);
      tufts.setMatrixAt(i, m4.compose(pos, q, sc));
    }
    g.add(tufts);
    const flowerGeo = new THREE.IcosahedronGeometry(0.07, 0);
    for (const color of ['#ffffff', '#ffd84a', '#ff8fb8', '#b9a2ff', '#ff6a5a']) {
      const flowers = new THREE.InstancedMesh(flowerGeo, std(color), 260);
      let k = 0;
      // 꽃은 무리 지어 핀다
      for (let c = 0; c < 13; c++) {
        const [cx, cz] = ringArea(0, 22)(rng);
        for (let j = 0; j < 20; j++) {
          const fa = rng() * Math.PI * 2, fr = Math.sqrt(rng()) * 1.5;
          const x = cx + Math.cos(fa) * fr, z = cz + Math.sin(fa) * fr;
          pos.set(x, height(x, z) + 0.12, z);
          sc.setScalar(0.55 + rng() * 0.5);
          flowers.setMatrixAt(k++, m4.compose(pos, q.identity(), sc));
        }
      }
      g.add(flowers);
      this.flowerSets.push(flowers);
    }

    this.buildCastle(rng);
    g.add(this.castle);

    // 연기
    const count = 120;
    for (let i = 0; i < count; i++) {
      this.puffs.push({ chimney: i % this.chimneys.length, age: rng() * 3, life: 2.4 + rng() * 1.2, dx: rng() - 0.5, dz: rng() - 0.5 });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.smokeMat = new THREE.PointsMaterial({ map: softSprite(), size: 0.55, transparent: true, opacity: 0.5, depthWrite: false, color: '#d8d4cc' });
    this.smoke = new THREE.Points(geo, this.smokeMat);
    this.smoke.frustumCulled = false;
    g.add(this.smoke);
    this.smokeOrigins = this.chimneys.map(() => new THREE.Vector3());
  }

  private buildCastle(rng: Rng): void {
    const b = this.body;
    // 몸체: 구리 원통 + 아래 철판 + 판자 덧댐
    b.add(mesh(new THREE.CylinderGeometry(0.62, 0.5, 0.7, 10).translate(0, 0.35, 0), COPPER));
    b.add(mesh(new THREE.CylinderGeometry(0.5, 0.36, 0.22, 10).translate(0, -0.11, 0), IRON));
    b.add(mesh(new THREE.BoxGeometry(0.5, 0.42, 0.9).translate(-0.4, 0.42, 0.05), BRICK));
    b.add(mesh(new THREE.BoxGeometry(0.42, 0.3, 0.5).translate(0.25, 0.85, -0.25), PLANK));
    b.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.38, 8).translate(0.05, 0.89, 0.18), PATINA));
    // 앞쪽(+x) 둥근 큰 창
    b.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 14).rotateZ(Math.PI / 2).translate(0.6, 0.4, 0), EYE, false));
    b.add(mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 14).rotateY(Math.PI / 2).translate(0.62, 0.4, 0), IRON));
    // 작은 창문들
    for (const [x, y, z, ry] of [[0.2, 0.55, 0.6, 0], [-0.2, 0.55, 0.6, 0], [-0.66, 0.5, 0.2, -Math.PI / 2], [0.05, 0.98, 0.52, 0]]) {
      b.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.02).rotateY(ry).translate(x, y, z), MATS.window, false));
    }
    // 탑
    const towers: [number, number, number, number, THREE.Material, THREE.Material][] = [
      [-0.35, 0.63, -0.3, 0.14, BRICK, SLATE],
      [0.05, 1.08, 0.18, 0.17, PATINA, COPPER],
      [-0.5, 0.63, 0.35, 0.1, PLANK, BRICK],
      [0.38, 1.0, -0.3, 0.11, SLATE, PATINA],
    ];
    towers.forEach(([x, y, z, r, wall, roof], i) => {
      const t = turret(r, 0.3 + i * 0.08, wall, roof);
      t.position.set(x, y, z);
      t.rotation.y = rng() * Math.PI;
      b.add(t);
    });
    // 굴뚝
    for (const [x, y, z, h] of [[-0.15, 0.7, -0.45, 0.45], [0.42, 1.0, 0.25, 0.32], [-0.6, 0.63, -0.05, 0.36]]) {
      const c = mesh(new THREE.CylinderGeometry(0.05, 0.06, h, 6).translate(x, y + h / 2, z), IRON);
      b.add(c);
      const tip = new THREE.Object3D();
      tip.position.set(x, y + h + 0.03, z);
      b.add(tip);
      this.chimneys.push(tip);
    }
    // 깃발
    for (const [x, y, z] of [[0.05, 1.75, 0.18], [-0.35, 1.25, -0.3]]) {
      b.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 4).translate(x, y + 0.14, z), IRON, false));
      const flag = mesh(new THREE.PlaneGeometry(0.16, 0.09).translate(0.08, 0, 0), FLAG, false);
      flag.position.set(x, y + 0.24, z);
      b.add(flag);
      this.flags.push(flag);
    }
    b.position.y = HIP_HEIGHT + 0.12;
    this.castle.add(b);

    // 다리 네 개: 대각선끼리 같은 박자
    const hips: [number, number, number][] = [[0.3, 0.3, 0], [0.3, -0.3, Math.PI], [-0.3, 0.3, Math.PI], [-0.3, -0.3, 0]];
    for (const [x, z, phase] of hips) {
      const leg = makeLeg();
      leg.hip.position.set(x, HIP_HEIGHT, z);
      leg.phase = phase;
      this.castle.add(leg.hip);
      this.legs.push(leg);
    }
    this.castle.scale.setScalar(1.5);
  }

  update(dt: number, t: number, env: Env): void {
    EYE.emissiveIntensity = 0.3 + env.nightLights * 2.2;

    // 산책길을 따라 걷는다. 몸은 늘 곧게 서 있고 방향만 길을 따른다
    const speed = WALK_SPEED * (1 - 0.3 * Math.max(env.rain, env.snow));
    this.u = (this.u + (dt * speed) / this.pathLength) % 1;
    this.stride += dt * speed * 7.5;
    const p = this.path.getPointAt(this.u);
    const tan = this.path.getTangentAt(this.u);
    this.castle.position.set(p.x, height(p.x, p.z), p.z);
    this.castle.rotation.y = Math.atan2(-tan.z, tan.x);

    // 풀포기 색은 계절 잔디보다 조금 진하게, 눈이 오면 꽃은 숨는다
    TUFT.color.copy(tuftBase.copy(MATS.grass.color).multiplyScalar(0.9));
    for (const f of this.flowerSets) f.visible = env.snowCover < 0.6;

    for (const leg of this.legs) {
      const s = this.stride + leg.phase;
      leg.hip.rotation.z = Math.sin(s) * 0.38;
      // 다리를 앞으로 내밀 때만 무릎을 굽혀 들어 올린다
      leg.knee.rotation.z = -Math.max(0, Math.cos(s)) * 0.7;
    }
    // 걸음마다 몸이 살짝 출렁이고 좌우로 기우뚱
    this.body.position.y = HIP_HEIGHT + 0.12 + Math.abs(Math.sin(this.stride)) * 0.05;
    this.body.rotation.x = Math.sin(this.stride) * 0.03;
    this.body.rotation.z = Math.cos(this.stride * 0.5) * 0.02;

    for (const [i, f] of this.flags.entries()) {
      f.rotation.y = Math.sin(t * (3 + env.wind * 5) + i) * (0.3 + env.wind * 0.4);
    }

    // 연기: 굴뚝 끝(섬 좌표)에서 피어올라 바람 방향으로 흐른다
    this.castle.updateMatrixWorld(true);
    this.group.updateMatrixWorld(true);
    this.chimneys.forEach((c, i) => {
      this.group.worldToLocal(c.getWorldPosition(this.smokeOrigins[i]));
    });
    const pos = this.smoke.geometry.getAttribute('position') as THREE.BufferAttribute;
    const drift = 0.15 + env.wind * 0.6;
    this.puffs.forEach((p, i) => {
      p.age += dt;
      if (p.age > p.life) p.age -= p.life;
      const k = p.age / p.life;
      const o = this.smokeOrigins[p.chimney];
      this.tmp.set(o.x + p.dx * 0.25 * k + drift * k * 1.2, o.y + k * 1.1, o.z + p.dz * 0.25 * k);
      pos.setXYZ(i, this.tmp.x, this.tmp.y, this.tmp.z);
    });
    pos.needsUpdate = true;
    this.smokeMat.opacity = 0.45 * (1 - env.rain * 0.5);

    this.sway.update(t, env);
  }
}
