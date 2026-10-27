import * as THREE from 'three';
import type { Env } from './env';
import { islandBob, mesh, ribbon, waterBrightness, Waterfall, type Stage } from './kit';
import { Actor, BakedMaterial, baked, prop } from './models';
import { pondMaterial, riverMaterial } from './water';
import { mulberry32, smoothstep, softSprite } from '../util';

/**
 * 포켓몬 테마 네 장면. 건물·벤치·가로등·나무 같은 요소를 하나씩 모델로 만들어(public/models/parts)
 * Blender 에서 디오라마로 조합하고, 낮·밤 빛을 텍스처에 구워 넣었다(public/models/env, 만드는 법은 tools/diorama).
 * 앱은 구운 디오라마를 그대로 보여 주고, 그 위에 포켓몬·물·안개·불빛만 실시간으로 얹는다.
 * 요소는 움직이지 않고, 포켓몬만 제자리에서 서로 어울려 논다.
 *
 * 배치는 Blender 좌표(x: 오른쪽, y: 안쪽, h: 높이)로 적는다. 카메라는 Blender 의 -y 쪽(앞)에서 본다.
 * Tripo 로 만든 GLB 는 정면이 +z, 리깅(Meshy)을 거친 GLB 는 정면이 +x 다.
 */
const FLAME_COLOR = new THREE.Color('#ffae3d');

/** Blender 좌표(x, y, 높이)를 장면 좌표로. glTF 로 내보내면 Blender 의 -Y 가 +z 가 된다 */
const fromBlender = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

/** 디오라마 반지름(Blender 장면의 R) */
const R = 3.3;
/** Blender 카메라와 같은 방향(가운데→카메라) */
const CAM_DIR = new THREE.Vector3(5.2, 6.6, 9.4).normalize();

/** 정면이 +z 인 모델이 dir 쪽을 보게 하는 y 회전 */
const yawZ = (dx: number, dz: number) => Math.atan2(dx, dz);
/** 정면이 +x 인 모델이 dir 쪽을 보게 하는 y 회전 */
const yawX = (dx: number, dz: number) => Math.atan2(-dz, dx);
/** 카메라를 보는 방향 */
const TO_CAMERA = new THREE.Vector3(CAM_DIR.x, 0, CAM_DIR.z).normalize();

/** 파이리 꼬리불: 깜빡이는 빛 덩어리와 주변을 비추는 점광원 */
class TailFlame {
  readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softSprite(), color: FLAME_COLOR, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  readonly light = new THREE.PointLight(FLAME_COLOR, 0, 3, 1.6);

  constructor(parent: THREE.Object3D, x: number, y: number, z: number, private readonly size: number) {
    this.sprite.position.set(x, y, z);
    this.light.position.set(x, y, z);
    parent.add(this.sprite, this.light);
  }

  update(t: number, env: Env): void {
    const wet = Math.max(env.rain, env.snow);
    const fire = (1 - wet * 0.55) * (0.85 + Math.sin(t * 17) * 0.08 + Math.sin(t * 29) * 0.07);
    this.sprite.scale.setScalar(this.size * fire);
    this.light.intensity = (0.3 + env.nightLights * 2.2) * fire;
  }
}

/** 기술 효과: 한 점에서 퍼져 나가며 사라지는 빛 알갱이들 */
class Burst {
  private readonly points: THREE.Points;
  private readonly mat: THREE.PointsMaterial;
  private readonly vel: THREE.Vector3[] = [];
  private age = 99;

