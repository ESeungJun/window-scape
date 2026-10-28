import * as THREE from 'three';
import type { Env } from './env';

const VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float clear;
  uniform float flash;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = mix(bottom, top, pow(clamp(h * 1.15 + 0.08, 0.0, 1.0), 0.75));
    // 수평선 아래는 섬 밑 허공: 조금 더 짙게
    col = mix(col, bottom * 0.78, smoothstep(0.0, -0.5, h));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    col += sunColor * (pow(s, 900.0) * 3.0 + pow(s, 10.0) * 0.3) * clear;
    col += vec3(0.55, 0.6, 0.8) * flash;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export class SkyDome {
  readonly group = new THREE.Group();
  private readonly uniforms = {
    top: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    clear: { value: 1 },
    flash: { value: 0 },
  };
  private readonly starMat: THREE.PointsMaterial;

  constructor() {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(400, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    dome.renderOrder = -10;
    dome.frustumCulled = false;
    this.group.add(dome);

    const count = 1400;
    const pos = new Float32Array(count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      do v.randomDirection(); while (v.y < 0.05);
      v.multiplyScalar(380).toArray(pos, i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false,
    });
    this.group.add(new THREE.Points(geo, this.starMat));
  }

  update(env: Env, sunDir: THREE.Vector3, flash: number): void {
    const u = this.uniforms;
    u.top.value.copy(env.skyTop);
    u.bottom.value.copy(env.skyBottom);
    u.sunDir.value.copy(sunDir);
    u.sunColor.value.copy(env.sunColor);
    u.clear.value = 1 - env.overcast * 0.9;
    u.flash.value = flash;
    this.starMat.opacity = env.stars;
    this.starMat.visible = env.stars > 0.01;
  }
}

const ENV_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 bottom;
  uniform vec3 ground;
  varying vec3 vDir;
  void main() {
    float h = normalize(vDir).y;
    vec3 sky = mix(bottom, top, smoothstep(0.0, 0.8, h));
    gl_FragColor = vec4(mix(sky, ground, smoothstep(0.02, -0.25, h)), 1.0);
  }
`;

/**
 * 하늘 그라데이션(위: 하늘, 아래: 땅에서 튀는 빛)을 환경광으로 굽는다.
 * 그늘진 면이 하늘색을 받아 탁하지 않게 된다. 색이 눈에 띄게 바뀔 때만 64px 로 다시 굽는다.
 */
export class SkyLight {
  private readonly pmrem: THREE.PMREMGenerator;
  private readonly scene = new THREE.Scene();
  private readonly uniforms = {
    top: { value: new THREE.Color() },
    bottom: { value: new THREE.Color() },
    ground: { value: new THREE.Color() },
  };
  private readonly baked = [new THREE.Color(-1, -1, -1), new THREE.Color(), new THREE.Color()];
  private target?: THREE.WebGLRenderTarget;
  private wait = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(10, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX, fragmentShader: ENV_FRAGMENT, side: THREE.BackSide }),
    ));
  }

  /** 다시 구웠으면 새 환경맵을, 그대로면 null 을 돌려준다 */
  update(dt: number, env: Env): THREE.Texture | null {
    this.wait -= dt;
    if (this.wait > 0) return null;
    const u = this.uniforms;
    u.top.value.copy(env.skyTop);
    u.bottom.value.copy(env.skyBottom);
    // 땅에서 튀어 오르는 빛: 잔디색에 하늘 밝기를 곱한다(밤에는 거의 검게)
    u.ground.value.copy(env.grass).multiply(env.skyBottom).multiplyScalar(0.6);
    const cur = [u.top.value, u.bottom.value, u.ground.value];
    let diff = 0;
    cur.forEach((c, i) => (diff += Math.abs(c.r - this.baked[i].r) + Math.abs(c.g - this.baked[i].g) + Math.abs(c.b - this.baked[i].b)));
    if (diff < 0.01) return null;
    cur.forEach((c, i) => this.baked[i].copy(c));
    this.wait = 0.3;
    this.target?.dispose();
    this.target = this.pmrem.fromScene(this.scene, 0, 0.1, 100, { size: 64 });
    return this.target.texture;
  }
}
