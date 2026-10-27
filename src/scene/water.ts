import * as THREE from 'three';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
      time: { value: 0 },
      bright: { value: 1 },
      deep: { value: new THREE.Color('#2f8cc4') },
      light: { value: new THREE.Color('#8fd8f2') },
    },
    vertexShader: VERTEX,
    fragmentShader: RIVER_FRAGMENT,
    side: THREE.DoubleSide,
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

// 둥근 연못. vUv 중심(0.5,0.5)에서 가장자리까지 r=0~1
const POND_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float bright;
  uniform vec3 deep;
  uniform vec3 light;
  uniform vec2 ripple;
  varying vec2 vUv;
  ${NOISE}
  float waves(vec2 p) {
    return noise(p * 6.0 + vec2(time * 0.35, time * 0.2)) * 0.6
         + noise(p * 13.0 - vec2(time * 0.5, -time * 0.4)) * 0.4;
  }
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    // 잔물결 높이를 미분해 반짝이는 면을 만든다
    float h = waves(vUv);
    float hx = waves(vUv + vec2(0.004, 0.0)) - h;
    float hy = waves(vUv + vec2(0.0, 0.004)) - h;
    // 헤엄치는 포켓몬 둘레로 번지는 동심원
    float d = length(vUv - ripple) * 2.0;
    float ring = sin(d * 38.0 - time * 3.2) * exp(-d * 5.0);
    vec3 n = normalize(vec3(-hx * 18.0 - ring * (vUv.x - ripple.x) * 6.0, 1.0, -hy * 18.0 - ring * (vUv.y - ripple.y) * 6.0));
    float spec = pow(max(dot(n, normalize(vec3(0.35, 1.0, 0.45))), 0.0), 220.0);
    float depth = smoothstep(1.0, 0.15, r);
    vec3 col = mix(light, deep, depth);
    col += (h - 0.5) * 0.12;
    col += spec * 1.4 + max(ring, 0.0) * 0.08;
    // 물가: 얕아지며 밝아지고 물거품이 일렁인다
    float foam = smoothstep(0.84, 0.97, r + noise(vec2(atan(p.y, p.x) * 6.0, time * 0.6)) * 0.06);
    col = mix(col, vec3(0.96), foam * 0.75);
    float alpha = 1.0 - smoothstep(0.97, 1.0, r);
    gl_FragColor = vec4(col * bright, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function pondMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      bright: { value: 1 },
      deep: { value: new THREE.Color('#1f6fa8') },
      light: { value: new THREE.Color('#7fd3ea') },
      ripple: { value: new THREE.Vector2(0.5, 0.5) },
    },
    vertexShader: VERTEX,
    fragmentShader: POND_FRAGMENT,
    transparent: true,
  });
}
