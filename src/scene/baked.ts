import * as THREE from 'three';
import type { Env } from './env';

/**
 * 빛을 구운 장면(라이트맵). Blender 에서 "하늘에서만 오는 흰 간접광 + 틈 그늘"을 구워 두고,
 * 앱에서는 그 값에 지금 하늘빛(시간대·날씨)을 곱한다. 해·달 빛과 밤 불빛만 실시간으로 얹는다.
 */

/** 라이트맵에 곱할 하늘빛. 모든 구운 재질이 같은 값을 쓴다 */
const skyTint = { value: new THREE.Color(1, 1, 1) };

function patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.skyTint = skyTint;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform vec3 skyTint;\nvoid main() {')
    .replace(
      '#include <lights_fragment_maps>',
      THREE.ShaderChunk.lights_fragment_maps.replace('lightMapTexel.rgb * lightMapIntensity', 'lightMapTexel.rgb * lightMapIntensity * skyTint'),
    );
}

/** 모델의 (UV 가 있는) 재질에 라이트맵을 붙인다. 하늘 환경광은 라이트맵이 대신하므로 끈다 */
export function applyLightmap(root: THREE.Object3D, url: string): void {
  // 그림을 다 받은 뒤에 붙인다(받기 전에 붙이면 빈 텍스처라 그늘이 잠깐 검게 나온다)
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // glTF 의 UV 는 위아래가 뒤집혀 있다
    tex.flipY = false;
    tex.channel = 0;
    attach(root, tex);
  });
}

/** 굽지 않은 먼 풍경(far_*)의 재질: 구운 땅의 탁 트인 면과 같은 빛을 받게 흰 라이트맵을 붙인다 */
export function applyOpenSky(m: THREE.MeshStandardMaterial): void {
  openSky ??= Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { needsUpdate: true });
  use(m, openSky);
  // 구운 땅의 트인 면은 하늘빛 1 에 밝은 땅에서 튄 빛이 더해져 약 1.25 다(타일 가장자리 안팎 화면 밝기로 맞춘 값)
  m.lightMapIntensity = Math.PI * 1.25;
}

let openSky: THREE.DataTexture | undefined;

function use(m: THREE.MeshStandardMaterial, tex: THREE.Texture): void {
  m.lightMap = tex;
  // 구운 값 1 = 하얀 하늘 아래 트인 면. three 의 확산 반사는 1/π 를 곱하므로 π 를 곱해 둔다
  m.lightMapIntensity = Math.PI;
  m.envMapIntensity = 0;
  m.onBeforeCompile = patch;
  m.needsUpdate = true;
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
    use(m, tex);
  });
}

const white = new THREE.Color(1, 1, 1);

/** 하늘빛을 시간대·날씨에 맞춘다. 장면 고유색이 덜 흔들리게 하늘색을 하양 쪽으로 반쯤 당긴다. 프레임마다 한 번 */
export function updateSkyTint(env: Env, flash: number): void {
  // 밤에는 하양으로 덜 당겨 푸른 달빛 느낌을 살린다
  skyTint.value.copy(env.hemiSky).lerp(white, 0.45 - env.stars * 0.3).multiplyScalar(env.hemiIntensity * 0.3 + flash * 0.8);
}
