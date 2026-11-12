import * as THREE from 'three';
import { TOON_UNIFORM } from './baked';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
    vWorld = (modelMatrix * vec4(position, 1.0)).xz;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

// 미니어처(툰) 물: 깊이에 따라 또렷한 청록 → 파랑, 물가에 흰 거품선 두 줄(바깥 줄은 천천히 밀려왔다 빠진다),
// 물 위에 펜으로 그린 듯한 얇은 물결선. shore: 0 깊음 ~ 1 물가, p: 물결 무늬 좌표
const TOON = /* glsl */ `
  uniform float toon;
  uniform vec3 deep;
  uniform vec3 light;
  vec3 toonWater(vec3 col, float shore, vec2 p) {
    if (toon < 0.003) return col;
    float wob = noise(p * 0.9 + time * 0.15) - 0.5;
    // 평소 물색(deep·light)에서 뽑는다: 깊은 곳은 더 짙고 푸르게, 얕은 곳은 청록으로. 밝기는 bright 가 함께 낮춘다
    vec3 tc = mix(deep * vec3(0.45, 0.85, 1.0), light * vec3(0.7, 1.05, 0.92), smoothstep(0.15, 0.95, shore + wob * 0.12));
    // 물결선: 느리게 흐르는 무늬의 등고선 중 일부만 짧게 끊어 보이게
    float n = noise(p * 0.55 + vec2(time * 0.05, -time * 0.035));
    float iso = abs(fract(n * 5.0) - 0.5);
    float dash = smoothstep(0.55, 0.75, noise(p * 1.3 + 4.0));
    tc = mix(tc, vec3(0.85, 0.95, 1.0), (1.0 - smoothstep(0.02, 0.05, iso)) * dash * 0.55 * (1.0 - shore * 0.5));
    // 거품선: 물가 바로 앞 한 줄(고정)과 그 바깥에서 오가는 한 줄
    float e = shore + wob * 0.06;
    float tide = 0.78 + sin(time * 0.6) * 0.03;
    float foam = (1.0 - smoothstep(0.012, 0.03, abs(e - 0.9))) + (1.0 - smoothstep(0.01, 0.025, abs(e - tide))) * 0.75;
    tc = mix(tc, vec3(0.92), clamp(foam, 0.0, 1.0) * 0.85);
    tc = mix(tc, vec3(0.92), smoothstep(0.95, 1.0, e) * 0.8);
    return mix(col, tc, toon);
  }
`;

