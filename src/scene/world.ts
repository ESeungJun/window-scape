import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Condition, Season, TimeOfDay } from '../data/weather';
import { mulberry32, lerp } from '../util';
import { Clouds } from './clouds';
import { composeEnv, copyEnv, createEnv, lerpEnv, type Env, type LiveWeather } from './env';
import { FLOATING_VIEW, Floaters, reducedMotion, updateSharedMaterials, type Stage } from './kit';
import { createStage, type Theme } from './themes';
import { Precipitation } from './precipitation';
import { SkyDome, SkyLight } from './sky';
import { TOON_UNIFORM, updateSurface } from './baked';
import { Glass } from './glass';
import { frameCap, shadowInterval } from './pace';
import type { Explorer } from './explore';

export type Quality = 'auto' | 'low' | 'medium' | 'high';

/** 땅 테마의 모양: 지평선까지 이어진 땅 / 받침 위 디오라마(구름바다) / 미니어처(망원으로 내려다본 받침, 단색 배경, 툰 색감) */
export type Shape = 'land' | 'case' | 'mini';

/** 켜고 끌 수 있는 연출. 저장은 main.ts 가 맡는다 */
export interface Effects {
  /** 창 유리(빗방울·김·성에) */
  glass: boolean;
  /** 나무 잎 흔들림 */
  wind: boolean;
  /** 마우스·창 위치에 따라 풍경이 조금 미끄러지는 시차 */
  parallax: boolean;
  /** 땅 위를 흐르는 구름 그늘 */
  shade: boolean;
  /** 시선 고정: 계속 돌지 않고 창밖을 보듯 조금만 흔들린다 */
  still: boolean;
  /** 절전: 가만히 있을 때 프레임·그림자 갱신·해상도를 낮춘다 */
  lowPower: boolean;
}

export const DEFAULT_EFFECTS: Effects = { glass: false, wind: true, parallax: true, shade: true, still: false, lowPower: false };

export interface WorldOptions {
  theme?: Theme;
  /** 하루 종일 떠 있는 위젯은 'low-power' 로 내장 GPU 를 쓴다(그래픽이 둘인 노트북의 배터리·발열) */
  powerPreference?: WebGLPowerPreference;
}

