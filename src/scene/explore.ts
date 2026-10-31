import * as THREE from 'three';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { TILE_HALF } from './diorama';
import type { Stage } from './kit';

/**
 * 들어가기 모드: 풍경 안에 작은 캐릭터를 내려놓고 클릭한 곳(또는 WASD·방향키)으로 걸어 다니게 한다.
 * 캐릭터는 시안 전 임시 모양(docs/explore-character.md)이다. 땅은 모델 메시에 광선을 쏴서 찾는다.
 * - 아래로 쏜 광선: 발밑 높이. 물(liquid_*, 셰이더 재질)이나 낭떠러지, 너무 높은 턱이면 못 간다
 * - 앞으로 쏜 광선(무릎 높이): 벽·나무 줄기·바위에 막힌다
 * 캐릭터는 테마 무리(stage.group) 안에 넣어 둥실 뜨는 하늘섬과 같이 움직인다.
 * 모델 메시는 삼각형이 많아 광선 하나에 20ms 가까이 걸려서, 들어갈 때 메시마다 BVH 를 한 번 만들어 둔다(테마별로 재사용).
 */
const WALK_SPEED = 0.9;
/** 캐릭터 키(문 높이가 0.4~0.5 라 그보다 조금 작게) */
const HEIGHT = 0.36;
/** 한 걸음에 오를 수 있는 턱·내려갈 수 있는 높이 */
const STEP_UP = 0.22;
const STEP_DOWN = 0.5;
/** 앞쪽 막힘을 볼 거리(몸 반지름 + 여유) */
const REACH = 0.12;
/** 땅 테마(지평선까지 이어진 땅)에서 돌아다닐 수 있는 반경 */
const LAND_RADIUS = 22;
/** 카메라를 가리면 잠깐 숨길 물체의 최대 크기(바운딩 구 반지름). 그보다 큰 땅·언덕은 숨기지 않고 카메라를 당긴다 */
const HIDE_RADIUS = 2.5;
/** 점프: 처음 솟는 속도와 중력(최고 높이 = v²/2g ≈ 0.3, 걸어서 못 오르는 바위·계단에 올라설 수 있다) */
const JUMP_SPEED = 2;
const GRAVITY = 6.5;
/** 막혔을 때 비스듬히 돌아갈 각도(라디안). 앞에서부터 차례로 해 본다 */
const SLIDE_ANGLES = [0.45, 0.9, 1.35];
/** 클릭한 곳으로 가다가 이만큼(초) 못 나아가면 포기한다 */
const STUCK_S = 0.6;
/** 몸 반지름(지나가는 차에 밀려날 때) */
const BODY_RADIUS = 0.07;
/** 밟지도 막히지도 않고 헤치고 지나가는 풀숲 */
const SOFT = /^(bush|grass|flower|reed)/;
const SOFT_MAT = /^(bush|flower)/;

export class Explorer {
  readonly avatar = new THREE.Group();
  active = false;
  /** 보이는 메시 전부(카메라 가림용)와 그중 밟거나 막히는 것(들어갈 때 모은다) */
  private meshes: THREE.Object3D[] = [];
  private solid: THREE.Object3D[] = [];
  /** 지나가는 차와 차 자기 좌표의 크기 상자. 캐릭터와 겹치면 밀어낸다 */
  private cars: { obj: THREE.Object3D; box: THREE.Box3 }[] = [];
  /** 막혔을 때 지난번에 돌아간 쪽(1/-1). 같은 쪽을 먼저 해 봐서 좌우로 떨지 않게 */
  private slideSide = 1;
  private stuck = 0;
  private stage?: Stage;
  private readonly ray = new THREE.Raycaster();
  private readonly goal = new THREE.Vector3();
  private hasGoal = false;
  private readonly keys = new Set<string>();
  private readonly marker: THREE.Mesh;
  private markerAge = 1;
  private readonly body: THREE.Object3D;
  private walkPhase = 0;
  private idleCheck = 0;
  /** 위아래 속도. 공중에 있는 동안만 쓴다 */
  private vy = 0;
  private airborne = false;
  private jumpQueued = false;
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly slide = new THREE.Vector3();
  /** 카메라를 가려서 숨겨 둔 물체(이번 프레임에 다시 가리는지 보고 되돌린다) */
  private hidden = new Set<THREE.Object3D>();
  private hiding = new Set<THREE.Object3D>();
  private static readonly DOWN = new THREE.Vector3(0, -1, 0);