  constructor(parent: THREE.Object3D, count = 26) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    this.mat = new THREE.PointsMaterial({
      map: softSprite(), size: 0.3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    for (let i = 0; i < count; i++) this.vel.push(new THREE.Vector3());
    parent.add(this.points);
  }

  fire(where: THREE.Vector3, color: THREE.ColorRepresentation, spread = 1.4): void {
    this.age = 0;
    this.mat.color.set(color);
    this.points.position.copy(where);
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.vel.forEach((v, i) => {
      v.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(spread * (0.5 + Math.random()));
      pos.setXYZ(i, 0, 0, 0);
    });
    pos.needsUpdate = true;
    this.points.visible = true;
  }

  update(dt: number): void {
    if (!this.points.visible) return;
    this.age += dt;
    const pos = this.points.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.vel.forEach((v, i) => {
      v.y -= dt * 1.5;
      pos.setXYZ(i, pos.getX(i) + v.x * dt, pos.getY(i) + v.y * dt, pos.getZ(i) + v.z * dt);
    });
    pos.needsUpdate = true;
    this.mat.opacity = Math.max(0, 1 - this.age / 0.8);
    this.points.visible = this.age < 0.8;
  }
}

/**
 * 낮게 깔려 천천히 흘러가는 안개구름. 안개 낀 날·아침·비 올 때 짙어지고,
 * 물가에 두면 물안개처럼 보인다.
 */
class Mist {
  readonly group = new THREE.Group();
  private readonly puffs: { s: THREE.Sprite; x: number; z: number; speed: number; phase: number }[] = [];
  private readonly mat = new THREE.SpriteMaterial({ map: softSprite(), color: '#ffffff', transparent: true, opacity: 0, depthWrite: false });

  constructor(count: number, private readonly radius: number, private readonly height: number, private readonly base: number, seed = 5) {
    const rng = mulberry32(seed);
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(this.mat);
      const size = 1.6 + rng() * 2.2;
      s.scale.set(size, size * 0.45, 1);
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      this.puffs.push({ s, x: Math.cos(a) * r, z: Math.sin(a) * r, speed: 0.08 + rng() * 0.1, phase: rng() * 10 });
      this.group.add(s);
    }
  }

  update(dt: number, t: number, env: Env): void {
    const thick = this.base + env.fog * 0.45 + env.rain * 0.12 + Math.max(0, 0.3 - Math.abs(env.sunElevation - 0.3)) * 0.4;
    this.mat.opacity = Math.min(0.6, thick);
    this.mat.color.copy(env.skyBottom).lerp(new THREE.Color('#ffffff'), 0.6);
    this.group.visible = this.mat.opacity > 0.02;
    const r = this.radius;
    for (const p of this.puffs) {
      // 바람 방향으로 흘러가고, 가장자리를 넘으면 반대편에서 다시 들어온다
      p.x += (env.windX * 0.6 + 0.15) * p.speed * dt * 3;
      p.z += (env.windZ * 0.6 + 0.1) * p.speed * dt * 3;
      if (p.x * p.x + p.z * p.z > r * r) {
        p.x = -p.x * 0.95;
        p.z = -p.z * 0.95;
      }
      p.s.position.set(p.x, this.height + Math.sin(t * 0.4 + p.phase) * 0.08, p.z);
    }
  }
}

/** 텍스처 색 그대로 k 만큼 스스로 빛나게 한다(조명 색에 덜 물들게) */
function selfLit(obj: THREE.Object3D, k: number): void {
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m?.isMeshStandardMaterial || !m.map) return;
    if (m.emissiveMap !== m.map) {
      m.emissiveMap = m.map;
      m.emissive.set('#ffffff');
      m.needsUpdate = true;
    }
    m.emissiveIntensity = k;
  });
}

/** 숨쉬듯 부풀었다 줄어드는 코드 동작(뼈대 없는 캐릭터용) */
function breathe(obj: THREE.Object3D, t: number, rate: number, amount: number, phase = 0): void {
  const s = Math.sin(t * rate + phase);
  obj.scale.set(1 + s * amount * 0.6, 1 + s * amount, 1 + s * amount * 0.6);
}

/**
 * 한자리에 모여 노는 포켓몬들. 돌아다니지 않고, 돌아가며 한 명씩 손을 흔들거나 깡충 뛰면
 * 나머지가 그쪽을 돌아본다. 뼈대 없는 친구(prop)는 몸을 통통 튕기는 것으로 대신한다.
 */
class Playmates {
  private readonly members: { obj: THREE.Object3D; actor?: Actor; home: THREE.Vector3; hop: number; front: 'x' | 'z' }[] = [];
  private turn = 0;
  private next = 2;
  private focus = -1;

  add(obj: THREE.Object3D, actor: Actor | undefined, front: 'x' | 'z'): void {
    this.members.push({ obj, actor, home: obj.position.clone(), hop: 0, front });
  }

