import * as THREE from 'three';
import type { Env } from './env';

/**
 * 미니어처 모양의 배경. 하늘 대신 화면 전체에 깔리는 판 하나를 셰이더로 그린다(그리기 호출 1, 텍스처 없음).
 *  - 그라데이션: 판 뒤가 은은하게 밝고 가장자리로 갈수록 짙어진다. 색은 지금 하늘(아침 복숭아, 낮 하늘, 노을, 밤 남색)에서 뽑는다
 *  - 그림자: 받침 바닥 아래 보이지 않는 바닥에 진 것처럼 흐린 타원을 깐다(판보다 먼저 그려 판 둘레로만 보인다)
 *  - 빛 알갱이: 낮에는 천천히 떠다니는 먼지, 밤에는 반짝이는 별과 반딧불
 * world.ts 가 미니어처일 때만 보이게 하고 프레임마다 update 를 부른다.
 */

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // 카메라와 상관없이 화면을 그대로 덮는다(깊이는 맨 뒤)
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float aspect;
  uniform vec3 edge;
  uniform vec3 center;
  uniform vec2 glow;
  /** x, y: 그림자 가운데(화면 -1~1), z: 가로 반지름, w: 세로 반지름 */
  uniform vec4 shadow;
  uniform float shadowAmt;
  uniform float night;
  uniform vec3 mote;
  uniform float moteAmt;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // 칸마다 알갱이 하나. 칸 안 자리와 크기, 반짝이는 박자를 칸마다 다르게
  float motes(vec2 p, float scale, vec2 drift, float size, float twinkle) {
    vec2 g = p * scale + drift * time;
    vec2 id = floor(g);
    float h = hash(id);
    // 절반쯤의 칸은 비워 둔다(고르게 깔리면 무늬처럼 보인다)
    if (h < 0.55) return 0.0;
    vec2 f = fract(g) - 0.5 - (vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5) * 0.7;
    float r = length(f) / (size * (0.5 + h));
    float tw = mix(1.0, 0.5 + 0.5 * sin(time * (1.5 + h * 3.0) + h * 40.0), twinkle);
    return (1.0 - smoothstep(0.0, 1.0, r)) * tw;
  }

  void main() {
    vec2 ndc = vUv * 2.0 - 1.0;
    vec2 p = vec2(ndc.x * aspect, ndc.y);
    // 1. 그라데이션: 판 뒤(glow)에서 멀어질수록 가장자리 색으로, 네 귀퉁이는 조금 더 어둡게
    float d = length(p - vec2(glow.x * aspect, glow.y));
    vec3 col = mix(center, edge, smoothstep(0.0, 1.35, d));
    col *= 1.0 - 0.25 * smoothstep(0.9, 1.8, length(vec2(ndc.x * 1.1, ndc.y)));
    // 2. 받침 그림자
    vec2 s = (ndc - shadow.xy) / shadow.zw;
    col *= 1.0 - shadowAmt * (1.0 - smoothstep(0.3, 1.0, length(s)));
    // 3. 빛 알갱이: 큰 것은 느리게 위로, 작은 것은 더 느리게(멀어 보이게). 밤에는 반짝임이 커진다
    float tw = night;
    // 밤에는 알갱이를 작게(눈송이처럼 보이지 않게)
    float sz = 1.0 - tw * 0.4;
    float m = motes(p, 7.0, vec2(0.012, 0.03), 0.09 * sz, 0.3 + tw * 0.7) * 0.8
            + motes(p + 13.0, 14.0, vec2(-0.006, 0.012), 0.08 * sz, 0.5 + tw * 0.5) * 0.5;
    // 판 바로 뒤는 비워 장면을 가리지 않게
    m *= smoothstep(0.25, 0.8, d);
    col += mote * m * moteAmt;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const NAVY = new THREE.Color('#23253f');
const NAVY_NIGHT = new THREE.Color('#0f1020');
const DUST = new THREE.Color('#fff2d6');
const STAR = new THREE.Color('#dfe6ff');
const FIREFLY = new THREE.Color('#ffe08a');
const FLASH = new THREE.Color('#c9d2ff');

export class Backdrop {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly u = {
    time: { value: 0 },
    aspect: { value: 1 },
    edge: { value: new THREE.Color() },
    center: { value: new THREE.Color() },
    glow: { value: new THREE.Vector2(0, 0.1) },
    shadow: { value: new THREE.Vector4(0, -0.5, 0.5, 0.15) },
    shadowAmt: { value: 0 },
    night: { value: 0 },
    mote: { value: new THREE.Color() },
    moteAmt: { value: 0 },
  };
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();

  constructor() {
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    this.mesh.name = 'mini_backdrop';
    // 화면을 덮는 판이라 카메라 시야 검사·그림자·클릭 검사에서 뺀다. 장면보다 먼저 그린다
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
  }

  /** 가장자리 색. 안개색으로도 쓴다(멀리 있는 것이 배경에 녹아들게) */
  get edgeColor(): THREE.Color {
    return this.u.edge.value;
  }

  /**
   * @param center 판 가운데(월드). 그라데이션의 밝은 곳이 이 뒤에 온다
   * @param foot 받침 바닥 가운데(월드)와 반폭. 모르면 null(그림자를 그리지 않는다)
   */
  update(dt: number, env: Env, flash: number, camera: THREE.PerspectiveCamera, center: THREE.Vector3, foot: { at: THREE.Vector3; half: number } | null, still: boolean): void {
    const u = this.u;
    if (!still) u.time.value = (u.time.value + dt) % 1000;
    u.aspect.value = camera.aspect;
    const night = env.stars;
    u.night.value = night;
    // 색은 선형 공간에서 섞는다. 하늘색이 밝아 조금만 섞어도 크게 밝아지므로 비율을 작게
    const base = u.edge.value.copy(NAVY).lerp(NAVY_NIGHT, night);
    // 가운데 빛: 하늘 아랫색과 햇빛 색(아침 복숭아, 낮 흰빛, 노을 주황, 밤 푸른 달빛)을 섞어 어둡게 눌러 쓴다
    u.center.value.copy(env.skyBottom).lerp(env.sunColor, 0.4).multiplyScalar(0.3 * (1 - night * 0.55)).lerp(base, 0.25);
    // 가장자리: 남색에 하늘 윗색을 조금(낮엔 푸르게, 밤엔 거의 그대로)
    base.lerp(env.skyTop, 0.1);
    if (flash > 0) {
      base.lerp(FLASH, flash * 0.12);
      u.center.value.lerp(FLASH, flash * 0.2);
    }
    // 밝은 곳: 판 가운데보다 조금 위(판이 화면 아래쪽을 차지하므로 뒤쪽 하늘이 빛나 보이게)
    this.tmp.copy(center).project(camera);
    u.glow.value.set(this.tmp.x, this.tmp.y + 0.15);
    // 그림자: 받침 바닥 가운데와 그 옆 한 점을 화면에 찍어 반지름을 잰다. 세로는 내려다보는 각도만큼 눌린다
    if (foot) {
      const pitch = Math.max(0.15, -camera.getWorldDirection(this.tmp2).y);
      this.tmp.copy(foot.at).project(camera);
      // 화면 오른쪽 방향(카메라 행렬의 첫 열)으로 반폭만큼 옮긴 점
      this.tmp2.setFromMatrixColumn(camera.matrixWorld, 0).normalize().multiplyScalar(foot.half).add(foot.at).project(camera);
      const rx = Math.hypot(this.tmp2.x - this.tmp.x, this.tmp2.y - this.tmp.y) * 1.35;
      u.shadow.value.set(this.tmp.x, this.tmp.y - rx * pitch * 0.25, rx, rx * camera.aspect * pitch * 0.6);
      u.shadowAmt.value = 0.45 * (1 - night * 0.4);
    } else u.shadowAmt.value = 0;
    // 알갱이: 낮 먼지는 아주 옅게, 밤에는 별(차가운 색)과 반딧불(따뜻한 색)을 섞는다. 비·눈·안개에는 줄인다
    u.mote.value.copy(DUST).lerp(STAR, night).lerp(FIREFLY, night * 0.25);
    u.moteAmt.value = (0.1 + night * 0.35) * (1 - Math.min(1, env.rain + env.snow + env.fog) * 0.8);
  }
}
