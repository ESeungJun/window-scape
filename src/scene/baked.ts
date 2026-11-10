import * as THREE from 'three';
import type { Env } from './env';

/**
 * 빛을 구운 장면(라이트맵). Blender 에서 "하늘에서만 오는 흰 간접광 + 틈 그늘"을 구워 두고,
 * 앱에서는 그 값에 지금 하늘빛(시간대·날씨)을 곱한다. 해·달 빛만 실시간 조명으로 얹는다.
 *
 * 같은 셰이더 패치가 날씨도 그린다. 추가 그리기 호출·텍스처 없이 재질 셰이더 안에서 끝낸다.
 *  - 눈: 위를 보는 면에 쌓인다(지붕·바위·울타리 윗면, 나무는 윗부분만)
 *  - 젖은 땅: 비가 오면 어둡고 조금 번들거린다
 *  - 구름 그늘: 바람 방향으로 흐르는 얼룩이 햇빛을 가린다(구름이 그림자 맵에 들어가지 않는다)
 *  - 밤 불빛: 등불 자리에서 번지는 따뜻한 빛(PointLight 를 쓰지 않아 낮에는 계산하지 않는다)
 *  - 바람: 나무 잎이 위쪽일수록 크게 흔들린다(WS_SWAY 를 켠 재질만)
 */

export const MAX_LAMPS = 8;

/** 모든 재질이 같이 쓰는 값. 프레임마다 updateSurface 가 채운다 */
const U = {
  skyTint: { value: new THREE.Color(1, 1, 1) },
  wsSnow: { value: 0 },
  wsSnowColor: { value: new THREE.Color('#eef3f8') },
  wsWet: { value: 0 },
  /** x, y: 구름 그늘이 흘러간 거리, z: 세기 */
  wsShade: { value: new THREE.Vector3() },
  wsNight: { value: 0 },
  wsLampColor: { value: new THREE.Color('#ffc46b') },
  wsLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector3()) },
  wsLampCount: { value: 0 },
  /** 1 이면 라이트맵 알파에 구운 불빛을 쓴다(tools/blender 의 WS_NEXT=lamps 로 내보낸 모델) */
  wsLampBaked: { value: 0 },
  /** x, z: 바람 방향, y: 흔들리는 폭, w: 누적 위상 */
  wsSway: { value: new THREE.Vector4() },
};

const VERTEX_PARS = /* glsl */ `
  varying vec3 wsPos;
  #ifdef WS_SWAY
    uniform vec4 wsSway;
  #endif
`;

// 나무: 물체 기준 높이(position.y)가 높을수록 크게, 자리(modelMatrix 의 이동)마다 다른 박자로 흔들린다
const VERTEX_SWAY = /* glsl */ `
  #ifdef WS_SWAY
    float swH = smoothstep(0.25, 2.6, position.y);
    vec3 swAt = modelMatrix[3].xyz;
    float swP = swAt.x * 1.3 + swAt.z * 1.7;
    float swBend = sin(wsSway.w + swP + position.y * 1.1) * 0.6 + sin(wsSway.w * 2.3 + swP * 1.7) * 0.3 + 0.35;
    vec2 swXZ = wsSway.xz * swBend;
    // 잎 떨림
    swXZ += vec2(sin(wsSway.w * 5.1 + position.z * 9.0 + swP), cos(wsSway.w * 4.3 + position.x * 9.0 + swP)) * 0.14;
    vec3 swLocal = vec3(swXZ.x, 0.0, swXZ.y) * mat3(modelMatrix);
    transformed += swLocal * (wsSway.y * swH / dot(modelMatrix[0].xyz, modelMatrix[0].xyz));
  #endif
`;

const VERTEX_WORLD = /* glsl */ `
  vec4 wsP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    wsP = instanceMatrix * wsP;
  #endif
  wsPos = (modelMatrix * wsP).xyz;
`;