const SUN_AZIMUTH = 0.9;
/** 평소 화각과 미니어처 화각. 미니어처는 화각을 좁히고 그만큼 멀리서 찍어 원근이 거의 없는 '보드게임 판' 느낌을 낸다 */
const BASE_FOV = 38;
const MINI_FOV = 15;
/** 같은 크기로 보이게 하려면 카메라를 이만큼 멀리 둬야 한다(화각 절반의 탄젠트 비) */
const MINI_LENS = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / Math.tan(THREE.MathUtils.degToRad(MINI_FOV / 2));
/** 미니어처 처음 거리: 받침을 화면에 크게 담는다(디오라마는 구름바다까지 보이게 한 발 물러서 있다) */
const MINI_FRAME = 0.8;
/** 미니어처 배경: 낮에도 밤에도 장면이 떠 보이는 짙은 남색. 하늘빛을 조금만 머금는다 */
const MINI_BG = new THREE.Color('#23253f');
const MINI_BG_NIGHT = new THREE.Color('#12131f');
const WHITE_FLASH = new THREE.Color('#c9d2ff');
const AUTO_ROTATE_DELAY_MS = 6000;
/** 들어가기 모드: 카메라가 캐릭터 뒤 위쪽에서 따라가는 거리·내려다보는 각도, 들어가고 나오는 데 걸리는 시간 */
const EXPLORE_DISTANCE = 2.6;
/** 대관람차를 탔을 때 카메라 거리 */
const RIDE_DISTANCE = 3.6;
const EXPLORE_PITCH = 0.42;
const EXPLORE_FLY_S = 1.1;
/** 이만큼 안 움직이고 뗀 포인터는 클릭(걸어가기), 더 움직이면 시점 돌리기 */
const CLICK_SLOP_PX = 6;
/** 조작이 끝난 뒤 이만큼은 '조작 중'으로 본다(절전에서 프레임을 바로 낮추지 않게) */
const ACTIVE_S = 4;
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
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 1000);
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
  /** 지금 테마와 바로 앞 테마만 보관한다(되돌아갈 때 다시 받지 않게). 그보다 오래된 것은 해제한다 */
  private readonly stages = new Map<Theme, Stage>();
  private stage: Stage;
  private readonly glass = new Glass();
  private effects: Effects = { ...DEFAULT_EFFECTS };
  /** 땅 테마를 받침 위에 올려 볼지(디오라마·미니어처) */
  private cased = false;
  /** 사용자가 미니어처 모양을 골랐는지. 실제로 켜지는 건 받침이 있는 땅 테마일 때뿐(mini) */
  private miniWanted = false;
  private mini = false;
  /** 미니어처일 때 카메라 거리 배율(아니면 1) */
  private lens = 1;
  private readonly bg = new THREE.Color();
  private readonly precip: Precipitation;
  private readonly sunDir = new THREE.Vector3();
  private last = performance.now() / 1000;
  private time = 0;
  private idleTimer = 0;
  private quality: Quality = 'auto';
  /** 평소 프레임 상한(위젯 30, 웹 60). 실제 상한은 프레임마다 pace.ts 가 정한다 */
  private baseFps = 0;
  private qualityKey = '';
  /** 프레임 루프가 돌고 있는지. 창이 안 보이면 멈춘다 */
  private running = false;
  /** 창이 다른 창에 완전히 가려졌는지(데스크톱 앱이 알려 준다) */
  private occluded = false;
  /** 마지막으로 조작한 때(초) */
  private lastInput = -100;
  /** 사용자가 시점을 돌리고 있지 않은지(자동 회전·주인공 따라가기를 해도 되는지) */
  private idle = true;
  private readonly shadowCenter = new THREE.Vector3();
  /** 그림자 맵을 마지막으로 그렸을 때의 해 방향·가운데와 그 뒤 지난 시간 */
  private readonly shadowSun = new THREE.Vector3();
  private readonly shadowAt = new THREE.Vector3(1e9, 0, 0);
  private shadowAge = 1e9;
  /** 마지막으로 누름 반응이 있었던 때(장면 시간) */
  private pokedAt = -100;
  /** 마우스 자리(-1~1)와 창 자리에 따른 치우침, 부드럽게 따라간 값, 지금 카메라에 더해 둔 이동 */
  private readonly pointer = new THREE.Vector2();
  private readonly windowBias = new THREE.Vector2();
  private readonly lean = new THREE.Vector2();
  private readonly leanOffset = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly focusPoint = new THREE.Vector3();
  private readonly focusDelta = new THREE.Vector3();
  private static readonly ORIGIN = new THREE.Vector3();
  /** 들어가기 모드. 처음 들어갈 때 불러온다(시작 번들에서 뺀다) */
  private explorer: Explorer | null = null;
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

  constructor(private readonly container: HTMLElement, { theme = 'island', powerPreference = 'high-performance' }: WorldOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // 그림자 맵은 해·장면이 움직였을 때만 다시 그린다(frame 에서 정한다)
    this.renderer.shadowMap.autoUpdate = false;
    // 디오라마 모양: 받침 가장자리에서 장면을 자른다(재질별 clippingPlanes)
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.skyLight = new SkyLight(this.renderer);

    const narrow = container.clientWidth < container.clientHeight;
    this.camera.position.set(16, 11, 18).multiplyScalar(narrow ? 1.45 : 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, -1.5, 0);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.64;
    this.controls.autoRotateSpeed = 0.35;
    this.syncRotate();
    this.controls.addEventListener('start', () => {
      this.idle = false;
      this.syncRotate();
      clearTimeout(this.idleTimer);
    });
    this.controls.addEventListener('end', () => {
      if (this.exploring) return;
      this.idleTimer = window.setTimeout(() => {
        this.idle = true;
        this.syncRotate();
      }, AUTO_ROTATE_DELAY_MS);
    });
    this.listenClicks(this.renderer.domElement);
    this.listenPointer();
    this.renderer.domElement.addEventListener('wheel', (e) => {
      if (!this.exploring) return;
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
    this.scene.add(
      this.sun, this.sun.target, this.hemi, this.sky.group, this.stage.group, this.floaters.group, this.clouds.group, this.precip.group,
      this.glass.mesh,
    );

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
    document.addEventListener('visibilitychange', () => this.syncLoop());
    this.syncLoop();
  }

  /**
   * 창이 보일 때만 프레임 루프를 돌린다. 문서가 숨겨졌거나(최소화·다른 공간·화면 잠금)
   * 창이 다른 창에 완전히 가려지면 멈추고, 다시 보이면 이어서 돈다.
   */
  private syncLoop(): void {
    const visible = !document.hidden && !this.occluded;
    if (visible === this.running) return;
    this.running = visible;
    if (visible) {
      // 멈춰 있던 시간만큼 한꺼번에 흐르지 않게 시계를 지금으로 맞춘다
      this.last = performance.now() / 1000;
      this.shadowAge = 1e9;
      this.renderer.setAnimationLoop(() => this.frame());
    } else this.renderer.setAnimationLoop(null);
  }

  /** 창이 다른 창에 완전히 가려졌는지(데스크톱 앱이 운영체제에서 받아 알려 준다) */
  setOccluded(occluded: boolean): void {
    this.occluded = occluded;
    this.syncLoop();
  }

  setEffects(effects: Effects): void {
    const quality = effects.lowPower !== this.effects.lowPower;
    this.effects = { ...effects };
    this.glass.enabled = effects.glass;
    this.syncRotate();
    if (quality) {
      this.applyQuality();
      this.resize();
    }
  }

  /** 창이 화면 어디에 있는지(-1~1). 창을 옮기면 풍경이 창틀에 대해 조금 미끄러진다 */
  setWindowBias(x: number, y: number): void {
    this.windowBias.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  /** 자동 회전: 사용자가 돌리는 중이 아니고, 시선 고정·움직임 줄이기가 아닐 때만 */
  private syncRotate(): void {
    this.controls.autoRotate = this.idle && !this.exploring && !this.effects.still && !reducedMotion();
  }

  /** 마우스 자리(시차)와 끌기(김 닦기)를 듣는다. 조작 시각도 여기서 남긴다 */
  private listenPointer(): void {
    const touch = () => (this.lastInput = performance.now() / 1000);
    window.addEventListener('pointermove', (e) => {
      touch();
      const r = this.container.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      this.pointer.set(THREE.MathUtils.clamp(x * 2 - 1, -1, 1), THREE.MathUtils.clamp(1 - y * 2, -1, 1));
      if (e.buttons & 1 && e.target === this.renderer.domElement) this.glass.wipe(x, 1 - y);
    });
    // 창 밖으로 나가면 가운데로 돌아온다
    document.documentElement.addEventListener('pointerleave', () => this.pointer.set(0, 0));
    window.addEventListener('pointerdown', touch);
    window.addEventListener('keydown', touch);
    window.addEventListener('wheel', touch, { passive: true });
  }

  /** 카메라에 더해 둔 시차 이동을 걷어 낸다(카메라 자리를 저장하거나 새로 잡기 전에) */
  private clearLean(): void {
    this.camera.position.sub(this.leanOffset);
    this.leanOffset.set(0, 0, 0);
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
    const prev = this.stage;
    this.scene.remove(prev.group);
    this.stage = next;
    next.setCase?.(this.cased);
    this.scene.add(next.group);
    // 지금 것과 바로 앞 것만 남기고 해제한다(도형·재질·라이트맵이 테마마다 수십 MB 다)
    for (const [key, stage] of this.stages) {
      if (stage === next || stage === prev) continue;
      stage.dispose();
      this.stages.delete(key);
    }
    this.applyStageView();
  }

  /** 땅 테마의 모양. 하늘섬은 모양이 하나라 무시한다(받침이 없다) */
  setShape(shape: Shape): void {
    const on = shape !== 'land';
    const mini = shape === 'mini';
    if (on === this.cased && mini === this.miniWanted) return;
    this.leave(true);
    // 디오라마 ↔ 미니어처는 받침은 그대로라 테마에 다시 알리지 않는다
    if (on !== this.cased) this.stage.setCase?.(on);
    this.cased = on;
    this.miniWanted = mini;
    // 하늘섬은 모양이 없으니 시점을 건드리지 않는다(값만 기억해 두고 땅 테마로 가면 쓴다)
    if (!this.stage.setCase) return;
    this.applyStageView();
  }

  /** 테마 종류에 맞춰 구름바다·떠다니는 섬·카메라 범위·그림자 범위를 바꾼다 */
  private applyStageView(): void {
    this.clearLean();
    this.shadowAge = 1e9;
    const floating = this.stage.kind === 'floating';
    // 떠다니는 작은 섬은 하늘섬에만(디오라마 받침 둘레에는 띄우지 않는다)
    this.floaters.group.visible = floating && !this.stage.setCase;
    // 미니어처: 하늘·구름바다 대신 단색 배경(frame 에서 칠한다), 좁은 화각, 툰 색감
    this.mini = this.miniWanted && this.cased && this.stage.setCase !== undefined;
    this.lens = this.mini ? MINI_LENS : 1;
    // 하늘 구름도 숨긴다(좁은 화각에서는 화면 귀퉁이에 덩어리로만 걸린다). 구름 그늘은 셰이더라 그대로 흐른다
    this.sky.group.visible = this.clouds.group.visible = !this.mini;
    if (!this.mini) this.scene.background = null;
    TOON_UNIFORM.value = this.mini ? 1 : 0;
    this.setFov(this.mini ? MINI_FOV : BASE_FOV);
    const c = this.controls;
    c.minDistance = (floating ? 14 : 10) * this.lens;
    c.maxDistance = (floating ? 45 : 42) * this.lens;
    // 땅 테마는 땅 밑을 보지 않게 수평선 위로만
    c.maxPolarAngle = Math.PI * (floating ? 0.64 : 0.46);
    // 모든 테마: 그림자는 넓게 흐린다. 구운 장면은 틈 그늘만 라이트맵에 있고 해 그림자는 실시간이라 그대로(1),
    // 실시간 장면은 그늘이 탁해지지 않게 옅게(0.7)
    this.sun.shadow.radius = 6;
    this.sun.shadow.blurSamples = 16;
    // 기본보다 큰 섬(기본 거리보다 멀리서 보는 섬)은 그림자·안개·떠다니는 섬을 그만큼 넓힌다
    this.viewScale = floating ? this.stage.view.distance / FLOATING_VIEW.distance : 1;
    this.floaters.spread(this.viewScale);
    this.clouds.setSea(floating && !this.mini, this.viewScale);
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
    this.camera.position.copy(c.target).addScaledVector(dir, this.stage.view.distance * this.lens * (this.mini ? MINI_FRAME : 1) * (narrow ? 1.45 : 1));
    c.update();
  }

  private setFov(fov: number): void {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  get exploring(): boolean {
    return this.explorer?.active ?? false;
  }

  /** 들어가기 모드: 풍경 안에 캐릭터를 내려놓고 카메라가 뒤에서 따라간다. 설 곳을 못 찾으면 false */
  async enter(): Promise<boolean> {
    if (this.exploring) return true;
    if (!this.explorer) {
      const { Explorer } = await import('./explore');
      // 불러오는 사이에 한 번 더 눌렀으면 먼저 만든 것을 쓴다
      if (!this.explorer) {
        const explorer = new Explorer();
        explorer.onRide = (on) => {
          // 타면 조금 물러나서 바퀴와 풍경이 같이 보이게
          if (on) this.exploreDist = Math.max(this.exploreDist, RIDE_DISTANCE);
          this.onRide?.(on);
        };
        this.explorer = explorer;
      }
    }
    const explorer = this.explorer;
    if (explorer.active) return true;
    // 나오는 중에 다시 누르면 나오기를 끝내고 바로 들어간다
    if (this.fly?.leaving) {
      this.fly = null;
      this.restoreView();
    }
    if (!explorer.start(this.stage)) return false;
    this.clearLean();
    const c = this.controls;
    const s = this.saved;
    s.pos.copy(this.camera.position);
    s.target.copy(c.target);
    s.min = c.minDistance;
    s.max = c.maxDistance;
    s.polar = c.maxPolarAngle;
    clearTimeout(this.idleTimer);
    this.syncRotate();
    c.enabled = false;
    this.fly = { t: 0, leaving: false, pos: s.pos.clone(), target: s.target.clone() };
    this.onExplore?.(true);
    return true;
  }

  /** 들어가기 모드에서 나와 원래 시점으로 돌아간다. now 면 날아가지 않고 바로 */
  leave(now = false): void {
    const explorer = this.explorer;
    if (!explorer?.active) {
      // 나오는 중에 테마·모양을 바꾸면 날아가기를 끝내 둔다(끝에 옛 테마 시점을 덮어쓰지 않게)
      if (now && this.fly?.leaving) {
        this.fly = null;
        this.restoreView();
      }
      return;
    }
    explorer.stop();
    this.clearLean();
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
    this.setFov(this.mini ? MINI_FOV : BASE_FOV);
    c.enabled = true;
    this.idle = true;
    this.syncRotate();
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
      if (!d || d.id !== e.pointerId || this.fly) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return;
      const r = el.getBoundingClientRect();
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      if (this.explorer?.active) this.explorer.pick(ndc, this.camera);
      else this.poke(ndc);
    });
  }

  /** 누른 자리의 물체가 한 번 반응한다(풍차·나무·토끼). 광선 검사는 누를 때만 한다 */
  private poke(ndc: THREE.Vector2): void {
    if (!this.stage.poke) return;
    this.raycaster.setFromCamera(ndc, this.camera);
    // 광선 검사는 숨긴 물체(디오라마 모양의 받침 밖 나무, 눈 올 때의 꽃)도 맞히므로 보이는 것만 본다.
    // 맨 앞 물체가 반응하지 않으면(땅·집) 거기서 멈춘다: 가려진 뒤쪽 물체가 반응하면 이상하다
    const shown = (o: THREE.Object3D | null): boolean => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return true;
    };
    const hit = this.raycaster.intersectObject(this.stage.group, true).find((i) => (i.object as THREE.Mesh).isMesh && shown(i.object));
    if (hit && this.stage.poke(hit.object)) this.pokedAt = this.time;
  }

  /** 들어가기 모드의 카메라: 들어가고 나올 때는 날아가고, 그 사이에는 캐릭터를 부드럽게 따라간다 */
  private updateExploreCamera(dt: number, explorer: Explorer): void {
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
        explorer.focus(this.flyTarget);
        const dir = this.flyPos.subVectors(fly.pos, fly.target).setY(0).normalize();
        dir.multiplyScalar(Math.cos(EXPLORE_PITCH)).setY(Math.sin(EXPLORE_PITCH)).multiplyScalar(EXPLORE_DISTANCE);
        this.flyPos.add(this.flyTarget);
      }
      c.target.lerpVectors(fly.target, this.flyTarget, k);
      this.camera.position.lerpVectors(fly.pos, this.flyPos, k);
      // 미니어처의 좁은 화각은 캐릭터 바로 뒤에서 쓰기엔 답답하다. 날아가는 동안 평소 화각으로 바꾸고, 나올 때 되돌린다
      if (this.mini) this.setFov(THREE.MathUtils.lerp(MINI_FOV, BASE_FOV, fly.leaving ? 1 - k : k));
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
    explorer.focus(this.followPoint);
    this.focusDelta.subVectors(this.followPoint, c.target).multiplyScalar(1 - Math.exp(-dt * 6));
    c.target.add(this.focusDelta);
    this.camera.position.add(this.focusDelta);
  }

  /** 캐릭터와 카메라 사이에 물체가 있으면 그 앞으로 당기고, 비면 원래 거리로 천천히 물러난다 */
  private keepCameraClear(dt: number, explorer: Explorer): void {
    const tg = this.controls.target;
    const dir = this.camDir.subVectors(this.camera.position, tg).normalize();
    // 가운데 하나와 화면 네 귀퉁이 쪽 광선: 화면 가장자리에 걸친 잎·지붕도 잡는다
    const right = this.camSide.crossVectors(dir, this.camera.up).normalize();
    const up = this.camUp.crossVectors(right, dir);
    let want = this.exploreDist;
    for (const [a, b] of CLEAR_RAYS) {
      const ray = this.camRay.copy(dir).multiplyScalar(this.exploreDist).addScaledVector(right, a).addScaledVector(up, b);
      const len = ray.length();
      const hit = explorer.occlusion(tg, ray.normalize(), len + 0.3);
      // 대관람차를 타는 동안엔 바퀴 너머 풍경을 보도록 당기지 않는다
      if (hit !== null && !explorer.isRiding) want = Math.min(want, Math.max(0.6, (hit - 0.2) * (this.exploreDist / len)));
    }
    explorer.endOcclusion(false);
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
    const low = this.effects.lowPower;
    let level = q === 'auto' ? (window.innerWidth < 800 || window.devicePixelRatio < 1.5 ? 'medium' : 'high') : q;
    // 절전: 그림자는 남기되 한 단계 낮춘다
    if (low && level === 'high') level = 'medium';
    const cap = level === 'low' ? 1 : level === 'medium' ? 1.5 : 2;
    const ratio = Math.min(window.devicePixelRatio, low ? Math.min(cap, 1.25) : cap);
    const shadows = level !== 'low';
    const size = level === 'high' ? 2048 : 1024;
    // 창 크기를 바꿀 때마다 불리므로 값이 그대로면 손대지 않는다(픽셀 비율을 다시 넣으면 화면이 지워져 깜빡인다)
    const key = `${ratio}:${shadows}:${size}`;
    if (key === this.qualityKey) return;
    this.qualityKey = key;
    this.renderer.setPixelRatio(ratio);
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
    this.shadowAge = 1e9;
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 크기를 바꾸면 캔버스가 비워진다. 다음 프레임(위젯은 30fps)까지 빈 화면이 보이지 않게 바로 다시 그린다
    this.render();
  }

  /** 평소 초당 최대 프레임. 하루 종일 떠 있는 위젯은 30, 웹은 60(120Hz 화면에서 두 배로 그리지 않게). 0 이면 제한 없음. */
  setFrameCap(fps: number): void {
    this.baseFps = fps;
  }

  private frame(): void {
    const now = performance.now() / 1000;
    const cur = this.env;
    const cap = frameCap({
      visible: true,
      baseFps: this.baseFps,
      lowPower: this.effects.lowPower,
      active: now - this.lastInput < ACTIVE_S || !this.idle || this.fly !== null || this.exploring,
      lively: cur.rain > 0.05 || cur.snow > 0.05 || cur.wind > 0.6 || cur.storm > 0.5,
    });
    // 약간의 여유를 둬 60Hz 화면에서 30fps 가 정확히 두 프레임마다 그려지게 한다
    if (cap > 0 && now - this.last < 1 / cap - 0.004) return;
    const dt = Math.min(now - this.last, 0.1);
    this.last = now;
    this.time += dt;

    const env = this.env;
    lerpEnv(env, this.target, 1 - Math.exp(-dt * 1.6));
    const floating = this.stage.kind === 'floating';
    const canvas = this.renderer.domElement;
    this.precip.update(dt, this.time, env, this.camera, floating ? World.ORIGIN : this.controls.target, {
      width: canvas.width, height: canvas.height, ratio: this.renderer.getPixelRatio(),
    });
    const flash = this.precip.flash;
    const still = reducedMotion();

    const el = env.sunElevation;
    const az = SUN_AZIMUTH + env.sunAzimuth;
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    // 그림자는 카메라가 보는 곳 둘레에 맞춘다. 1 단위 격자에 붙여 따라갈 때 그림자 경계가 일렁이지 않게 한다
    const tg = this.controls.target;
    this.shadowCenter.set(Math.round(tg.x), Math.round(tg.y), Math.round(tg.z));
    this.sun.target.position.copy(this.shadowCenter);
    this.sun.position.copy(this.shadowCenter).addScaledVector(this.sunDir, 30);
    this.sun.color.copy(env.sunColor);
    const baked = this.stage.baked === true;
    // 구운 장면은 그늘을 라이트맵이 밝혀 주므로 해를 조금 줄여 밝은 면이 하얗게 날지 않게
    this.sun.intensity = env.sunIntensity * (baked ? 0.72 : 0.85);
    // 흐릴수록 그림자가 옅다. 구운 장면은 틈 그늘만 라이트맵에 있고 해 그림자는 실시간이라 그대로(1),
    // 실시간 장면은 그늘이 탁해지지 않게 옅게(0.7)
    this.sun.shadow.intensity = (baked ? 1 : 0.7) * (1 - env.overcast * 0.8);
    this.updateShadowMap(dt, env);
    this.hemi.color.copy(env.hemiSky);
    // 구운 장면은 라이트맵이, 나머지는 하늘 환경광이 그늘을 채우므로 반구광은 약하게
    this.hemi.intensity = baked ? 0 : env.hemiIntensity * 0.45 + flash * 2.5;
    updateSurface(dt, env, flash, { shade: this.effects.shade, sway: this.effects.wind && !still });
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
    if (this.mini) {
      // 미니어처는 멀리서 찍으므로 거리 안개를 걷는다(받침만 보이니 지평선을 녹일 일이 없다).
      // 짙은 날씨의 뿌연 느낌은 가까운 쪽만 살짝 남긴다
      const d = this.camera.position.distanceTo(this.controls.target);
      this.fog.near = d + lerp(60, 4, env.fog);
      this.fog.far = d + lerp(400, 40, env.fog);
      this.fog.color.copy(this.bg.copy(MINI_BG).lerp(MINI_BG_NIGHT, env.stars).lerp(env.skyTop, 0.03).lerp(WHITE_FLASH, flash * 0.12));
      this.scene.background = this.bg;
    }

    this.sky.update(env, this.sunDir, flash, baked ? 0.9 : 0);
    // 구름 그늘을 셰이더로 그릴 때는 구름을 그림자 맵에 넣지 않는다
    this.clouds.update(dt, env, baked, !this.effects.shade);
    updateSharedMaterials(env);
    this.stage.update(dt, this.time, env);
    this.floaters.update(dt, this.time);
    this.glass.update(dt, env, canvas.width / Math.max(1, canvas.height), still);
    const explorer = this.explorer;
    explorer?.update(dt, this.time, this.camera);
    // 지난 프레임에 더한 시차 이동을 걷어 낸 자리에서 카메라를 움직인다
    this.camera.position.sub(this.leanOffset);
    // 돌아다니는 주인공이 있으면 카메라가 부드럽게 따라간다(보는 각도는 유지).
    // 사용자가 시점을 돌리는 동안과 그 뒤 잠시는 멈춘다
    const flying = this.fly !== null;
    const inside = explorer !== null && (explorer.active || flying);
    if (inside) this.updateExploreCamera(dt, explorer);
    else if (this.stage.focus && this.idle && !still) {
      this.stage.focus(this.focusPoint);
      this.focusDelta.subVectors(this.focusPoint, this.controls.target).multiplyScalar(1 - Math.exp(-dt * 0.8));
      this.controls.target.add(this.focusDelta);
      this.camera.position.add(this.focusDelta);
    }
    if (!flying) this.controls.update(dt);
    if (explorer?.active && !flying) this.keepCameraClear(dt, explorer);
    // 땅 테마: 카메라가 언덕·먼 나무·집 속으로 들어가지 않게 위로 밀어 올린다.
    // 부드럽게 올려 높이 격자 칸이 바뀔 때 들썩이지 않게 하되, 여유(0.8) 절반 아래로는 절대 내려가지 않는다
    // 들어가기 모드는 가리는 물체를 숨기거나 카메라를 당기므로 밀어 올리지 않는다(나무 높이까지 솟는다)
    if (this.stage.groundHeight && !explorer?.active && !flying) {
      const p = this.camera.position;
      const floor = this.stage.groundHeight(p.x, p.z) + 0.8;
      if (p.y < floor) p.y = Math.max(floor - 0.4, p.y + (floor - p.y) * (1 - Math.exp(-dt * 6)));
    }
    this.applyLean(dt, inside || still);
    this.render();
    this.onFrame?.(env);
  }

  /**
   * 그림자 맵을 다시 그릴지 정한다. 해 방향이나 그림자 가운데가 바뀌면 바로, 그 밖에는
   * 나무 흔들림·움직이는 것에 맞춘 간격으로만 다시 그린다(매 프레임 그리면 그리는 양의 절반 가까이가 그림자다).
   */
  private updateShadowMap(dt: number, env: Env): void {
    if (!this.renderer.shadowMap.enabled) return;
    this.shadowAge += dt;
    const moved = this.shadowSun.distanceToSquared(this.sunDir) > 1e-8 || !this.shadowAt.equals(this.shadowCenter);
    const every = shadowInterval({
      lowPower: this.effects.lowPower,
      wind: env.wind,
      // 들어가 있는 동안과 누른 직후(풍차 가속·폴짝)는 그림자가 끊겨 보이지 않게 매 프레임에 가깝게
      moverHz: this.exploring || this.fly !== null || this.time - this.pokedAt < 2.5 ? 30 : (this.stage.moverHz ?? 0),
      shadowStrength: this.sun.shadow.intensity * Math.min(1, env.sunIntensity),
    });
    if (!moved && this.shadowAge < every - 0.004) return;
    this.shadowSun.copy(this.sunDir);
    this.shadowAt.copy(this.shadowCenter);
    this.shadowAge = 0;
    this.renderer.shadowMap.needsUpdate = true;
  }

  /**
   * 창 시차: 마우스가 창 위를 지나거나 창을 화면에서 옮기면 카메라가 보는 점 둘레로 조금 돌아
   * 창틀 너머에 고정된 풍경을 들여다보는 느낌을 준다. 시선 고정에서는 여기에 아주 느린 좌우 흔들림을 더한다.
   */
  private applyLean(dt: number, off: boolean): void {
    const on = this.effects.parallax && !off;
    let x = 0;
    let y = 0;
    if (on) {
      x = this.pointer.x * 0.6 + this.windowBias.x * 0.5;
      y = this.pointer.y * 0.6 + this.windowBias.y * 0.5;
    }
    if (this.effects.still && !off) x += Math.sin(this.time * 0.13) * 0.9;
    this.lean.x += (x - this.lean.x) * (1 - Math.exp(-dt * 3));
    this.lean.y += (y - this.lean.y) * (1 - Math.exp(-dt * 3));
    if (Math.abs(this.lean.x) < 1e-4 && Math.abs(this.lean.y) < 1e-4) {
      this.leanOffset.set(0, 0, 0);
      return;
    }
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camSide.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.camUp.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.leanOffset.set(0, 0, 0).addScaledVector(this.camSide, this.lean.x * dist * 0.045).addScaledVector(this.camUp, this.lean.y * dist * 0.03);
    this.camera.position.add(this.leanOffset);
    this.camera.lookAt(this.controls.target);
  }

  private render(): void {
    // 그림자 맵이 아직 없으면(처음, 화질을 바꾼 직후) 이번에 꼭 그린다. 빈 그림자 맵을 읽으면 그리기 오류가 난다
    if (this.renderer.shadowMap.enabled && !this.sun.shadow.map) this.renderer.shadowMap.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
}
