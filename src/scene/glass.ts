import * as THREE from 'three';
import type { Env } from './env';

/**
 * 창 유리. 풍경 앞에 화면을 덮는 삼각형 하나를 마지막에 그린다(그리기 호출 1, 추가 패스 없음).
 * 비가 오면 방울이 맺혀 흘러내리고, 춥고 습하면 가장자리에 김이, 영하면 모서리에 성에가 낀다.
 * 풍경을 다시 읽지 않으므로 굴절은 없다. 방울은 밝은 점과 어두운 테로, 김·성에는 반투명 흰 막으로 그린다.
 * 마우스로 끌면 그 자리의 김이 닦였다가 천천히 다시 낀다.
 */

const MAX_WIPES = 12;
/** 닦은 자리에 김이 다시 끼는 데 걸리는 시간(초) */
const WIPE_LIFE = 9;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float aspect;
  uniform float rain;
  uniform float mist;
  uniform float frost;
  uniform float slant;
  uniform float dim;
  uniform vec3 tint;
  uniform vec3 wipes[${MAX_WIPES}];
  varying vec2 vUv;

  float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 h2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), f.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  // 맺힌 방울: 칸마다 하나. 생겼다가 커지고 사라지기를 되풀이한다. 돌려주는 값: xy = 방울 가운데에서 본 방향, z = 방울 안쪽 정도
  vec3 beads(vec2 uv, float cells, float amount) {
    vec2 g = uv * cells;
    vec2 id = floor(g);
    vec2 r = h2(id);
    float life = fract(time * (0.03 + r.x * 0.05) + r.y);
    float on = step(r.x, amount) * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.7, 1.0, life));
    vec2 c = (fract(g) - 0.5) - (r - 0.5) * 0.55;
    float rad = (0.1 + 0.16 * h1(id + 7.3)) * (0.6 + 0.4 * life);
    float d = length(c) / rad;
    return vec3(c / rad, (1.0 - smoothstep(0.75, 1.0, d)) * on);
  }

  // 흘러내리는 방울: 세로로 긴 칸을 따라 내려가고, 지나간 자리에 물길을 남긴다. z = 방울, w(반환 a) = 물길
  vec4 runners(vec2 uv, float cols, float amount) {
    vec2 g = vec2(uv.x * cols, uv.y * 3.0);
    float col = floor(g.x);
    float r = h1(vec2(col, 3.1));
    float on = step(r, amount);
    float speed = 0.07 + 0.16 * h1(vec2(col, 9.7));
    // 가다 서다 하며 내려간다
    float t = time * speed + r * 17.0;
    float y = fract(-(t + 0.12 * sin(t * 6.0)));
    float x = (fract(g.x) - 0.5) + 0.16 * sin(uv.y * 9.0 + r * 40.0) * 0.5;
    float dy = fract(g.y - y * 3.0 + 0.5) - 0.5;
    vec2 c = vec2(x, dy * 0.3) / 0.075;
    float head = (1.0 - smoothstep(0.7, 1.0, length(c))) * on;
    // 방울 위쪽(지나온 쪽)으로 가늘어지는 물길
    float above = fract(g.y - y * 3.0 + 0.5) - 0.5;
    float trail = (1.0 - smoothstep(0.012, 0.035, abs(x))) * (1.0 - smoothstep(0.0, 0.5, above)) * step(0.0, above) * on;
    return vec4(c, head, trail);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p = vec2(uv.x * aspect, uv.y);
    // 바람이 불면 방울이 비스듬히 흐른다
    p.x += (uv.y - 0.5) * slant;
    vec3 col = vec3(0.0);
    float a = 0.0;

    // 닦은 자리(0 닦임 ~ 1 그대로)
    float kept = 1.0;
    if (mist > 0.01 || frost > 0.01) {
      for (int i = 0; i < ${MAX_WIPES}; i++) {
        float age = time - wipes[i].z;
        if (age < 0.0 || age > ${WIPE_LIFE.toFixed(1)}) continue;
        float d = length((uv - wipes[i].xy) * vec2(aspect, 1.0));
        float hole = 1.0 - smoothstep(0.055, 0.1, d);
        kept *= 1.0 - hole * (1.0 - smoothstep(${(WIPE_LIFE * 0.45).toFixed(1)}, ${WIPE_LIFE.toFixed(1)}, age));
      }
    }

    // 방울
    float drop = 0.0;
    float trail = 0.0;
    vec2 n = vec2(0.0);
    if (rain > 0.01) {
      vec3 b1 = beads(p, 10.0, rain * 0.35);
      vec3 b2 = beads(p + 3.7, 19.0, rain * 0.5);
      vec4 r1 = runners(p, 9.0, rain * 0.45);
      vec4 r2 = runners(p + vec2(0.37, 0.2), 16.0, rain * 0.35);
      drop = max(max(b1.z, b2.z * 0.8), max(r1.z, r2.z));
      n = b1.z >= drop ? b1.xy : b2.z * 0.8 >= drop ? b2.xy : r1.z >= drop ? r1.xy : r2.xy;
      trail = max(r1.w, r2.w);
    }

    // 김: 가장자리와 아래쪽이 짙다. 방울과 물길, 닦은 자리는 걷힌다
    if (mist > 0.01) {
      vec2 e = abs(uv - 0.5) * 2.0;
      float edge = smoothstep(0.5, 1.1, max(e.x, e.y) + (0.5 - uv.y) * 0.2);
      float cloudy = 0.6 + 0.4 * vnoise(p * 3.0 + 4.0);
      float m = mist * (0.05 + 0.95 * edge) * cloudy * kept;
      m *= 1.0 - max(drop, trail * 0.85);
      col = tint;
      a = m * 0.5;
    }

    // 성에: 모서리에서 자라는 얼음 결정
    if (frost > 0.01) {
      vec2 e = abs(uv - 0.5) * 2.0;
      // 가장자리에 가까울수록, 모서리일수록 먼저 언다
      float reach = max(e.x, e.y) * 0.75 + e.x * e.y * 0.45 + vnoise(p * 4.0) * 0.22;
      vec2 g = p * 34.0;
      vec2 id = floor(g);
      float f1 = 9.0;
      float f2 = 9.0;
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
        vec2 o = vec2(float(i), float(j));
        float d = length(o + h2(id + o) - fract(g));
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      // 결정 사이의 가는 선이 밝게 빛난다
      float veins = 1.0 - smoothstep(0.0, 0.14, f2 - f1);
      float limit = 1.14 - frost * 0.42;
      float grow = smoothstep(limit, limit + 0.2, reach);
      float fr = grow * (0.4 + 0.4 * veins) * (0.35 + 0.65 * kept);
      vec3 ice = mix(tint, vec3(1.0), 0.6) * (0.8 + 0.2 * veins);
      col = mix(col, ice, fr / max(fr + a * (1.0 - fr), 0.001));
      a = fr + a * (1.0 - fr);
    }

    // 방울의 빛: 왼쪽 위에 밝은 점, 아래쪽 테는 어둡다
    if (drop > 0.01) {
      float spec = pow(max(dot(normalize(vec3(n * 0.9, 0.6)), normalize(vec3(-0.45, 0.6, 0.66))), 0.0), 9.0);
      float rim = smoothstep(0.35, 1.0, length(n)) * (1.0 - smoothstep(-0.9, 0.2, n.y));
      float da = drop * (0.1 + 0.34 * rim);
      vec3 dc = mix(vec3(0.03, 0.05, 0.08), tint * 0.55, 0.35);
      col = mix(col, dc, da / max(da + a * (1.0 - da), 0.001));
      a = da + a * (1.0 - da);
      float sp = spec * drop * 0.8;
      col = mix(col, vec3(1.0), sp / max(sp + a * (1.0 - sp), 0.001));
      a = sp + a * (1.0 - sp);
    }
    gl_FragColor = vec4(col * dim, a);
    #include <colorspace_fragment>
  }
