import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Env } from './env';
import { enableSway } from './baked';

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
const gltfLoader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));

/** 모델을 끝내 못 불러왔을 때 window 에 보내는 이벤트(화면에 안내를 띄운다) */
export const MODEL_ERROR = 'model-error';

/** 모델을 불러온다. 못 불러오면(잠깐 끊긴 네트워크·바쁜 디스크) 간격을 늘려 가며 몇 번 더 해 본다 */
export function loadModel(url: string, onLoad: (root: THREE.Group) => void, tries = 4): void {
  gltfLoader.load(url, (gltf) => onLoad(gltf.scene), undefined, (e) => {
    if (tries <= 1) {
      console.error(`모델을 못 불러왔습니다: ${url}`, e);
      window.dispatchEvent(new Event(MODEL_ERROR));
    } else setTimeout(() => loadModel(url, onLoad, tries - 1), (5 - tries) * 1500);
  });
}

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

/**
 * 나무(tree_*)의 재질을 복제해 바람에 흔들리게 한다. 원래 재질은 통나무·덤불처럼 흔들리면 안 되는 물체와 같이 쓰므로 그대로 둔다.
 * 계절 색·라이트맵을 붙이기 전에 불러야 복제본도 같이 등록된다.
 */
export function swayTrees(root: THREE.Object3D): void {
  const copies = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  for (const tree of root.children) {
    if (!tree.name.startsWith('tree_')) continue;
    tree.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!mesh.isMesh || !m?.isMeshStandardMaterial) return;
      let copy = copies.get(m);
      if (!copy) {
        copy = m.clone();
        enableSway(copy);
        copies.set(m, copy);
      }
      mesh.material = copy;
    });
  }
}