  constructor() {
    this.body = placeholderFigure();
    this.avatar.add(this.body);
    const ring = new THREE.RingGeometry(0.07, 0.1, 28).rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    this.marker.renderOrder = 2;

    window.addEventListener('keydown', (e) => {
      if (!this.active || e.metaKey || e.ctrlKey || e.target instanceof HTMLInputElement) return;
      if (e.code === 'Space') {
        if (!e.repeat) this.jumpQueued = true;
        e.preventDefault();
        return;
      }
      const k = moveKey(e.code);
      if (k) {
        this.keys.add(k);
        this.hasGoal = false;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const k = moveKey(e.code);
      if (k) this.keys.delete(k);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** 캐릭터를 풍경에 내려놓는다. 설 곳을 못 찾으면 false */
  start(stage: Stage): boolean {
    this.stage = stage;
    this.meshes = [];
    this.solid = [];
    this.cars = [];
    stage.group.traverseVisible((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      // 반투명(물보라·빛줄기)은 밟지도 막히지도 않는다
      if (mat.transparent && !(mat as THREE.ShaderMaterial).isShaderMaterial) return;
      // 처음 들어갈 때 한 번만 만든다(같은 지오메트리를 나눠 쓰는 메시도 하나로)
      if (!(m as THREE.InstancedMesh).isInstancedMesh) {
        m.geometry.boundsTree ??= new MeshBVH(m.geometry);
        m.raycast = acceleratedRaycast;
      }
      this.meshes.push(o);
      // 굽기 전에 하나로 합친 덩어리(static)는 첫 물체 이름을 따라가서(덤불 이름에 땅이 들어 있다) 이름으로 거르지 않는다
      const soft = o.parent?.name !== 'static' && (SOFT.test(o.name) || SOFT.test(o.parent?.name ?? ''));
      if (!soft) this.solid.push(o);
    });
    stage.group.traverse((o) => {
      if (o.name.startsWith('mover_car') && !o.parent?.name.startsWith('mover_')) this.cars.push({ obj: o, box: localBox(o) });
    });
    const spot = this.findSpawn(stage);
    if (!spot) return false;
    this.avatar.position.copy(spot);
    this.avatar.rotation.set(0, Math.PI * 0.25, 0);
    stage.group.add(this.avatar, this.marker);
    this.marker.visible = false;
    this.hasGoal = false;
    this.keys.clear();
    this.airborne = this.jumpQueued = false;
    this.active = true;
    return true;
  }

  stop(): void {
    this.endOcclusion();
    this.active = false;
    this.keys.clear();
    this.avatar.removeFromParent();
    this.marker.removeFromParent();
    this.meshes = [];
    this.solid = [];
    this.cars = [];
  }

  /** 화면 좌표(-1~1)를 클릭했을 때: 그 땅으로 걸어간다. 걸을 수 없는 곳이면 false */
  pick(ndc: THREE.Vector2, camera: THREE.Camera): boolean {
    if (!this.active || !this.stage) return false;
    this.ray.setFromCamera(ndc, camera);
    const hit = this.firstHit();
    if (!hit || isWater(hit.object)) return false;
    const p = this.stage.group.worldToLocal(hit.point.clone());
    if (!this.inBounds(p.x, p.z)) return false;
    this.goal.copy(p);
    this.hasGoal = true;
    this.marker.position.copy(p).setY(p.y + 0.02);
    this.marker.visible = true;
    this.markerAge = 0;
    return true;
  }

  /** 카메라가 따라갈 점(캐릭터 가슴 높이, 월드 좌표) */
  focus(out: THREE.Vector3): THREE.Vector3 {
    return this.avatar.localToWorld(out.set(0, HEIGHT * 0.6, 0));
  }

  /**
   * from(월드)에서 dir 쪽으로 far 안에서 카메라를 가리는 것: 작은 물체(나무·바위·기둥)는 이번 프레임 숨길 목록에 넣고,
   * 처음 닿는 큰 물체(땅·언덕)까지의 거리를 돌려준다. 다 본 뒤 endOcclusion(false)로 숨김을 반영한다
   */
  occlusion(from: THREE.Vector3, dir: THREE.Vector3, far: number): number | null {
    if (!this.active) return null;
    this.ray.set(from, dir);
    this.ray.far = far;
    const hits = this.ray.intersectObjects(this.meshes, false);
    this.ray.far = Infinity;
    for (const h of hits) {
      if (h.object.parent === null) continue;
      if (boundRadius(h.object) > HIDE_RADIUS) return h.distance;
      this.hiding.add(h.object);
    }
    return null;
  }

  /** 이번 프레임에 모은 것만 숨기고 나머지는 되돌린다. all 이면 전부 되돌린다 */
  endOcclusion(all = true): void {
    for (const o of this.hidden) if (all || !this.hiding.has(o)) o.visible = true;
    if (all) this.hiding.clear();
    for (const o of this.hiding) o.visible = false;
    [this.hidden, this.hiding] = [this.hiding, this.hidden];
    this.hiding.clear();
  }

  update(dt: number, t: number, camera: THREE.Camera): void {
    if (!this.active) return;
    const pos = this.avatar.position;
    const dir = this.dir.set(0, 0, 0);
    if (this.keys.size) {
      // 카메라가 보는 방향 기준 앞뒤·좌우
      camera.getWorldDirection(this.v1).setY(0).normalize();
      this.v2.set(-this.v1.z, 0, this.v1.x);
      if (this.keys.has('f')) dir.add(this.v1);
      if (this.keys.has('b')) dir.sub(this.v1);
      if (this.keys.has('r')) dir.add(this.v2);
      if (this.keys.has('l')) dir.sub(this.v2);
    } else if (this.hasGoal) {
      dir.subVectors(this.goal, pos).setY(0);
      if (dir.length() < 0.04) {
        this.hasGoal = false;
        dir.set(0, 0, 0);
      }
    }

    if (this.jumpQueued) {
      this.jumpQueued = false;
      if (!this.airborne) {
        this.airborne = true;
        this.vy = JUMP_SPEED;
      }
    }

    let moving = false;
    if (dir.lengthSq() > 1e-6) {
      dir.normalize();
      const step = Math.min(WALK_SPEED * dt, this.hasGoal && !this.keys.size ? this.goal.distanceTo(pos) : Infinity);
      if (this.walk(pos, dir, step)) {
        moving = true;
        this.stuck = 0;
      } else if (this.hasGoal && (this.stuck += dt) > STUCK_S) this.hasGoal = false;
      // 가려는 쪽으로 몸을 돌린다(막혀도 돌아본다)
      const want = Math.atan2(dir.x, dir.z);
      const diff = Math.atan2(Math.sin(want - this.avatar.rotation.y), Math.cos(want - this.avatar.rotation.y));
      this.avatar.rotation.y += diff * Math.min(1, dt * 12);
    } else if (!this.airborne && (this.idleCheck += dt) > 0.25) {
      // 서 있는 동안 발밑이 움직이면(지나가는 성·차) 따라 내려간다. 위로 높게 덮치면 그대로 둔다
      this.idleCheck = 0;
      const g = this.groundAt(pos.x, pos.y + STEP_UP + 0.05, pos.z);
      if (g && !g.water && g.y < pos.y + STEP_UP && g.y > pos.y - STEP_DOWN) pos.y = g.y;
    }

    if (this.airborne) this.fall(dt);
    this.avoidCars();

    // 걷는 동안 통통 튄다(시안 전 임시 동작). 공중에서는 멈춘다
    if (this.airborne) moving = false;
    this.walkPhase = moving ? this.walkPhase + dt * 14 : 0;
    this.body.position.y = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.035 : 0;
    this.body.rotation.z = moving ? Math.sin(this.walkPhase) * 0.08 : 0;

    if (this.marker.visible) {
      this.markerAge += dt;
      const k = Math.min(1, this.markerAge / 0.9);
      (this.marker.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.9;
      this.marker.scale.setScalar(1 + k * 0.6 + Math.sin(t * 8) * 0.03);
      if (k >= 1 && !this.hasGoal) this.marker.visible = false;
    }
  }

  /** 앞이 막히면 비스듬히(벽을 따라) 돌아간다. 조금이라도 움직였으면 true */
  private walk(pos: THREE.Vector3, dir: THREE.Vector3, step: number): boolean {
    let y = this.tryStep(pos, dir, step);
    if (y === null) {
      const d = this.slide;
      outer: for (const a of SLIDE_ANGLES) {
        for (const side of [this.slideSide, -this.slideSide]) {
          const c = Math.cos(a * side), s = Math.sin(a * side);
          d.set(dir.x * c + dir.z * s, 0, -dir.x * s + dir.z * c);
          // 비스듬할수록 덜 나아간다(벽을 긁듯이)
          y = this.tryStep(pos, d, step * Math.cos(a));
          if (y !== null) {
            this.slideSide = side;
            step *= Math.cos(a);
            dir.copy(d);
            break outer;
          }
        }
      }
      if (y === null) return false;
    }
    pos.addScaledVector(dir, step);
    if (!this.airborne) pos.y = y;
    return true;
  }

  /** 지나가는 차와 겹치면 차 옆으로 밀어낸다(차 좌표에서 가장 덜 파고든 쪽으로) */
  private avoidCars(): void {
    if (!this.cars.length) return;
    const pos = this.avatar.position;
    const group = this.stage!.group;
    for (const { obj, box } of this.cars) {
      const p = obj.worldToLocal(group.localToWorld(this.v1.copy(pos)));
      const r = BODY_RADIUS / obj.getWorldScale(this.v2).x;
      if (p.y > box.max.y || p.y + HEIGHT < box.min.y) continue;
      const px = Math.min(p.x - box.min.x + r, box.max.x + r - p.x);
      const pz = Math.min(p.z - box.min.z + r, box.max.z + r - p.z);
      if (px <= 0 || pz <= 0) continue;
      if (px < pz) p.x = p.x - box.min.x < box.max.x - p.x ? box.min.x - r : box.max.x + r;
      else p.z = p.z - box.min.z < box.max.z - p.z ? box.min.z - r : box.max.z + r;
      group.worldToLocal(obj.localToWorld(p));
      const g = this.groundAt(p.x, pos.y + HEIGHT, p.z);
      if (!g || g.water || !this.inBounds(p.x, p.z)) continue;
      pos.set(p.x, this.airborne ? Math.max(pos.y, g.y) : g.y, p.z);
      this.hasGoal = false;
    }
  }

  /** 공중에서 한 프레임: 발밑 땅에 닿으면 내려선다 */
  private fall(dt: number): void {
    const pos = this.avatar.position;
    this.vy -= GRAVITY * dt;
    const next = pos.y + this.vy * dt;
    if (this.vy > 0) {
      pos.y = next;
      return;
    }
    // 이번 프레임에 내려갈 만큼 위에서부터 아래로 본다
    const g = this.groundAt(pos.x, pos.y + 0.05, pos.z);
    if (!g || next <= g.y) {
      if (g) pos.y = g.y;
      this.airborne = false;
      this.vy = 0;
    } else pos.y = next;
  }

  /** 가장 가까운 것 하나만(BVH 가 메시마다 첫 교차에서 멈춘다) */
  private firstHit(): THREE.Intersection | undefined {
    this.ray.firstHitOnly = true;
    const far = this.ray.far;
    let hit = this.ray.intersectObjects(this.solid, false)[0];
    // 합친 덩어리 안의 덤불 면은 지나쳐서 그 뒤를 다시 본다
    for (let i = 0; hit && i < 4 && isSoftFace(hit); i++) {
      this.ray.ray.origin.copy(hit.point).addScaledVector(this.ray.ray.direction, 1e-3);
      this.ray.far = far - hit.distance;
      const next = this.ray.intersectObjects(this.solid, false)[0];
      if (next) next.distance += far - this.ray.far;
      hit = next;
    }
    this.ray.far = far;
    this.ray.firstHitOnly = false;
    return hit;
  }

  /** dir 으로 step 만큼 갈 수 있으면 새 발 높이, 막히면 null */
  private tryStep(pos: THREE.Vector3, dir: THREE.Vector3, step: number): number | null {
    const nx = pos.x + dir.x * step;
    const nz = pos.z + dir.z * step;
    if (!this.inBounds(nx, nz)) return null;
    // 무릎 높이에서 앞으로: 벽·줄기·바위
    const group = this.stage!.group;
    // 공중이면 발끝만 걸리지 않게 낮게 본다(뛰어오르는 중에 턱 위로 넘어간다)
    const from = group.localToWorld(this.v1.set(pos.x, pos.y + (this.airborne ? 0.04 : STEP_UP + 0.04), pos.z));
    this.ray.set(from, dir);
    this.ray.far = step + REACH;
    const wall = this.firstHit();
    this.ray.far = Infinity;
    if (wall) return null;
    // 머리 위(나뭇가지·처마)는 무시하고 발밑만 본다
    const g = this.groundAt(nx, pos.y + HEIGHT, nz);
    if (!g || g.water) return null;
    if (this.airborne) return g.y > pos.y + 0.02 || g.y < pos.y - STEP_DOWN - 0.3 ? null : g.y;
    if (g.y > pos.y + STEP_UP || g.y < pos.y - STEP_DOWN) return null;
    return g.y;
  }

  /** (x, z) 에서 높이 fromY 부터 아래로 처음 닿는 곳(테마 무리 좌표) */
  private groundAt(x: number, fromY: number, z: number): { y: number; water: boolean } | null {
    const group = this.stage!.group;
    this.ray.set(group.localToWorld(this.v2.set(x, fromY, z)), Explorer.DOWN);
    const hit = this.firstHit();
    if (!hit) return null;
    return { y: group.worldToLocal(hit.point).y, water: isWater(hit.object) };
  }

  private inBounds(x: number, z: number): boolean {
    const s = this.stage!;
    // 받침에 올린 디오라마: 받침 안에서만
    if (s.setCase && s.kind === 'floating') return Math.max(Math.abs(x), Math.abs(z)) < TILE_HALF - 0.15;
    if (s.kind === 'ground') return Math.hypot(x, z) < LAND_RADIUS;
    // 하늘섬은 땅 끝(광선이 비면)에서 막힌다
    return true;
  }

  /** 기준점 둘레를 돌며 처음 나오는 마른 땅 */
  private findSpawn(stage: Stage): THREE.Vector3 | null {
    const c = stage.view.target;
    for (let r = 0; r <= 5; r += 0.5) {
      const n = r === 0 ? 1 : Math.ceil(r * 8);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        if (!this.inBounds(x, z)) continue;
        const g = this.groundAt(x, 30, z);
        if (!g || g.water) continue;
        // 지붕·나무·연잎 위가 아니라 넓은 땅인지: 사방 조금 떨어진 곳도 마른 땅이고 높이가 비슷해야 한다
        const flat = [[0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].every(([dx, dz]) => {
          const side = this.groundAt(x + dx, 30, z + dz);
          return side && !side.water && Math.abs(side.y - g.y) < 0.08;
        });
        if (flat) return new THREE.Vector3(x, g.y, z);
      }
    }
    return null;
  }
}

/** 덤불·꽃 재질의 면(굽기 전에 땅과 한 덩어리로 합쳐져서 물체 이름으로는 못 거른다) */
function isSoftFace(hit: THREE.Intersection): boolean {
  const mat = (hit.object as THREE.Mesh).material;
  const m = Array.isArray(mat) ? mat[hit.face?.materialIndex ?? 0] : mat;
  return SOFT_MAT.test(m?.name ?? '');
}

/** 글자 대신 자판 위치(e.code)로 본다. 한글 입력 상태면 e.key 가 'ㅈ'·'Process' 로 들어온다 */
function moveKey(code: string): 'f' | 'b' | 'l' | 'r' | null {
  switch (code) {
    case 'KeyW': case 'ArrowUp': return 'f';
    case 'KeyS': case 'ArrowDown': return 'b';
    case 'KeyA': case 'ArrowLeft': return 'l';
    case 'KeyD': case 'ArrowRight': return 'r';
  }
  return null;
}

/** 물체 자기 좌표에서 본 메시 전체의 크기 상자 */
function localBox(o: THREE.Object3D): THREE.Box3 {
  o.updateWorldMatrix(true, true);
  const inv = o.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  o.traverse((c) => {
    const geo = (c as THREE.Mesh).geometry;
    if (!(c as THREE.Mesh).isMesh || !geo) return;
    geo.boundingBox ?? geo.computeBoundingBox();
    box.union(geo.boundingBox!.clone().applyMatrix4(m.multiplyMatrices(inv, c.matrixWorld)));
  });
  return box;
}

function boundRadius(o: THREE.Object3D): number {
  const geo = (o as THREE.Mesh).geometry;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  return geo.boundingSphere!.radius * o.getWorldScale(new THREE.Vector3()).x;
}

function isWater(o: THREE.Object3D): boolean {
  const m = (o as THREE.Mesh).material as THREE.Material;
  return o.name.startsWith('liquid_') || (m as THREE.ShaderMaterial).isShaderMaterial === true;
}

/** 시안 전 임시 캐릭터: 몸통 + 머리 + 작은 모자. 발이 원점에 닿는다 */
function placeholderFigure(): THREE.Group {
  const g = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ color: '#e8a33d', roughness: 0.8 });
  const skin = new THREE.MeshStandardMaterial({ color: '#f3d3b5', roughness: 0.9 });
  const hat = new THREE.MeshStandardMaterial({ color: '#3d6b8c', roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.1, 4, 10), coat);
  body.position.y = 0.115;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), skin);
  head.position.y = 0.27;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.08, 12), hat);
  cap.position.y = 0.345;
  // 앞(+z)을 알 수 있게 코 하나
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), skin);
  nose.position.set(0, 0.265, 0.068);
  for (const m of [body, head, cap, nose]) {
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
