import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Env } from './env';

/**
 * Blender 에서 직접 모델링한 소품 모음(public/models/props.glb, 만드는 법: tools/blender/props.py).
 * 앱 시작 때 한 번 불러 두고, 테마들은 이름으로 복제해 쓴다. 못 불러오면 kit 의 단순한 도형으로 대신한다.
 */

/** 계절·눈에 따라 색이 바뀌는 재질(모델의 재질 이름 → 색) */
export const SEASONAL: Record<string, (env: Env, out: THREE.Color) => void> = {
  grass: (e, c) => c.copy(e.grass),
  leaf_orange: (e, c) => c.copy(e.foliageA),
  leaf_red: (e, c) => c.copy(e.foliageB),
  leaf_yellow: (e, c) => c.copy(e.foliageA).offsetHSL(0.035, 0, 0.07),
  leaf_green: (e, c) => c.copy(e.grass).multiplyScalar(0.8),
  leafA: (e, c) => c.copy(e.foliageA),
  leafB: (e, c) => c.copy(e.foliageB),
  pine: (e, c) => c.copy(e.pine),
  bush: (e, c) => c.copy(e.grass).multiplyScalar(0.72),
};

const protos = new Map<string, THREE.Object3D>();
const seasonal: [THREE.MeshStandardMaterial, (env: Env, out: THREE.Color) => void][] = [];
const glass: THREE.MeshStandardMaterial[] = [];
let leafB: THREE.MeshStandardMaterial | undefined;

/** 모델의 재질 중 계절 색·밤 불빛을 따라야 하는 것을 등록한다(섬 모델도 쓴다) */
export function trackMaterials(root: THREE.Object3D, list = seasonal, lights = glass): void {
  const seen = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = mesh.receiveShadow = true;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (seen.has(m)) return;
    seen.add(m);
    if (SEASONAL[m.name]) list.push([m, SEASONAL[m.name]]);
    if (m.name === 'glass') lights.push(m);
  });
}

export async function loadProps(): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync('models/props.glb');
    // 둥근 나무 잎은 재질 하나(leaf)로 만들었다. 잎 색 두 가지(A·B)로 나눠 쓴다
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!m || m.name !== 'leaf') return;
      m.name = 'leafA';
      leafB ??= Object.assign(m.clone(), { name: 'leafB' });
    });
    trackMaterials(gltf.scene);
    if (leafB) seasonal.push([leafB, SEASONAL.leafB]);
    for (const child of gltf.scene.children) protos.set(child.name, child);
  } catch (e) {
    console.warn('소품 모델을 못 불러와 단순한 도형으로 그립니다', e);
  }
}

export const hasProps = () => protos.size > 0;

/** 소품 하나를 복제한다(지오메트리·재질은 공유). useLeafB 면 잎을 B 색으로 */
export function prop(name: string, useLeafB = false): THREE.Object3D | undefined {
  const p = protos.get(name);
  if (!p) return undefined;
  const c = p.clone();
  if (useLeafB && leafB) {
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && (mesh.material as THREE.Material).name === 'leafA') mesh.material = leafB!;
    });
  }
  return c;
}

/** 소품을 이루는 (지오메트리, 재질) 목록. 인스턴스로 많이 그릴 때(나무 숲) 쓴다 */
export function propParts(name: string, useLeafB = false): [THREE.BufferGeometry, THREE.Material][] | undefined {
  const p = prop(name, useLeafB);
  if (!p) return undefined;
  const parts: [THREE.BufferGeometry, THREE.Material][] = [];
  p.updateMatrixWorld(true);
  p.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // 소품 기준점에서의 위치를 지오메트리에 굽는다(보통은 그대로)
    const geo = mesh.matrixWorld.equals(new THREE.Matrix4()) ? mesh.geometry : mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    parts.push([geo, mesh.material as THREE.Material]);
  });
  return parts;
}

/** 계절 색과 밤 창문 불빛. 프레임마다 한 번 */
export function updateProps(env: Env): void {
  for (const [m, fn] of seasonal) fn(env, m.color);
  for (const m of glass) m.emissiveIntensity = 0.15 + env.nightLights * 2.6;
}
