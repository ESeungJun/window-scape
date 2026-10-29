import * as THREE from 'three';

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

// vUv.x: 강폭 방향(0~1), vUv.y: 흐르는 방향 누적 거리
const RIVER_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float bright;
  uniform vec3 deep;
  uniform vec3 light;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    // 강폭 방향으로는 촘촘하고 흐르는 방향으로는 길게 늘어진 결이 물살을 따라 천천히 내려간다
    float edge = abs(vUv.x - 0.5) * 2.0;
    float flow = noise(vec2(vUv.x * 4.0, vUv.y * 0.9 - time * 0.9));
    float ripple = noise(vec2(vUv.x * 10.0 + 3.0, vUv.y * 1.8 - time * 1.3));
    vec3 col = mix(deep, light, smoothstep(0.3, 1.0, edge) * 0.5 + flow * 0.2);
    col += smoothstep(0.75, 0.92, ripple) * 0.14;
    col = mix(col, vec3(0.95), smoothstep(0.85, 1.0, edge) * 0.35);
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
  uniform vec3 deep;
  uniform vec3 light;
  varying vec2 vUv;
  varying vec2 vWorld;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    float shore = (vUv.x - 0.5) * 2.0;
    float a = noise(vWorld * 0.22 + vec2(time * 0.03, time * 0.02));
    float b = noise(vWorld * 0.7 + vec2(-time * 0.03, time * 0.04));
    vec3 col = mix(deep, light, smoothstep(0.2, 1.0, shore) * 0.5 + (a * 0.6 + b * 0.4) * 0.14);
    // 햇빛에 반짝이는 작은 잔물결
    col += smoothstep(0.86, 0.97, noise(vWorld * 2.4 + vec2(time * 0.1, -time * 0.08))) * 0.07;
    col = mix(col, vec3(0.95), smoothstep(0.88, 1.0, shore) * 0.3);
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
      deep: { value: new THREE.Color('#2f8cc4') },
      light: { value: new THREE.Color('#8fd8f2') },
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
