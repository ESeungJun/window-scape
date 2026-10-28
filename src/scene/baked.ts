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
  const tex = new THREE.TextureLoader().load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  // glTF 의 UV 는 위아래가 뒤집혀 있다
  tex.flipY = false;
  tex.channel = 0;
  const done = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry.attributes.uv) return;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (done.has(m)) return;
    done.add(m);
    m.lightMap = tex;
    // 구운 값 1 = 하얀 하늘 아래 트인 면. three 의 확산 반사는 1/π 를 곱하므로 π 를 곱해 둔다
    m.lightMapIntensity = Math.PI;
    m.envMapIntensity = 0;
    m.onBeforeCompile = patch;
    m.needsUpdate = true;
  });
}

const white = new THREE.Color(1, 1, 1);

/** 하늘빛을 시간대·날씨에 맞춘다. 장면 고유색이 덜 흔들리게 하늘색을 하양 쪽으로 반쯤 당긴다. 프레임마다 한 번 */
export function updateSkyTint(env: Env, flash: number): void {
  skyTint.value.copy(env.hemiSky).lerp(white, 0.45).multiplyScalar(env.hemiIntensity * 0.3 + flash * 0.8);
}
