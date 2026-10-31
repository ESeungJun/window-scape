import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import type { Condition, Season, TimeOfDay } from '../data/weather';
import { mulberry32, lerp } from '../util';
import { Clouds } from './clouds';
import { composeEnv, copyEnv, createEnv, lerpEnv, type Env, type LiveWeather } from './env';
import { FLOATING_VIEW, Floaters, updateSharedMaterials, type Stage } from './kit';
import { createStage, type Theme } from './themes';
import { Precipitation } from './precipitation';
import { SkyDome, SkyLight } from './sky';
import { updateSkyTint } from './baked';
import { Explorer } from './explore';

export type Quality = 'auto' | 'low' | 'medium' | 'high';

const SUN_AZIMUTH = 0.9;
const AUTO_ROTATE_DELAY_MS = 6000;
/** 들어가기 모드: 카메라가 캐릭터 뒤 위쪽에서 따라가는 거리·내려다보는 각도, 들어가고 나오는 데 걸리는 시간 */
const EXPLORE_DISTANCE = 2.6;
/** 대관람차를 탔을 때 카메라 거리 */
const RIDE_DISTANCE = 3.6;
const EXPLORE_PITCH = 0.42;
const EXPLORE_FLY_S = 1.1;
/** 이만큼 안 움직이고 뗀 포인터는 클릭(걸어가기), 더 움직이면 시점 돌리기 */
const CLICK_SLOP_PX = 6;
/** 카메라 가림 검사 광선(카메라 자리에서 옆·위로 벌린 정도) */
const CLEAR_RAYS: [number, number][] = [[0, 0], [0.45, 0.3], [-0.45, 0.3], [0.45, -0.3], [-0.45, -0.3]];

/** 렌더러·카메라·조명과 장면 구성 요소를 묶고 매 프레임 연출 값을 반영한다. */
export class World {
  onFrame?: (env: Env) => void;
  /** 들어가기 모드가 켜지거나 꺼질 때 */
  onExplore?: (on: boolean) => void;
  /** 들어가기 모드에서 탈것(대관람차)에 타거나 내릴 때 */
  onRide?: (on: boolean) => void;