const FRAGMENT_PARS = /* glsl */ `
  uniform vec3 skyTint;
  uniform float wsSnow;
  uniform vec3 wsSnowColor;
  uniform float wsWet;
  uniform vec3 wsShade;
  uniform float wsNight;
  uniform vec3 wsLampColor;
  uniform vec3 wsLamps[${MAX_LAMPS}];
  uniform int wsLampCount;
  uniform float wsLampBaked;
  varying vec3 wsPos;
  float wsHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wsNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wsHash(i), wsHash(i + vec2(1.0, 0.0)), f.x), mix(wsHash(i + vec2(0.0, 1.0)), wsHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;

// 바탕색: 눈과 젖음. 월드 법선은 뷰 법선을 되돌려 구한다
const FRAGMENT_ALBEDO = /* glsl */ `
  vec3 wsN = vec3(0.0, 1.0, 0.0);
  #ifndef FLAT_SHADED
    wsN = inverseTransformDirection(normalize(vNormal), viewMatrix);
    #ifdef DOUBLE_SIDED
      wsN *= gl_FrontFacing ? 1.0 : -1.0;
    #endif
  #endif
  float wsUp = wsN.y;
  float wsSnowAmt = 0.0;
  if (wsSnow > 0.003) {
    // 가장자리가 고르지 않게 얼룩을 섞고, 눈이 적을 때는 아주 평평한 면부터 쌓인다
    float lump = wsNoise(wsPos.xz * 2.3) * 0.5 + wsNoise(wsPos.xz * 7.0) * 0.2;
    wsSnowAmt = smoothstep(0.86 - wsSnow * 0.5, 1.02 - wsSnow * 0.34, wsUp + lump * 0.3) * min(1.0, wsSnow * 1.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, wsSnowColor, wsSnowAmt);
  }
  float wsWetAmt = wsWet * (1.0 - wsSnowAmt) * (0.55 + 0.45 * max(wsUp, 0.0));
  diffuseColor.rgb *= 1.0 - 0.3 * wsWetAmt;
`;

const FRAGMENT_ROUGHNESS = /* glsl */ `
  roughnessFactor = mix(roughnessFactor, 0.38, wsWetAmt * 0.7);
