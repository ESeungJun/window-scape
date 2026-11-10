import * as THREE from 'three';
import type { Env } from './env';
import { softSprite, type Rng } from '../util';

const AREA = 17;
const Y_MIN = -12;
const Y_MAX = 18;
/** 영역 밖으로 나간 입자를 반대편으로 */
const wrap = (v: number) => (v > AREA ? v - AREA * 2 : v < -AREA ? v + AREA * 2 : v);

const RAINBOW_FRAGMENT = /* glsl */ `
  uniform float opacity;
  varying vec2 vPos;
  vec3 hue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float t = (length(vPos) - 22.0) / 3.0;
    float a = sin(clamp(t, 0.0, 1.0) * 3.14159) * opacity * 0.4 * smoothstep(0.0, 6.0, vPos.y);
    gl_FragColor = vec4(hue(t * 0.78), a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// 비 줄기: 방울마다 납작한 띠 하나. 자리는 셰이더가 "처음 자리 + 지금까지 흘러간 거리"를 영역 안으로 접어 구한다(CPU 가 방울을 하나씩 옮기지 않는다).
// 띠의 폭은 화면 픽셀로 고정해 고해상도 화면에서도 머리카락처럼 가늘어지지 않는다
const RAIN_VERTEX = /* glsl */ `
  uniform vec3 offset;
  uniform vec3 streak;
  uniform vec2 res;
  uniform float width;
  attribute vec3 seed;
  attribute vec2 corner;
  varying float vAlong;
  void main() {
    vec3 box = vec3(${(AREA * 2).toFixed(1)}, ${(Y_MAX - Y_MIN).toFixed(1)}, ${(AREA * 2).toFixed(1)});
    vec3 p = mod(seed + offset, box) + vec3(${(-AREA).toFixed(1)}, ${Y_MIN.toFixed(1)}, ${(-AREA).toFixed(1)});
    vec4 head = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    vec4 tail = projectionMatrix * modelViewMatrix * vec4(p + streak, 1.0);
    vAlong = corner.y;
    if (head.w <= 0.05 || tail.w <= 0.05) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    vec2 d = (tail.xy / tail.w - head.xy / head.w) * res;
    vec2 n = normalize(vec2(-d.y, d.x) + 1e-5);
    vec4 c = mix(head, tail, corner.y);
    c.xy += n * corner.x * width / res * c.w;
    gl_Position = c;
  }
`;

const RAIN_FRAGMENT = /* glsl */ `
  uniform float opacity;
  varying float vAlong;
  void main() {
    // 꼬리(위쪽)로 갈수록 옅다
    gl_FragColor = vec4(0.545, 0.672, 0.807, opacity * (1.0 - vAlong * 0.85));
    #include <colorspace_fragment>
  }