  update(dt: number, t: number, quiet: boolean): void {
    const ms = this.members;
    if (!ms.length) return;
    // 모인 가운데
    const mid = new THREE.Vector3();
    for (const m of ms) mid.add(m.home);
    mid.divideScalar(ms.length);

    this.next -= dt;
    if (this.next <= 0 && !quiet) {
      this.next = 2.2 + Math.random() * 2.6;
      this.focus = this.turn++ % ms.length;
      const m = ms[this.focus];
      if (m.actor) m.actor.play(Math.random() < 0.5 ? 'wave' : 'jump');
      else m.hop = 0.5;
    }
    ms.forEach((m, i) => {
      // 차례인 친구는 카메라 쪽(관객)을, 나머지는 차례인 친구를 본다. 차례가 없으면 가운데를 본다
      const look = i === this.focus ? m.home.clone().add(TO_CAMERA) : this.focus >= 0 ? ms[this.focus].home : mid;
      const dx = look.x - m.home.x, dz = look.z - m.home.z;
      const want = m.front === 'x' ? yawX(dx, dz) : yawZ(dx, dz);
      const r = m.obj.rotation;
      r.y += Math.atan2(Math.sin(want - r.y), Math.cos(want - r.y)) * Math.min(1, dt * 3);
      if (!m.actor) {
        m.hop = Math.max(0, m.hop - dt);
        m.obj.position.y = m.home.y + Math.sin((m.hop / 0.5) * Math.PI) * 0.22;
        breathe(m.obj, t, 2, 0.025, i);
      }
    });
  }
}

/**
 * 네 장면 공통: 구운 디오라마(env/<name>.glb)를 띄우고, 포켓몬·불빛·안개를 얹는다.
 * Blender 카메라와 같은 각도로 보고, 좌우로 조금만 돌릴 수 있다.
 */
abstract class BakedScene implements Stage {
  readonly group = new THREE.Group();
  readonly kind = 'floating' as const;
  readonly view: Stage['view'];
  protected readonly actors: Actor[] = [];
  protected readonly play = new Playmates();
  /** 구운 배경과 색을 맞추려고 제 색으로 조금 빛나게 하는 실시간 모델 */
  protected readonly lit: THREE.Object3D[] = [];
  protected readonly mist = new Mist(12, 5.2, 0.55, 0.04);
  /** 0 낮 ~ 1 밤: 구운 텍스처를 섞는 정도 */
  protected night = 0;
  private mats: BakedMaterial[] = [];
  private readonly lights: { light: THREE.PointLight; power: number }[] = [];
  private readonly tint = new THREE.Color();