// vUv.x: 강폭 방향(0~1), vUv.y: 흐르는 방향 누적 거리
const RIVER_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float bright;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  ${NOISE}
  ${TOON}
  void main() {
    // 강폭 방향으로는 촘촘하고 흐르는 방향으로는 길게 늘어진 결이 물살을 따라 천천히 내려간다
    float edge = abs(vUv.x - 0.5) * 2.0;
    float flow = noise(vec2(vUv.x * 4.0, vUv.y * 0.9 - time * 0.9));
    float ripple = noise(vec2(vUv.x * 10.0 + 3.0, vUv.y * 1.8 - time * 1.3));
    vec3 col = mix(deep, light, smoothstep(0.3, 1.0, edge) * 0.5 + flow * 0.2);
    col += smoothstep(0.75, 0.92, ripple) * 0.14;
    col = mix(col, vec3(0.95), smoothstep(0.85, 1.0, edge) * 0.35);
    // 강은 흐르는 방향으로 무늬를 끌고 내려간다
    col = toonWater(col, edge * 0.9, vec2(vUv.x * 3.0, vUv.y * 0.6 - time * 0.5));
    gl_FragColor = vec4(col * bright, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// 고인 물(바다·호수·연못): 흐르지 않고 제자리에서 느리게 일렁인다. vUv.x: 물가 정도(0.5 깊음 ~ 1 물가), vWorld: 위치
const STILL_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float bright;
  uniform float rain;
  uniform float ice;
  varying vec2 vUv;
  varying vec2 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}
  ${TOON}
  // 빗방울이 떨어진 자리에서 퍼지는 동심원(칸마다 하나씩, 박자를 달리해 되풀이)
  float rings(vec2 p) {
    vec2 g = p * 1.7;
    vec2 id = floor(g);
    vec2 c = fract(g) - 0.5 - (vec2(hash(id), hash(id + 5.3)) - 0.5) * 0.5;
    float ph = fract(time * 0.85 + hash(id + 2.1));
    return (1.0 - smoothstep(0.0, 0.035, abs(length(c) - ph * 0.42))) * (1.0 - ph);
  }
  void main() {
    float shore = (vUv.x - 0.5) * 2.0;
    float a = noise(vWorld * 0.22 + vec2(time * 0.03, time * 0.02));
    float b = noise(vWorld * 0.7 + vec2(-time * 0.03, time * 0.04));
    vec3 col = mix(deep, light, smoothstep(0.2, 1.0, shore) * 0.5 + (a * 0.6 + b * 0.4) * 0.14);
    // 햇빛에 반짝이는 작은 잔물결
    col += smoothstep(0.86, 0.97, noise(vWorld * 2.4 + vec2(time * 0.1, -time * 0.08))) * 0.07;
    col = mix(col, vec3(0.95), smoothstep(0.88, 1.0, shore) * 0.3);
    col = toonWater(col, shore, vWorld);
    if (rain > 0.01) col += (rings(vWorld) + rings(vWorld * 1.9 + 7.0) * 0.6) * rain * 0.22;
    // 영하면 물가부터 얼어 들어온다(얼음은 잔물결 없이 희푸르다)
    if (ice > 0.01) {
      float frozen = smoothstep(1.0 - ice * 1.15, 1.08 - ice * 0.9, shore * 0.5 + 0.5 + (a - 0.5) * 0.25);
      col = mix(col, vec3(0.8, 0.88, 0.93) + (b - 0.5) * 0.06, frozen * 0.9);
    }
    gl_FragColor = vec4(col * bright, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

// vUv.x: 폭 방향(0~1), vUv.y: 떨어진 정도(0 위 ~ 1 아래)
const FALL_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float bright;
  uniform vec3 light;
  varying vec2 vUv;
  ${NOISE}
  void main() {
    float s = vUv.y;
    float streak = noise(vec2(vUv.x * 14.0, s * 3.0 - time * 2.6));
    float streak2 = noise(vec2(vUv.x * 30.0 + 7.0, s * 7.0 - time * 3.8));
    float foam = smoothstep(0.45, 0.85, streak * 0.6 + streak2 * 0.5);
    vec3 col = mix(light, vec3(1.0), foam * 0.8 + s * 0.5);
    float ragged = noise(vec2(s * 9.0 - time * 1.5, vUv.x * 3.0)) * 0.12;
    float side = smoothstep(0.0, 0.16 + ragged, vUv.x) * (1.0 - smoothstep(0.84 - ragged, 1.0, vUv.x));
    float fade = 1.0 - smoothstep(0.35, 1.0, s);
    gl_FragColor = vec4(col * bright, side * fade * (0.6 + 0.4 * foam));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function riverMaterial(still = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 },
      bright: { value: 1 },
      rain: { value: 0 },
      ice: { value: 0 },
      deep: { value: new THREE.Color('#2f8cc4') },
      light: { value: new THREE.Color('#8fd8f2') },
      // 복제하지 않고 나눠 쓴다(미니어처를 켜면 모든 물이 함께 바뀐다)
      toon: TOON_UNIFORM,
    },
    vertexShader: VERTEX,
    fragmentShader: still ? STILL_FRAGMENT : RIVER_FRAGMENT,
    side: THREE.DoubleSide,
    // 땅 테마의 먼 바다·강이 지평선에서 하늘에 녹아들게
    fog: true,
  });
}

export function fallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      bright: { value: 1 },
      light: { value: new THREE.Color('#9fe0f7') },
    },
    vertexShader: VERTEX,
    fragmentShader: FALL_FRAGMENT,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
}
