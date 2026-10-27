import * as THREE from 'three';
import type { Env } from './env';
import { softSprite, type Rng } from '../util';

const AREA = 17;
const Y_MIN = -12;
const Y_MAX = 18;

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

/** 비·눈·번개·무지개 */
export class Precipitation {
  readonly group = new THREE.Group();
  flash = 0;

  private readonly rain: THREE.LineSegments;
  private readonly rainDrops: Float32Array; // x, y, z
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

    const rainCount = 3200;
    this.rainDrops = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) spawn(this.rainDrops, i);
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rainCount * 6), 3));
    this.rain = new THREE.LineSegments(
      rainGeo,
      new THREE.LineBasicMaterial({ color: '#c3d6e8', transparent: true, opacity: 0.5, depthWrite: false }),
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

  update(dt: number, t: number, env: Env, camera: THREE.Camera): void {
    const rng = this.rng;

    // 비: 바람이 셀수록 비스듬히 떨어진다
    const rainCount = Math.floor((this.rainDrops.length / 3) * Math.min(1, env.rain));
    this.rain.visible = rainCount > 0;
    if (rainCount > 0) {
      const vy = -26;
      const vx = env.wind * 9;
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = pos.array as Float32Array;
      const d = this.rainDrops;
      for (let i = 0; i < rainCount; i++) {
        const k = i * 3;
        d[k] += vx * dt;
        d[k + 1] += vy * dt;
        if (d[k + 1] < Y_MIN) d[k + 1] += Y_MAX - Y_MIN;
        if (d[k] > AREA) d[k] -= AREA * 2;
        const o = i * 6;
        out[o] = d[k]; out[o + 1] = d[k + 1]; out[o + 2] = d[k + 2];
        out[o + 3] = d[k] - vx * 0.028; out[o + 4] = d[k + 1] - vy * 0.028; out[o + 5] = d[k + 2];
      }
      pos.needsUpdate = true;
      this.rain.geometry.setDrawRange(0, rainCount * 2);
    }

    // 눈: 천천히 흔들리며 내린다
    const snowCount = Math.floor((this.snowFlakes.length / 3) * Math.min(1, env.snow));
    this.snow.visible = snowCount > 0;
    if (snowCount > 0) {
      const s = this.snowFlakes;
      for (let i = 0; i < snowCount; i++) {
        const k = i * 3;
        s[k] += (Math.sin(t * 0.8 + i) * 0.4 + env.wind * 2) * dt;
        s[k + 1] -= (1.1 + (i % 5) * 0.15) * dt;
        s[k + 2] += Math.cos(t * 0.6 + i * 1.3) * 0.3 * dt;
        if (s[k + 1] < Y_MIN) s[k + 1] += Y_MAX - Y_MIN;
        if (s[k] > AREA) s[k] -= AREA * 2;
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
