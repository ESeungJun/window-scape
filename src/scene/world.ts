import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Condition, Season, TimeOfDay } from '../data/weather';
import { mulberry32, lerp } from '../util';
import { Clouds } from './clouds';
import { composeEnv, copyEnv, createEnv, lerpEnv, type Env } from './env';
import { Island } from './island';
import { Precipitation } from './precipitation';
import { SkyDome } from './sky';

export type Quality = 'auto' | 'low' | 'medium' | 'high';

const SUN_AZIMUTH = 0.9;
const AUTO_ROTATE_DELAY_MS = 6000;

/** 렌더러·카메라·조명과 장면 구성 요소를 묶고 매 프레임 연출 값을 반영한다. */
export class World {
  onFrame?: (env: Env) => void;

  private readonly env: Env = createEnv();
  private readonly target: Env = createEnv();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1000);
  private readonly controls: OrbitControls;
  private readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  private readonly hemi = new THREE.HemisphereLight('#ffffff', '#a08c78', 1);
  private readonly fog = new THREE.Fog('#ffffff', 45, 150);
  private readonly sky = new SkyDome();
  private readonly clouds: Clouds;
  private readonly island: Island;
  private readonly precip: Precipitation;
  private readonly sunDir = new THREE.Vector3();
  private last = performance.now() / 1000;
  private time = 0;
  private idleTimer = 0;
  private quality: Quality = 'auto';

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    const narrow = container.clientWidth < container.clientHeight;
    this.camera.position.set(17, 6, 19).multiplyScalar(narrow ? 1.45 : 1);
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

    const rng = mulberry32(7);
    this.island = new Island(rng);
    this.clouds = new Clouds(rng);
    this.precip = new Precipitation(rng);
    this.scene.fog = this.fog;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.sky.group, this.island.group, this.clouds.group, this.precip.group);

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
  setSelection(time: TimeOfDay, cond: Condition, season: Season, minTemp?: number): void {
    composeEnv(time, cond, season, this.target, minTemp);
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
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frame(): void {
    const now = performance.now() / 1000;
    const dt = Math.min(now - this.last, 0.1);
    this.last = now;
    this.time += dt;

    const env = this.env;
    lerpEnv(env, this.target, 1 - Math.exp(-dt * 1.6));
    this.precip.update(dt, this.time, env, this.camera);
    const flash = this.precip.flash;

    const el = env.sunElevation;
    this.sunDir.set(Math.cos(el) * Math.cos(SUN_AZIMUTH), Math.sin(el), Math.cos(el) * Math.sin(SUN_AZIMUTH));
    this.sun.position.copy(this.sunDir).multiplyScalar(30);
    this.sun.color.copy(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.hemi.color.copy(env.hemiSky);
    this.hemi.intensity = env.hemiIntensity + flash * 2.5;

    this.fog.color.copy(env.skyBottom);
    this.fog.near = lerp(45, 6, env.fog);
    this.fog.far = lerp(150, 34, env.fog);

    this.sky.update(env, this.sunDir, flash);
    this.clouds.update(dt, env);
    this.island.update(dt, this.time, env);
    this.controls.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.(env);
  }
}