`;

/** 비·눈·번개·무지개 */
export class Precipitation {
  readonly group = new THREE.Group();
  flash = 0;

  private readonly rain: THREE.Mesh;
  private readonly rainCount = 3200;
  private readonly rainUniforms = {
    offset: { value: new THREE.Vector3() },
    streak: { value: new THREE.Vector3() },
    res: { value: new THREE.Vector2(1, 1) },
    width: { value: 1.5 },
    opacity: { value: 0.55 },
  };
  private readonly snow: THREE.Points;
  private readonly snowFlakes: Float32Array;
  private readonly bolt: THREE.Line;
  private readonly rainbow: THREE.Mesh;
  private readonly rainbowMat: THREE.ShaderMaterial;
  private readonly tmp = new THREE.Vector3();
  private strikeT = 99;
  private nextStrike = 3;

  constructor(private readonly rng: Rng) {
    const spawn = (arr: Float32Array, i: number) => {
      arr[i * 3] = (rng() - 0.5) * AREA * 2;
      arr[i * 3 + 1] = Y_MIN + rng() * (Y_MAX - Y_MIN);
      arr[i * 3 + 2] = (rng() - 0.5) * AREA * 2;
    };

    const rainCount = this.rainCount;
    const seed = new Float32Array(rainCount * 12);
    const corner = new Float32Array(rainCount * 8);
    const index = new Uint16Array(rainCount * 6);
    for (let i = 0; i < rainCount; i++) {
      const x = rng() * AREA * 2;
      const y = rng() * (Y_MAX - Y_MIN);
      const z = rng() * AREA * 2;
      for (let v = 0; v < 4; v++) {
        seed.set([x, y, z], (i * 4 + v) * 3);
        corner.set([v % 2 ? 1 : -1, v < 2 ? 0 : 1], (i * 4 + v) * 2);
      }
      const a = i * 4;
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    rainGeo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
    rainGeo.setIndex(new THREE.BufferAttribute(index, 1));
    this.rain = new THREE.Mesh(
      rainGeo,
      new THREE.ShaderMaterial({
        uniforms: this.rainUniforms,
        vertexShader: RAIN_VERTEX,
        fragmentShader: RAIN_FRAGMENT,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.rain.frustumCulled = false;

    const snowCount = 2200;
    this.snowFlakes = new Float32Array(snowCount * 3);
    for (let i = 0; i < snowCount; i++) spawn(this.snowFlakes, i);
    const snowGeo = new THREE.BufferGeometry();
    snowGeo.setAttribute('position', new THREE.BufferAttribute(this.snowFlakes, 3));
    this.snow = new THREE.Points(
      snowGeo,
      new THREE.PointsMaterial({ map: softSprite(), size: 0.3, transparent: true, opacity: 0.95, depthWrite: false }),
    );
    this.snow.frustumCulled = false;

    this.bolt = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3)),
      new THREE.LineBasicMaterial({ color: '#f4f2ff', fog: false }),
    );
    this.bolt.visible = false;
    this.bolt.frustumCulled = false;

    this.rainbowMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vPos;
        void main() { vPos = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: RAINBOW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.rainbow = new THREE.Mesh(new THREE.RingGeometry(22, 25, 128, 1, 0, Math.PI), this.rainbowMat);

    this.group.add(this.rain, this.snow, this.bolt, this.rainbow);
  }

  /**
   * @param center 비·눈을 내릴 영역의 가운데(땅 테마는 카메라가 보는 곳). 떠 있는 섬은 원점.
   * @param viewport 그리는 화면의 픽셀 크기와 픽셀 배율(비 줄기 폭을 화면 픽셀로 맞춘다)
   */
  update(dt: number, t: number, env: Env, camera: THREE.Camera, center: THREE.Vector3, viewport: { width: number; height: number; ratio: number }): void {
    const rng = this.rng;
    this.group.position.set(center.x, 0, center.z);

    // 비: 바람이 셀수록 비스듬히 떨어진다
    const rainCount = Math.floor(this.rainCount * Math.min(1, env.rain));
    this.rain.visible = rainCount > 0;
    if (rainCount > 0) {
      const vy = -26;
      const vx = env.windX * env.wind * 9;
      const vz = env.windZ * env.wind * 9;
      const u = this.rainUniforms;
      const o = u.offset.value;
      // 흘러간 거리를 영역 크기 안으로 접어 둔다(오래 켜 둬도 정밀도가 떨어지지 않게)
      o.x = (o.x + vx * dt) % (AREA * 2);
      o.y = (o.y + vy * dt) % (Y_MAX - Y_MIN);
      o.z = (o.z + vz * dt) % (AREA * 2);
      u.streak.value.set(-vx * 0.028, -vy * 0.028, -vz * 0.028);
      u.res.value.set(viewport.width, viewport.height);
      u.width.value = 1.5 * viewport.ratio;
      // 밤에는 빗줄기가 하얗게 뜨지 않게 옅게
      u.opacity.value = 0.55 * (1 - 0.5 * env.nightLights);
      (this.rain.geometry as THREE.BufferGeometry).setDrawRange(0, rainCount * 6);
    }

    // 눈: 천천히 흔들리며 내린다
    const snowCount = Math.floor((this.snowFlakes.length / 3) * Math.min(1, env.snow));
    this.snow.visible = snowCount > 0;
    if (snowCount > 0) {
      const s = this.snowFlakes;
      for (let i = 0; i < snowCount; i++) {
        const k = i * 3;
        s[k] += (Math.sin(t * 0.8 + i) * 0.4 + env.windX * env.wind * 2) * dt;
        s[k + 1] -= (1.1 + (i % 5) * 0.15) * dt;
        s[k + 2] += (Math.cos(t * 0.6 + i * 1.3) * 0.3 + env.windZ * env.wind * 2) * dt;
        if (s[k + 1] < Y_MIN) s[k + 1] += Y_MAX - Y_MIN;
        s[k] = wrap(s[k]);
        s[k + 2] = wrap(s[k + 2]);
      }
      (this.snow.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      this.snow.geometry.setDrawRange(0, snowCount);
    }

    // 번개: 번쩍-잠깐 꺼짐-번쩍 순서로 깜빡인다
    this.strikeT += dt;
    if (env.storm > 0.5) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.strikeT = 0;
        this.nextStrike = 2.5 + rng() * 6;
        this.makeBolt(camera);
      }
    }
    const s = this.strikeT;
    this.flash = s < 0.07 ? 1 : s < 0.14 ? 0.15 : s < 0.22 ? 0.7 : Math.max(0, 0.7 * Math.exp(-(s - 0.22) * 8));
    this.bolt.visible = s < 0.22 && this.flash > 0.5;

    // 무지개: 항상 섬 뒤쪽(카메라 반대편)에 선다
    this.rainbowMat.uniforms.opacity.value = env.rainbow;
    this.rainbow.visible = env.rainbow > 0.01;
    if (this.rainbow.visible) {
      const dir = this.tmp.set(camera.position.x, 0, camera.position.z).normalize();
      this.rainbow.position.set(-dir.x * 34, -7, -dir.z * 34);
      this.rainbow.lookAt(camera.position.x, -7, camera.position.z);
    }
  }

  private makeBolt(camera: THREE.Camera): void {
    const rng = this.rng;
    const dir = new THREE.Vector3(camera.position.x, 0, camera.position.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const base = dir.clone().multiplyScalar(-22 - rng() * 10).addScaledVector(side, (rng() - 0.5) * 30);
    const pos = this.bolt.geometry.getAttribute('position') as THREE.BufferAttribute;
    let x = base.x, z = base.z;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, x, 24 - i * 2.6, z);
      x += (rng() - 0.5) * 2.2;
      z += (rng() - 0.5) * 2.2;
    }
    pos.needsUpdate = true;
  }
}