  constructor(name: string, target: THREE.Vector3, dir = CAM_DIR) {
    this.view = { target, distance: 9.5, minUp: 0.3, dir: dir.clone(), lock: 0.45 };
    this.group.add(baked(`env/${name}`, (m) => (this.mats = m)));
    // 구운 바닥은 빛을 받지 않으니, 포켓몬 그림자만 받는 투명한 판을 위에 깐다
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), new THREE.ShadowMaterial({ opacity: 0.28 }));
    shadow.position.y = 0.016;
    shadow.receiveShadow = true;
    // 안개 크기는 예전 큰 섬 기준이라 디오라마 크기에 맞춰 줄인다
    this.mist.group.scale.setScalar(0.6);
    this.group.add(shadow, this.mist.group);
  }

  /** 카메라 쪽을 보는 방향 */
  protected get face(): number {
    return yawX(this.view.dir!.x, this.view.dir!.z);
  }

  /** 리깅된 포켓몬(Blender 좌표) */
  protected actor(name: string, height: number, x: number, y: number, h = 0.012, playing = true): Actor {
    const a = new Actor(name, height);
    a.group.position.copy(fromBlender(x, y, h));
    a.group.rotation.y = this.face;
    this.group.add(a.group);
    this.actors.push(a);
    this.lit.push(a.group);
    if (playing) this.play.add(a.group, a, 'x');
    return a;
  }

  /** 뼈대 없는 포켓몬(Blender 좌표) */
  protected critter(name: string, height: number, x: number, y: number, h = 0.012, playing = true): THREE.Group {
    const g = prop(name, height);
    g.position.copy(fromBlender(x, y, h));
    g.rotation.y = this.face + Math.PI / 2;
    this.group.add(g);
    this.lit.push(g);
    if (playing) this.play.add(g, undefined, 'z');
    return g;
  }

  /** 밤에 켜져 포켓몬을 비추는 불빛(배경의 불빛은 이미 구워져 있다) */
  protected glow(x: number, y: number, h: number, color: THREE.ColorRepresentation, power = 1.6, range = 3): void {
    const light = new THREE.PointLight(color, 0, range, 1.6);
    light.position.copy(fromBlender(x, y, h));
    this.group.add(light);
    this.lights.push({ light, power });
  }

  update(dt: number, t: number, env: Env): void {
    this.night = smoothstep(0.3, 0.95, env.nightLights);
    // 흐리거나 비가 오면 구운 낮빛을 조금 가라앉힌다
    const dim = 1 - env.overcast * 0.3 * (1 - this.night);
    this.tint.setRGB(dim, dim, dim * (1 + env.overcast * 0.04));
    for (const m of this.mats) {
      m.uniforms.mixNight.value = this.night;
      m.uniforms.tint.value.copy(this.tint);
    }
    for (const l of this.lights) l.light.intensity = this.night * l.power;
    // 캐릭터는 실시간 조명을 받아 노을빛에 주황으로 물든다. 제 색으로 조금 빛나게 해 구운 배경과 맞춘다
    const own = 0.35 + env.nightLights * (1 - this.night) * 0.35;
    for (const o of this.lit) selfLit(o, own);
    for (const a of this.actors) a.update(dt);
    // 밤이나 궂은 날엔 덜 논다
    this.play.update(dt, t, this.night > 0.9 || Math.max(env.rain, env.snow) > 0.5);
    this.mist.update(dt, t, env);
    this.tick(dt, t, env);
    this.group.position.y = islandBob(t);
  }

  protected tick(_dt: number, _t: number, _env: Env): void {}
}

/** 상록시티: 모래 광장을 센터·숍·체육관·집이 둘러싸고, 가운데서 넷이 모여 논다 */
export class ViridianCity extends BakedScene {
  private readonly flame: TailFlame;
  private readonly pond = pondMaterial();

  constructor() {
    super('city', new THREE.Vector3(0, 0.4, -0.1));
    this.actor('pikachu', 0.27, -0.1, -0.2);
    this.actor('squirtle', 0.3, 0.5, -0.15);
    this.critter('bulbasaur', 0.27, 0.0, -0.75);
    const ch = this.critter('charmander', 0.33, 0.55, -0.7);
    this.flame = new TailFlame(ch, 0, 0.19, -0.13, 0.12);

    // 왼쪽 앞 작은 연못
    const water = mesh(new THREE.CircleGeometry(0.5, 48).rotateX(-Math.PI / 2), this.pond, false);
    water.position.copy(fromBlender(-1.75, -2.05, 0.024));
    this.group.add(water);

    this.glow(-0.95, -0.95, 0.68, '#ffd9a8');
    this.glow(1.55, -1.25, 0.68, '#ffd9a8');
    this.glow(0.45, 1.2, 0.45, '#ffe2b0', 1.2, 2.5);
  }

  protected tick(_dt: number, t: number, env: Env): void {
    this.pond.uniforms.time.value = t;
    this.pond.uniforms.bright.value = waterBrightness(env);
    this.flame.update(t, env);
  }
}

/**
 * 포켓몬센터: 유리 돔 센터 앞 광장. 럭키와 벤치 위 피카츄가 서로 보며 놀고, 잠만보는 옆에서 잔다.
 */
export class PokemonCenter extends BakedScene {
  private readonly snorlax: THREE.Group;

  constructor() {
    super('center', new THREE.Vector3(0, 0.45, -0.1), new THREE.Vector3(5.2, 6.05, 9.5).normalize());
    this.actor('chansey', 0.62, -0.55, -0.1);
    this.actor('pikachu', 0.36, 1.0, -0.15, 0.22);
    this.snorlax = this.critter('snorlax', 0.8, 2.35, -0.05, 0.004, false);
    this.snorlax.rotation.y -= 0.5;
    this.glow(0.15, -0.3, 0.6, '#ffc98a', 2.2, 3.5);
  }

  protected tick(_dt: number, t: number): void {
    breathe(this.snorlax, t, 1.1, 0.03);
  }
}