  private readonly env: Env = createEnv();
  private readonly target: Env = createEnv();
  private readonly renderer: THREE.WebGLRenderer;
  /** 맞닿은 곳·틈을 은은하게 어둡게(앰비언트 오클루전) 해 장난감 디오라마 같은 깊이를 준다. 화질 '낮음'에서는 끈다 */
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private useComposer = false;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#b9c3cc', 1);
  private readonly fog = new THREE.Fog('#ffffff', 45, 150);
  private readonly sky = new SkyDome();
  /** 하늘 그라데이션 환경광. 실시간 장면 전체와, 구운 장면에서 라이트맵이 없는 것(구름·떠다니는 섬·덩굴)을 비춘다 */
  private readonly skyLight: SkyLight;
  private skyEnv: THREE.Texture | null = null;
  private readonly clouds: Clouds;
  private readonly floaters: Floaters;
  private viewScale = 1;
  /** 한 번 만든 테마는 보관해 두고 다시 고를 때 재사용한다 */
  private readonly stages = new Map<Theme, Stage>();
  private stage: Stage;
  /** 땅 테마를 디오라마 모양으로 볼지 */
  private cased = false;
  private readonly precip: Precipitation;
  private readonly sunDir = new THREE.Vector3();
  private last = performance.now() / 1000;
  private time = 0;
  private idleTimer = 0;
  private quality: Quality = 'auto';
  private minFrameTime = 0;
  private qualityKey = '';
  private readonly shadowCenter = new THREE.Vector3();
  private readonly focusPoint = new THREE.Vector3();
  private readonly focusDelta = new THREE.Vector3();
  private static readonly ORIGIN = new THREE.Vector3();
  private readonly explorer = new Explorer();
  /** 들어가기 전 카메라(나올 때 돌아갈 자리) */
  private readonly saved = { pos: new THREE.Vector3(), target: new THREE.Vector3(), min: 0, max: 0, polar: 0 };
  /** 들어가고 나오는 카메라 이동. 0~1 로 진행하고, 끝나면 null */
  private fly: { t: number; leaving: boolean; pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private readonly followPoint = new THREE.Vector3();
  private readonly flyPos = new THREE.Vector3();
  private readonly flyTarget = new THREE.Vector3();
  /** 들어가기 모드에서 사용자가 고른 카메라 거리(휠로 바꾼다). 물체에 가리면 실제로는 그보다 당겨 온다 */
  private exploreDist = EXPLORE_DISTANCE;
  private camDist = EXPLORE_DISTANCE;
  private readonly camDir = new THREE.Vector3();
  private readonly camSide = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
  private readonly camRay = new THREE.Vector3();

  constructor(private readonly container: HTMLElement, theme: Theme = 'island') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 디오라마 모양: 받침 가장자리에서 장면을 자른다(재질별 clippingPlanes)
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.skyLight = new SkyLight(this.renderer);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = new GTAOPass(this.scene, this.camera);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1 });
    this.ao.blendIntensity = 0.85;
    // 빛줄기·물·물보라 같은 반투명 물체는 오클루전 계산에서 뺀다(넣으면 둘레에 윤곽선이 생긴다)
    const ao = this.ao as unknown as { scene: THREE.Scene; _visibilityCache: THREE.Object3D[]; _overrideVisibility(): void };
    ao._overrideVisibility = () => ao.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (o.visible && ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || m?.transparent)) {
        o.visible = false;
        ao._visibilityCache.push(o);
      }
    });
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());

    const narrow = container.clientWidth < container.clientHeight;
    this.camera.position.set(16, 11, 18).multiplyScalar(narrow ? 1.45 : 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -1.5, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.64;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => {
      this.controls.autoRotate = false;
      clearTimeout(this.idleTimer);
    });
    this.controls.addEventListener('end', () => {
      if (this.explorer.active) return;
      this.idleTimer = window.setTimeout(() => (this.controls.autoRotate = true), AUTO_ROTATE_DELAY_MS);
    });
    this.listenClicks(this.renderer.domElement);
    this.explorer.onRide = (on) => {
      // 타면 조금 물러나서 바퀴와 풍경이 같이 보이게
      if (on) this.exploreDist = Math.max(this.exploreDist, RIDE_DISTANCE);
      this.onRide?.(on);
    };
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (!this.explorer.active) return;
      this.exploreDist = THREE.MathUtils.clamp(this.exploreDist * Math.exp(e.deltaY * 0.0015), 1.2, 6);
    }, { passive: true });

    this.sun.shadow.camera.left = -10;
    this.sun.shadow.camera.right = 10;
    this.sun.shadow.camera.top = 10;
    this.sun.shadow.camera.bottom = -10;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    // 그림자 가장자리를 넓게 흐려 부드럽게
    this.sun.shadow.radius = 5;
    this.sun.shadow.blurSamples = 12;

    const rng = mulberry32(7);
    this.floaters = new Floaters(rng);
    this.stage = this.stageFor(theme);
    this.clouds = new Clouds(rng);
    this.precip = new Precipitation(rng);
    this.scene.fog = this.fog;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.sky.group, this.stage.group, this.floaters.group, this.clouds.group, this.precip.group);

    this.applyStageView();
    composeEnv('day', 'partly', 'autumn', this.target);
    copyEnv(this.env, this.target);
    this.applyQuality();

    // 창 크기·회전이 바뀌면 화질 '자동' 판정도 다시 한다
    new ResizeObserver(() => {
      this.applyQuality();
      this.resize();
    }).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** 목표 연출을 바꾼다. 실제 값은 프레임마다 서서히 따라간다. */
  setSelection(time: TimeOfDay, cond: Condition, season: Season, live?: LiveWeather): void {
    composeEnv(time, cond, season, this.target, live);
  }

  /** 테마(풍경)를 바꾼다. 하늘·구름·날씨는 그대로 이어진다. */
  setTheme(theme: Theme): void {
    const next = this.stageFor(theme);
    if (next === this.stage) return;
    this.leave(true);
    this.scene.remove(this.stage.group);
    this.stage = next;
    next.setCase?.(this.cased);
    this.scene.add(next.group);
    this.applyStageView();
  }

  /** 땅 테마의 모양: 디오라마(받침 위, 구름바다에 뜸) / 지평선까지 이어진 땅 */
  setCase(on: boolean): void {
    if (on === this.cased) return;
    this.leave(true);
    this.cased = on;
    if (!this.stage.setCase) return;
    this.stage.setCase(on);
    this.applyStageView();
  }

  /** 테마 종류에 맞춰 구름바다·떠다니는 섬·카메라 범위·그림자 범위를 바꾼다 */
  private applyStageView(): void {
    const floating = this.stage.kind === 'floating';
    // 떠다니는 작은 섬은 하늘섬에만(디오라마 받침 둘레에는 띄우지 않는다)
    this.floaters.group.visible = floating && !this.stage.setCase;
    const c = this.controls;
    c.minDistance = floating ? 14 : 10;
    c.maxDistance = floating ? 45 : 42;
    // 땅 테마는 땅 밑을 보지 않게 수평선 위로만
    c.maxPolarAngle = Math.PI * (floating ? 0.64 : 0.46);
    // 모든 테마: 그림자는 넓게 흐린다. 구운 장면은 틈 그늘만 라이트맵에 있고 해 그림자는 실시간이라 그대로(1),
    // 실시간 장면은 그늘이 탁해지지 않게 옅게(0.7)
    this.sun.shadow.radius = 6;
    this.sun.shadow.blurSamples = 16;
    this.sun.shadow.intensity = this.stage.baked ? 1 : 0.7;
    // 기본보다 큰 섬(기본 거리보다 멀리서 보는 섬)은 그림자·안개·떠다니는 섬을 그만큼 넓힌다
    this.viewScale = floating ? this.stage.view.distance / FLOATING_VIEW.distance : 1;
    this.floaters.spread(this.viewScale);
    this.clouds.setSea(floating, this.viewScale);
    const half = (floating ? 10 : 16) * this.viewScale;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -half;
    sc.right = sc.top = half;
    sc.updateProjectionMatrix();

    // 지금 보는 방향은 유지하고, 테마의 기준점과 거리로 옮긴다
    const dir = this.camera.position.clone().sub(c.target);
    // 내려다보는 각도로 시작해 땅 윗면이 잘 보이게(떠 있는 섬 약 35°, 땅 약 27°)
    dir.y = Math.max(dir.y, dir.length() * (floating ? 0.58 : 0.45));
    dir.normalize();
    const narrow = this.container.clientWidth < this.container.clientHeight;
    // 돌아다니는 주인공이 있으면 처음부터 그쪽을 비춘다
    if (this.stage.focus) this.stage.focus(c.target);
    else c.target.copy(this.stage.view.target);
    this.camera.position.copy(c.target).addScaledVector(dir, this.stage.view.distance * (narrow ? 1.45 : 1));
    c.update();
  }

  get exploring(): boolean {
    return this.explorer.active;
  }

  /** 들어가기 모드: 풍경 안에 캐릭터를 내려놓고 카메라가 뒤에서 따라간다. 설 곳을 못 찾으면 false */
  enter(): boolean {
    if (this.explorer.active) return true;
    if (this.fly) return false;
    if (!this.explorer.start(this.stage)) return false;
    const c = this.controls;
    const s = this.saved;
    s.pos.copy(this.camera.position);
    s.target.copy(c.target);
    s.min = c.minDistance;
    s.max = c.maxDistance;
    s.polar = c.maxPolarAngle;
    clearTimeout(this.idleTimer);
    c.autoRotate = false;
    c.enabled = false;
    this.fly = { t: 0, leaving: false, pos: s.pos.clone(), target: s.target.clone() };
    this.onExplore?.(true);
    return true;
  }

  /** 들어가기 모드에서 나와 원래 시점으로 돌아간다. now 면 날아가지 않고 바로 */
  leave(now = false): void {
    if (!this.explorer.active) return;
    this.explorer.stop();
    const c = this.controls;
    if (now) {
      this.fly = null;
      this.restoreView();
    } else {
      c.enabled = false;
      this.fly = { t: 0, leaving: true, pos: this.camera.position.clone(), target: c.target.clone() };
    }
    this.onExplore?.(false);
  }

  private restoreView(): void {
    const c = this.controls;
    const s = this.saved;
    c.minDistance = s.min;
    c.maxDistance = s.max;
    c.maxPolarAngle = s.polar;
    c.enableZoom = true;
    c.target.copy(s.target);
    this.camera.position.copy(s.pos);
    c.enabled = true;
    c.autoRotate = true;
    c.update();
  }

  /** 끌지 않고 짧게 누른 곳으로 캐릭터를 걸어가게 한다(끌면 OrbitControls 가 시점을 돌린다) */
  private listenClicks(el: HTMLElement): void {
    let down: { x: number; y: number; id: number } | null = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    el.addEventListener('pointerup', (e) => {
      const d = down;
      down = null;
      if (!d || d.id !== e.pointerId || !this.explorer.active || this.fly) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.explorer.pick(ndc, this.camera);
    });
  }

  /** 들어가기 모드의 카메라: 들어가고 나올 때는 날아가고, 그 사이에는 캐릭터를 부드럽게 따라간다 */
  private updateExploreCamera(dt: number): void {
    const c = this.controls;
    const fly = this.fly;
    if (fly) {
      fly.t = Math.min(1, fly.t + dt / EXPLORE_FLY_S);
      const k = fly.t * fly.t * (3 - 2 * fly.t);
      if (fly.leaving) {
        this.flyTarget.copy(this.saved.target);
        this.flyPos.copy(this.saved.pos);
      } else {
        // 지금 보는 방향 그대로 캐릭터 뒤 위쪽으로
        this.explorer.focus(this.flyTarget);
        const dir = this.flyPos.subVectors(fly.pos, fly.target).setY(0).normalize();
        dir.multiplyScalar(Math.cos(EXPLORE_PITCH)).setY(Math.sin(EXPLORE_PITCH)).multiplyScalar(EXPLORE_DISTANCE);
        this.flyPos.add(this.flyTarget);
      }
      c.target.lerpVectors(fly.target, this.flyTarget, k);
      this.camera.position.lerpVectors(fly.pos, this.flyPos, k);
      this.camera.lookAt(c.target);
      if (fly.t < 1) return;
      this.fly = null;
      if (fly.leaving) return this.restoreView();
      c.minDistance = 0.6;
      c.maxDistance = 6;
      c.maxPolarAngle = Math.PI * 0.47;
      // 거리는 직접 정한다(물체에 가리면 당겨 오기 위해)
      c.enableZoom = false;
      c.enabled = true;
      this.exploreDist = this.camDist = EXPLORE_DISTANCE;
      return;
    }
    this.explorer.focus(this.followPoint);
    this.focusDelta.subVectors(this.followPoint, c.target).multiplyScalar(1 - Math.exp(-dt * 6));
    c.target.add(this.focusDelta);
    this.camera.position.add(this.focusDelta);
  }

  /** 캐릭터와 카메라 사이에 물체가 있으면 그 앞으로 당기고, 비면 원래 거리로 천천히 물러난다 */
  private keepCameraClear(dt: number): void {
    const tg = this.controls.target;
    const dir = this.camDir.subVectors(this.camera.position, tg).normalize();
    // 가운데 하나와 화면 네 귀퉁이 쪽 광선: 화면 가장자리에 걸친 잎·지붕도 잡는다
    const right = this.camSide.crossVectors(dir, this.camera.up).normalize();
    const up = this.camUp.crossVectors(right, dir);
    let want = this.exploreDist;
    for (const [a, b] of CLEAR_RAYS) {
      const ray = this.camRay.copy(dir).multiplyScalar(this.exploreDist).addScaledVector(right, a).addScaledVector(up, b);
      const len = ray.length();
      const hit = this.explorer.occlusion(tg, ray.normalize(), len + 0.3);
      // 대관람차를 타는 동안엔 바퀴 너머 풍경을 보도록 당기지 않는다
      if (hit !== null && !this.explorer.isRiding) want = Math.min(want, Math.max(0.6, (hit - 0.2) * (this.exploreDist / len)));
    }
    this.explorer.endOcclusion(false);
    // 가릴 때는 바로, 비었을 때는 천천히
    this.camDist = want < this.camDist ? want : this.camDist + (want - this.camDist) * (1 - Math.exp(-dt * 3));
    this.camera.position.copy(tg).addScaledVector(dir, this.camDist);
  }

  private stageFor(theme: Theme): Stage {
    let stage = this.stages.get(theme);
    if (!stage) {
      stage = createStage(theme);
      this.stages.set(theme, stage);
    }
    return stage;
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.applyQuality();
    this.resize();
  }

  private applyQuality(): void {
    const q = this.quality;
    const level = q === 'auto' ? (window.innerWidth < 800 || window.devicePixelRatio < 1.5 ? 'medium' : 'high') : q;
    const ratio = level === 'low' ? 1 : level === 'medium' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 2);
    const shadows = level !== 'low';
    const size = level === 'high' ? 2048 : 1024;
    // 창 크기를 바꿀 때마다 불리므로 값이 그대로면 손대지 않는다(픽셀 비율을 다시 넣으면 화면이 지워져 깜빡인다)
    const key = `${ratio}:${shadows}:${size}`;
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    this.useComposer = level !== 'low';
    if (this.renderer.shadowMap.enabled !== shadows) {
      this.renderer.shadowMap.enabled = shadows;
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    this.sun.castShadow = shadows;
    if (!shadows || this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 크기를 바꾸면 캔버스가 비워진다. 다음 프레임(위젯은 30fps)까지 빈 화면이 보이지 않게 바로 다시 그린다
    this.render();
  }

  /** 초당 최대 프레임. 하루 종일 떠 있는 위젯은 30 으로 낮춰 배터리를 아낀다. 0 이면 제한 없음. */
  setFrameCap(fps: number): void {
    this.minFrameTime = fps > 0 ? 1 / fps : 0;
  }

  private frame(): void {
    const now = performance.now() / 1000;
    // 약간의 여유를 둬 60Hz 화면에서 30fps 가 정확히 두 프레임마다 그려지게 한다
    if (now - this.last < this.minFrameTime - 0.004) return;
    const dt = Math.min(now - this.last, 0.1);
    this.last = now;
    this.time += dt;

    const env = this.env;
    lerpEnv(env, this.target, 1 - Math.exp(-dt * 1.6));
    const floating = this.stage.kind === 'floating';
    this.precip.update(dt, this.time, env, this.camera, floating ? World.ORIGIN : this.controls.target);
    const flash = this.precip.flash;

    const el = env.sunElevation;
    this.sunDir.set(Math.cos(el) * Math.cos(SUN_AZIMUTH), Math.sin(el), Math.cos(el) * Math.sin(SUN_AZIMUTH));
    // 그림자는 카메라가 보는 곳 둘레에 맞춘다. 1 단위 격자에 붙여 따라갈 때 그림자 경계가 일렁이지 않게 한다
    const tg = this.controls.target;
    this.shadowCenter.set(Math.round(tg.x), Math.round(tg.y), Math.round(tg.z));
    this.sun.target.position.copy(this.shadowCenter);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.sunDir, 30);
    this.sun.color.copy(env.sunColor);
    const baked = this.stage.baked === true;
    // 구운 장면은 그늘을 라이트맵이 밝혀 주므로 해를 조금 줄여 밝은 면이 하얗게 날지 않게
    this.sun.intensity = env.sunIntensity * (baked ? 0.72 : 0.85);
    this.hemi.color.copy(env.hemiSky);
    // 구운 장면은 라이트맵이, 나머지는 하늘 환경광이 그늘을 채우므로 반구광은 약하게
    this.hemi.intensity = baked ? 0 : env.hemiIntensity * 0.45 + flash * 2.5;
    updateSkyTint(env, flash);
    const skyEnv = this.skyLight.update(dt, env);
    if (skyEnv) this.skyEnv = skyEnv;
    this.scene.environment = this.skyEnv ?? null;

    this.fog.color.copy(env.skyBottom);
    // 구운 섬: 섬 아래(구름바다·먼 안개)는 하늘 윗색 쪽 푸른 기를 띠게. 레퍼런스의 "위는 노을, 아래는 푸른 바다" 구도.
    // 땅 테마는 지평선이 하늘 아랫색에 녹아들게 둔다
    if (baked && floating) this.fog.color.lerp(env.skyTop, 0.75);
    // 구운 섬: 우윳빛 안개를 짙게 깔아 먼 것이 하늘에 녹아들게(대비 낮은 하이키).
    // 땅 테마: 가운데 땅은 또렷하게 두고 지평선 쪽 먼 풍경만 하늘에 녹인다
    this.fog.near = lerp((floating ? (baked ? 18 : 30) : 30) * this.viewScale, 6, env.fog);
    this.fog.far = lerp((floating ? (baked ? 80 : 150) : 105) * this.viewScale, (floating ? 34 : 30) * this.viewScale, env.fog);

    this.sky.update(env, this.sunDir, flash, baked ? 0.9 : 0);
    this.clouds.update(dt, env, baked);
    updateSharedMaterials(env);
    this.stage.update(dt, this.time, env);
    this.floaters.update(dt, this.time);
    this.explorer.update(dt, this.time, this.camera);
    // 돌아다니는 주인공이 있으면 카메라가 부드럽게 따라간다(보는 각도는 유지).
    // 사용자가 시점을 돌리는 동안과 그 뒤 잠시(자동 회전이 다시 켜질 때까지)는 멈춘다
    const flying = this.fly !== null;
    if (this.explorer.active || flying) this.updateExploreCamera(dt);
    else if (this.stage.focus && this.controls.autoRotate) {
      this.stage.focus(this.focusPoint);
      this.focusDelta.subVectors(this.focusPoint, this.controls.target).multiplyScalar(1 - Math.exp(-dt * 0.8));
      this.controls.target.add(this.focusDelta);
      this.camera.position.add(this.focusDelta);
    }
    if (!flying) this.controls.update(dt);
    if (this.explorer.active && !flying) this.keepCameraClear(dt);
    // 땅 테마: 카메라가 언덕·먼 나무·집 속으로 들어가지 않게 위로 밀어 올린다.
    // 부드럽게 올려 높이 격자 칸이 바뀔 때 들썩이지 않게 하되, 여유(0.8) 절반 아래로는 절대 내려가지 않는다
    // 들어가기 모드는 가리는 물체를 숨기거나 카메라를 당기므로 밀어 올리지 않는다(나무 높이까지 솟는다)
    if (this.stage.groundHeight && !this.explorer.active && !flying) {
      const p = this.camera.position;
      const floor = this.stage.groundHeight(p.x, p.z) + 0.8;
      if (p.y < floor) p.y = Math.max(floor - 0.4, p.y + (floor - p.y) * (1 - Math.exp(-dt * 6)));
    }
    this.render();
    this.onFrame?.(env);
  }

  private render(): void {
    if (this.useComposer && !this.stage.baked) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
