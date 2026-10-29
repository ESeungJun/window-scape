import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vUv = uv;
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
    float edge = abs(vUv.x - 0.5) * 2.0;
    float flow = noise(vec2(vUv.x * 3.0, vUv.y * 1.2 - time * 1.4));
    float ripple = noise(vec2(vUv.x * 7.0 + 3.0, vUv.y * 2.5 - time * 2.2));
    vec3 col = mix(deep, light, smoothstep(0.2, 1.0, edge) * 0.6 + flow * 0.25);
    col += smoothstep(0.72, 0.9, ripple) * 0.35;
    col = mix(col, vec3(0.95), smoothstep(0.8, 1.0, edge) * 0.6);
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

export function riverMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      time: { value: 0 },
      bright: { value: 1 },
      deep: { value: new THREE.Color('#2f8cc4') },
      light: { value: new THREE.Color('#8fd8f2') },
    },
    vertexShader: VERTEX,
    fragmentShader: RIVER_FRAGMENT,
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
