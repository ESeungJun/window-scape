import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Env } from './env';

/**
 * Blender 에서 직접 모델링한 테마 모델(public/models/*.glb, 만드는 법: tools/blender)을 불러오는 도구.
 * 계절 색·밤 불빛을 따라야 하는 재질을 이름으로 골라 둔다.
 */

/** 계절·눈에 따라 색이 바뀌는 재질(모델의 재질 이름 → 색) */
export const SEASONAL: Record<string, (env: Env, out: THREE.Color) => void> = {
  grass: (e, c) => c.copy(e.grass),
  leaf_orange: (e, c) => c.copy(e.foliageA),
  leaf_red: (e, c) => c.copy(e.foliageB),
  leaf_yellow: (e, c) => c.copy(e.foliageA).offsetHSL(0.035, 0, 0.07),
  leaf_green: (e, c) => c.copy(e.grass).multiplyScalar(0.8),
  leaf_rust: (e, c) => c.copy(e.foliageB).offsetHSL(-0.012, 0, -0.07),
  pine: (e, c) => c.copy(e.pine),
  bush: (e, c) => c.copy(e.grass).multiplyScalar(0.72),
  grass_dark: (e, c) => c.copy(e.grass).multiplyScalar(0.75),
};

/** 모델 불러오기(Blender 에서 draco 로 압축해 내보낸다. 해독기는 public/draco) */
export const gltfLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));

/** 모델의 재질 중 계절 색·밤 불빛을 따라야 하는 것을 등록한다 */
export function trackMaterials(
  root: THREE.Object3D,
  list: [THREE.MeshStandardMaterial, (env: Env, out: THREE.Color) => void][],
  lights: THREE.MeshStandardMaterial[],
): void {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (seen.has(m)) return;
    seen.add(m);
    if (SEASONAL[m.name]) list.push([m, SEASONAL[m.name]]);
    if (m.name === 'glass' || m.name === 'fire') lights.push(m);
  });
}