/** 체육관 배틀: 경기장 양쪽에서 피카츄와 파이리(비 오는 날은 꼬부기)가 번갈아 기술을 쓴다 */
export class GymBattle extends BakedScene {
  private readonly pikachu: Actor;
  private readonly squirtle: Actor;
  private readonly charmander: THREE.Group;
  private readonly flame: TailFlame;
  private readonly burst: Burst;
  private readonly left = fromBlender(-1.1, -0.2);
  private readonly right = fromBlender(1.1, -0.2);
  private turn = 0;
  private next = 3;
  private hop = 0;

  constructor() {
    super('battle', new THREE.Vector3(0, 0.3, 0));
    // 서로 마주 보되 카메라 쪽으로 살짝 돌아선다
    const toward = (dx: number) => yawX(dx, 0.45);
    this.pikachu = this.actor('pikachu', 0.4, -1.1, -0.2, 0.012, false);
    this.pikachu.group.rotation.y = toward(1);
    this.squirtle = this.actor('squirtle', 0.42, 1.1, -0.2, 0.012, false);
    this.squirtle.group.rotation.y = toward(-1);
    this.charmander = this.critter('charmander', 0.46, 1.1, -0.2, 0.012, false);
    this.charmander.rotation.y = yawZ(-1, 0.45);
    this.flame = new TailFlame(this.charmander, 0, 0.27, -0.18, 0.16);
    this.burst = new Burst(this.group);
    this.glow(-2.5, 1.6, 1.75, '#fff1d0', 2.5, 6);
    this.glow(2.5, 1.6, 1.75, '#fff1d0', 2.5, 6);
  }

  protected tick(dt: number, t: number, env: Env): void {
    const rainy = env.rain > 0.3;
    this.charmander.visible = !rainy;
    this.squirtle.group.visible = rainy;
    breathe(this.charmander, t, 2.4, 0.03);
    if (this.hop > 0) {
      this.hop = Math.max(0, this.hop - dt);
      this.charmander.position.y = this.right.y + 0.012 + Math.sin((this.hop / 0.4) * Math.PI) * 0.14;
      if (this.hop === 0) this.burst.fire(this.aim(this.left), '#ff8a3a');
    }
    this.flame.update(t, env);
    this.burst.update(dt);

    // 밤에는 쉰다
    if (this.night > 0.9) return;
    this.next -= dt;
    if (this.next > 0) return;
    this.next = 2.5 + Math.random() * 2.5;
    if (this.turn++ % 2 === 0) this.pikachu.play('jump', () => this.burst.fire(this.aim(this.right), '#ffe14a'));
    else if (rainy) this.squirtle.play('jump', () => this.burst.fire(this.aim(this.left), '#7fd0ff'));
    else this.hop = 0.4;
  }

  /** 기술이 맞는 자리: 상대 몸통 높이 */
  private aim(p: THREE.Vector3): THREE.Vector3 {
    return p.clone().setY(0.25);
  }
}

/** 노을 호수 언덕 높이(Blender scene_lake.py 의 hill_z 와 같은 식) */
const HILL = { x: -1.1, y: 1.0, h: 0.95, spread: 2.6 };
const POND = { x: 1.0, y: -0.9, r: 1.25 };
function hillZ(x: number, y: number): number {
  const z = HILL.h * Math.exp(-((x - HILL.x) ** 2 + (y - HILL.y) ** 2) / HILL.spread);
  const d = Math.hypot(x - POND.x, y - POND.y);
  const rim = 1 - (Math.hypot(x, y) / R) ** 6;
  return z * Math.min(1, Math.max(0, (d - POND.r - 0.3) / 0.8)) * Math.max(0, rim) + 0.006;
}

/**
 * 노을 호수: 언덕 위 큰 나무 아래 피카츄와 이상해씨, 연못엔 라프라스.
 * 뒤쪽 시냇물이 연못으로 흘러들고, 넘친 물은 섬 가장자리 폭포로 구름바다에 떨어진다. 물 위엔 물안개.
 */
export class ScenicLake extends BakedScene {
  private readonly pond = pondMaterial();
  private readonly stream = riverMaterial();
  private readonly spill = riverMaterial();
  private readonly fall: Waterfall;
  private readonly lapras: THREE.Group;
  private readonly waterMist = new Mist(8, 2.1, 0.25, 0.12, 9);
  private readonly flies: THREE.Points;
  private readonly flyMat: THREE.PointsMaterial;