`;

export class Glass {
  readonly mesh: THREE.Mesh;
  private readonly uniforms = {
    time: { value: 0 },
    aspect: { value: 1 },
    rain: { value: 0 },
    mist: { value: 0 },
    frost: { value: 0 },
    slant: { value: 0 },
    dim: { value: 1 },
    tint: { value: new THREE.Color('#ffffff') },
    wipes: { value: Array.from({ length: MAX_WIPES }, () => new THREE.Vector3(0, 0, -1000)) },
  };
  private next = 0;
  private lastX = -1;
  private lastY = -1;
  enabled = false;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        fog: false,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000;
    this.mesh.visible = false;
  }

  /** 끌어서 김을 닦는다. x, y 는 화면 비율 좌표(0~1, y 는 위가 1) */
  wipe(x: number, y: number): void {
    if (!this.mesh.visible) return;
    const u = this.uniforms;
    if (u.mist.value < 0.03 && u.frost.value < 0.03) return;
    // 조금 움직였을 때만 새 자리를 남긴다
    if (Math.hypot((x - this.lastX) * u.aspect.value, y - this.lastY) < 0.04) return;
    this.lastX = x;
    this.lastY = y;
    u.wipes.value[this.next].set(x, y, u.time.value);
    this.next = (this.next + 1) % MAX_WIPES;
  }

  /**
   * @param still 움직임 줄이기: 방울이 흐르지 않고 맺혀만 있다
   */
  update(dt: number, env: Env, aspect: number, still: boolean): void {
    const u = this.uniforms;
    const show = this.enabled && (env.rain > 0.02 || env.mist > 0.03 || env.frost > 0.03);
    this.mesh.visible = show;
    if (!show) return;
    // 며칠 켜 둬도 정밀도가 떨어지지 않게 한 시간마다 접는다(닦은 자국은 그때 지워진다)
    if (!still) u.time.value = (u.time.value + dt) % 3600;
    u.aspect.value = aspect;
    u.rain.value = Math.min(1, env.rain);
    u.mist.value = env.mist;
    u.frost.value = env.frost;
    u.slant.value = env.windX * env.wind * 0.35;
    // 김·성에는 하늘빛을 머금는다. 밤에는 어둡게
    u.tint.value.copy(env.skyBottom).lerp(WHITE, 0.6);
    u.dim.value = Math.min(1, 0.25 + env.hemiIntensity * 0.55);
  }
}

const WHITE = new THREE.Color('#ffffff');
