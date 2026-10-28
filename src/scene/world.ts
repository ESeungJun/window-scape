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

export type Quality = 'auto' | 'low' | 'medium' | 'high';

const SUN_AZIMUTH = 0.9;
const AUTO_ROTATE_DELAY_MS = 6000;

/** 렌더러·카메라·조명과 장면 구성 요소를 묶고 매 프레임 연출 값을 반영한다. */
export class World {
  onFrame?: (env: Env) => void;

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
  /** 구운 장면에서 라이트맵이 없는 것(구름·떠다니는 섬·덩굴)을 비추는 하늘 환경광 */
  private readonly skyLight: SkyLight;
  private skyEnv: THREE.Texture | null = null;
  private readonly clouds: Clouds;
  private readonly floaters: Floaters;
  private viewScale = 1;
  /** 한 번 만든 테마는 보관해 두고 다시 고를 때 재사용한다 */
  private readonly stages = new Map<Theme, Stage>();
  private stage: Stage;
  private readonly precip: Precipitation;
  private readonly sunDir = new THREE.Vector3();
  private last = performance.now() / 1000;
  private time = 0;
  private idleTimer = 0;
  private quality: Quality = 'auto';
  private minFrameTime = 0;
  private qualityKey = '';
  private readonly focusPoint = new THREE.Vector3();
  private readonly focusDelta = new THREE.Vector3();
  private readonly shadowCenter = new THREE.Vector3();
  private static readonly ORIGIN = new THREE.Vector3();

  constructor(private readonly container: HTMLElement, theme: Theme = 'island') {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
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
      this.idleTimer = window.setTimeout(() => (this.controls.autoRotate = true), AUTO_ROTATE_DELAY_MS);
    });

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

  /** 섬 위 장면을 바꾼다. 하늘·구름·날씨는 그대로 이어진다. */
  setTheme(theme: Theme): void {
    const next = this.stageFor(theme);
    if (next === this.stage) return;
    this.scene.remove(this.stage.group);
    this.stage = next;
    this.scene.add(next.group);
    this.applyStageView();
  }

  /** 테마 종류에 맞춰 구름바다·떠다니는 섬·카메라 범위·그림자 범위를 바꾼다 */
  private applyStageView(): void {
    const floating = this.stage.kind === 'floating';
    this.floaters.group.visible = floating;
    const c = this.controls;
    c.minDistance = floating ? 14 : 7;
    c.maxDistance = floating ? 45 : 40;
    // 땅 테마는 땅 밑을 보지 않게 수평선 위로만
    c.maxPolarAngle = Math.PI * (floating ? 0.64 : 0.47);
    // 구운 장면은 그늘·틈이 이미 라이트맵에 있으니 해 그림자만 아주 넓게 흐린다
    this.sun.shadow.radius = this.stage.baked ? 6 : 5;
    this.sun.shadow.blurSamples = this.stage.baked ? 16 : 12;
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
    // 떠 있는 섬은 내려다보는 각도(약 35°)로 시작해 섬 윗면이 잘 보이게
    dir.y = Math.max(dir.y, dir.length() * (floating ? 0.58 : 0.3));
    dir.normalize();
    const narrow = this.container.clientWidth < this.container.clientHeight;
    // 움직이는 주인공이 있으면 처음부터 그쪽을 비춘다
    if (this.stage.focus) this.stage.focus(c.target);
    else c.target.copy(this.stage.view.target);
    this.camera.position.copy(c.target).addScaledVector(dir, this.stage.view.distance * (narrow ? 1.45 : 1));
    c.update();
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
    this.sun.intensity = env.sunIntensity * (baked ? 0.72 : 1);
    this.hemi.color.copy(env.hemiSky);
    this.hemi.intensity = baked ? 0 : env.hemiIntensity + flash * 2.5;
    updateSkyTint(env, flash);
    const skyEnv = baked ? this.skyLight.update(dt, env) : null;
    if (skyEnv) this.skyEnv = skyEnv;
    this.scene.environment = baked ? this.skyEnv : null;

    this.fog.color.copy(env.skyBottom);
    // 구운 장면: 섬 아래(구름바다·먼 안개)는 하늘 윗색 쪽 푸른 기를 띠게. 레퍼런스의 "위는 노을, 아래는 푸른 바다" 구도
    if (baked) this.fog.color.lerp(env.skyTop, 0.75);
    // 땅 테마는 지평선이 하늘에 녹아들도록 안개를 가깝게 둔다
    // 구운 장면: 우윳빛 안개를 짙게 깔아 먼 것이 하늘에 녹아들게(대비 낮은 하이키)
    this.fog.near = lerp((baked ? 18 : floating ? 30 : 22) * this.viewScale, 6, env.fog);
    this.fog.far = lerp((baked ? 80 : floating ? 150 : 72) * this.viewScale, (floating ? 34 : 30) * this.viewScale, env.fog);

    this.sky.update(env, this.sunDir, flash, baked ? 0.9 : 0);
    this.clouds.update(dt, env, baked);
    updateSharedMaterials(env);
    this.stage.update(dt, this.time, env);
    this.floaters.update(dt, this.time);
    // 움직이는 주인공이 있으면 카메라가 부드럽게 따라간다(보는 각도는 유지)
    if (this.stage.focus) {
      this.stage.focus(this.focusPoint);
      this.focusDelta.subVectors(this.focusPoint, this.controls.target).multiplyScalar(1 - Math.exp(-dt * 1.2));
      this.controls.target.add(this.focusDelta);
      this.camera.position.add(this.focusDelta);
    }
    this.controls.update(dt);
    // 땅 테마: 카메라가 언덕 속으로 들어가지 않게 땅 위로 밀어 올린다
    if (this.stage.groundHeight) {
      const p = this.camera.position;
      const floor = this.stage.groundHeight(p.x, p.z) + 0.8;
      if (p.y < floor) p.y = floor;
    }
    this.render();
    this.onFrame?.(env);
  }

  private render(): void {
    if (this.useComposer && !this.stage.baked) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