  constructor() {
    super('lake', new THREE.Vector3(0, 0.45, -0.1));
    const center = fromBlender(POND.x, POND.y);
    const water = mesh(new THREE.CircleGeometry(POND.r, 64).rotateX(-Math.PI / 2), this.pond, false);
    water.position.copy(center).setY(0.03);
    this.group.add(water);

    // 시냇물: 섬 뒤쪽 언덕 옆으로 굽이쳐 연못으로. 땅 높이를 따라 흐른다
    const onGround = ([x, y]: number[]) => fromBlender(x, y, hillZ(x, y) + 0.018);
    const stream = new THREE.CatmullRomCurve3([[1.3, 2.9], [1.55, 2.1], [1.2, 1.3], [1.35, 0.75], [1.1, 0.25]].map(onGround));
    this.group.add(new THREE.Mesh(ribbon(stream, 0.32, 70, null), this.stream));

    // 연못에서 넘친 물이 앞쪽 가장자리로 흘러 떨어진다
    const dir = new THREE.Vector2(0.26, -0.97).normalize();
    const along = (s: number) => [POND.x + dir.x * s, POND.y + dir.y * s];
    const spill = new THREE.CatmullRomCurve3([1.0, 1.5, 2.08].map((s) => onGround(along(s))));
    this.group.add(new THREE.Mesh(ribbon(spill, 0.3, 30, null), this.spill));
    const [ex, ey] = along(2.1);
    const outward = new THREE.Vector3(ex, 0, -ey).normalize();
    this.fall = new Waterfall({ origin: fromBlender(ex, ey, 0.01), outward, width: 0.28, length: 2.6, reach: 0.45 }, mulberry32(3), 70);
    this.group.add(this.fall.group);

    this.actor('pikachu', 0.34, -0.75, 0.6, hillZ(-0.75, 0.6));
    this.critter('bulbasaur', 0.32, -0.35, 0.75, hillZ(-0.35, 0.75));
    this.lapras = this.critter('lapras', 0.75, POND.x, POND.y, 0, false);

    // 물 위에만 낮게 깔리는 물안개(안개는 0.6 배로 줄인 크기 기준)
    this.waterMist.group.position.copy(center);
    this.waterMist.group.scale.setScalar(0.6);
    this.group.add(this.waterMist.group);

    const count = 40;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const rng = mulberry32(17);
    for (let i = 0; i < count; i++) pos.set([(rng() - 0.5) * 5.5, 0.3 + rng() * 1.4, (rng() - 0.5) * 5.5], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.flyMat = new THREE.PointsMaterial({
      map: softSprite(), size: 0.1, color: '#d8ff7a', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.flies = new THREE.Points(geo, this.flyMat);
    this.group.add(this.flies);
    this.glow(POND.x, POND.y, 0.9, '#9fc8ff', 0.8, 3);
  }

  protected tick(dt: number, t: number, env: Env): void {
    const bright = waterBrightness(env);
    for (const m of [this.pond, this.stream, this.spill]) {
      m.uniforms.time.value = t;
      m.uniforms.bright.value = bright;
    }
    this.fall.update(dt, t, bright);
    this.waterMist.update(dt, t, env);

    // 라프라스: 연못 가운데서 물결 따라 살짝 오르내리고 고개를 천천히 돌린다
    this.lapras.position.y = -0.04 + Math.sin(t * 1.3) * 0.02;
    this.lapras.rotation.z = Math.sin(t * 1.3) * 0.03;
    this.lapras.rotation.y = this.face + Math.PI / 2 - 0.6 + Math.sin(t * 0.25) * 0.35;
    // 라프라스 둘레로 물결이 번진다(연못 uv: 중심 0.5)
    this.pond.uniforms.ripple.value.set(0.5, 0.5);

    // 반딧불이: 밤에만
    this.flyMat.opacity = this.night * (1 - Math.max(env.rain, env.snow)) * (0.7 + Math.sin(t * 3) * 0.3);
    this.flies.visible = this.flyMat.opacity > 0.02;
    this.flies.rotation.y = t * 0.03;
  }
}