`;

// 조명 뒤: 구름 그늘은 햇빛(직접광)만 가리고, 밤 불빛은 그 뒤에 더한다
const FRAGMENT_LIGHTS = /* glsl */ `
  if (wsShade.z > 0.003) {
    float cs = wsNoise(wsPos.xz * 0.11 + wsShade.xy) * 0.65 + wsNoise(wsPos.xz * 0.27 + wsShade.xy * 1.6) * 0.35;
    float shade = 1.0 - wsShade.z * smoothstep(0.42, 0.7, cs);
    reflectedLight.directDiffuse *= shade;
    reflectedLight.directSpecular *= shade;
  }
  if (wsNight > 0.003) {
    float lampSum = 0.0;
    #ifdef USE_LIGHTMAP
      if (wsLampBaked > 0.5) lampSum = lightMapTexel.a;
      else
    #endif
    {
      for (int i = 0; i < ${MAX_LAMPS}; i++) {
        if (i >= wsLampCount) break;
        vec3 toLamp = wsLamps[i] - wsPos;
        float d = length(toLamp);
        // three 의 점광 감쇠(거리 7, 감쇠 1.6)와 같은 식
        float fall = pow2(saturate(1.0 - pow4(d / 7.0))) / max(pow(d, 1.6), 0.01);
        lampSum += fall * max(dot(wsN, toLamp / d), 0.0);
      }
    }
    reflectedLight.directDiffuse += lampSum * wsNight * 7.0 * wsLampColor * BRDF_Lambert(material.diffuseColor);
  }
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, U);
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', `${VERTEX_PARS}\nvoid main() {`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERTEX_SWAY}`)
    .replace('#include <project_vertex>', `${VERTEX_WORLD}\n#include <project_vertex>`);
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', `${FRAGMENT_PARS}\nvoid main() {`)
    .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAGMENT_ALBEDO}`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAGMENT_ROUGHNESS}`)
    .replace(
      '#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps.replace('lightMapTexel.rgb * lightMapIntensity', 'lightMapTexel.rgb * lightMapIntensity * skyTint'),
    )
    .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>\n${FRAGMENT_LIGHTS}`);
}

/** 날씨 셰이더(눈·젖음·구름 그늘·밤 불빛)를 재질에 붙인다. 라이트맵이 없는 재질(떠다니는 섬·덩굴)에도 쓴다 */
export function applyWeather(m: THREE.MeshStandardMaterial): void {
  m.onBeforeCompile = patch;
  m.needsUpdate = true;
}

/** 이 재질을 쓰는 물체가 바람에 흔들리게 한다(나무). 재질을 나눠 쓰는 다른 물체까지 흔들리지 않게 복제본에만 건다 */
export function enableSway(m: THREE.MeshStandardMaterial): void {
  m.defines = { ...m.defines, WS_SWAY: '' };
  m.needsUpdate = true;
}

/** 모델의 (UV 가 있는) 재질에 라이트맵을 붙인다. 하늘 환경광은 라이트맵이 대신하므로 끈다 */
export function applyLightmap(root: THREE.Object3D, url: string, onTexture?: (tex: THREE.Texture) => void): void {
  // 그림을 다 받은 뒤에 붙인다(받기 전에 붙이면 빈 텍스처라 그늘이 잠깐 검게 나온다)
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // glTF 의 UV 는 위아래가 뒤집혀 있다
    tex.flipY = false;
    tex.channel = 0;
    attach(root, tex);
    onTexture?.(tex);
  });
}

/** 굽지 않은 먼 풍경(far_*)의 재질: 구운 땅의 탁 트인 면과 같은 빛을 받게 흰 라이트맵을 붙인다 */
export function applyOpenSky(m: THREE.MeshStandardMaterial): void {
  use(m, openSky());
  // 구운 땅의 트인 면은 하늘빛 1 에 밝은 땅에서 튄 빛이 더해져 약 1.25 다(타일 가장자리 안팎 화면 밝기로 맞춘 값)
  m.lightMapIntensity = Math.PI * 1.25;
}

let openSkyTex: THREE.DataTexture | undefined;

/** 1픽셀 흰 라이트맵. 모든 테마가 같이 쓰므로 테마를 해제할 때 지우지 않는다. 알파는 0(구운 불빛 없음) */
export function openSky(): THREE.DataTexture {
  openSkyTex ??= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1), { needsUpdate: true });
  return openSkyTex;
}

function use(m: THREE.MeshStandardMaterial, tex: THREE.Texture): void {
  m.lightMap = tex;
  // 구운 값 1 = 하얀 하늘 아래 트인 면. three 의 확산 반사는 1/π 를 곱하므로 π 를 곱해 둔다
  m.lightMapIntensity = Math.PI;
  m.envMapIntensity = 0;
  applyWeather(m);
}

function attach(root: THREE.Object3D, tex: THREE.Texture): void {
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.uv) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    // 물처럼 따로 그리는 셰이더 재질은 건너뛴다
    if (done.has(m) || !m.isMeshStandardMaterial) return;
    done.add(m);
    // 먼 풍경·받침은 이미 흰 라이트맵을 받았다
    if (m.lightMap) return;
    use(m, tex);
  });
}

const white = new THREE.Color(1, 1, 1);

export interface SurfaceOptions {
  /** 구름 그늘을 그릴지 */
  shade: boolean;
  /** 나무 흔들림을 그릴지 */
  sway: boolean;
}

/** 지금 보이는 테마의 밤 불빛 자리(월드 좌표). 테마가 바뀌거나 섬이 오르내릴 때 다시 넣는다 */
export function setLamps(points: THREE.Vector3[], baked = false): void {
  const n = Math.min(points.length, MAX_LAMPS);
  for (let i = 0; i < n; i++) U.wsLamps.value[i].copy(points[i]);
  U.wsLampCount.value = n;
  U.wsLampBaked.value = baked ? 1 : 0;
}

let swayPhase = 0;

/** 하늘빛과 날씨 값을 셰이더에 넘긴다. 프레임마다 한 번 */
export function updateSurface(dt: number, env: Env, flash: number, opts: SurfaceOptions): void {
  // 하늘빛: 장면 고유색이 덜 흔들리게 하늘색을 하양 쪽으로 반쯤 당긴다. 밤에는 덜 당겨 푸른 달빛 느낌을 살린다
  U.skyTint.value.copy(env.hemiSky).lerp(white, 0.45 - env.stars * 0.3).multiplyScalar(env.hemiIntensity * 0.3 + flash * 0.8);
  U.wsSnow.value = env.snowCover;
  U.wsWet.value = env.wet;
  U.wsNight.value = env.nightLights;
  // 구름 그늘: 구름이 띄엄띄엄 있을 때 가장 뚜렷하고, 맑거나 온통 흐리면 없다
  const s = U.wsShade.value;
  const drift = (0.25 + env.wind * 1.4) * dt * 0.11;
  s.x -= env.windX * drift;
  s.y -= env.windZ * drift;
  s.z = opts.shade ? 0.5 * Math.min(1, env.cloudCover * 1.6) * (1 - env.overcast) : 0;
  // 나무 흔들림: 위상은 dt 로 누적한다(시간에 바람 세기를 곱하면 바람이 바뀌는 순간 위상이 튄다)
  swayPhase = (swayPhase + dt * (1.1 + env.wind * 1.6)) % 1000;
  U.wsSway.value.set(env.windX, opts.sway ? 0.012 + env.wind * 0.13 : 0, env.windZ, swayPhase);
}
