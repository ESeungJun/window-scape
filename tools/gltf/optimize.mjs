// public/models/*.glb 후처리(Blender 없이 할 수 있는 것).
//  1) 닫힌 도형(모든 모서리를 두 면이 서로 반대 방향으로 나눠 갖고, 부피가 양수)만으로 된 프리미티브는 재질을 한 면으로 바꾼다.
//     열린 면(땅·돛·깃발·꽃)이 섞인 프리미티브는 양면 그대로 둔다.
//  2) 같은 값 정점 병합(weld), 같은 접근자·메시 합치기(dedup), Draco 로 다시 압축.
// 노드 이름·extras(layout)·재질 이름은 앱이 이름으로 찾으므로 건드리지 않는다(prune·join·flatten 을 쓰지 않는다).
// 사용: node optimize.mjs <입력 폴더> <출력 폴더> [--no-draco]
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, draco, weld } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const [src, out, ...flags] = process.argv.slice(2)
const THEMES = ['island', 'drive', 'city', 'castle', 'forest']
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
})

/** 프리미티브가 닫힌 바깥 방향 도형으로만 이뤄졌는지. 위치가 같은 정점은 하나로 보고 판단한다 */
function isClosed(positions, indices) {
  const n = positions.length / 3
  const key = new Map(), id = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    const k = `${Math.round(positions[i * 3] * 1e4)},${Math.round(positions[i * 3 + 1] * 1e4)},${Math.round(positions[i * 3 + 2] * 1e4)}`
    let v = key.get(k)
    if (v === undefined) { v = key.size; key.set(k, v) }
    id[i] = v
  }
  const V = key.size
  const tri = indices ? indices.length / 3 : n / 3
  const at = (t, c) => id[indices ? indices[t * 3 + c] : t * 3 + c]
  const parent = new Uint32Array(V).map((_, i) => i)
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  // 방향 있는 모서리 수: a→b 가 한 번, b→a 가 한 번이어야 닫힌 면
  const edges = new Map()
  let degenerate = 0
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2)
    if (a === b || b === c || c === a) { degenerate++; continue }
    for (const [p, q] of [[a, b], [b, c], [c, a]]) { const k = p * V + q; edges.set(k, (edges.get(k) ?? 0) + 1) }
    parent[find(a)] = find(b); parent[find(b)] = find(c)
  }
  const bad = new Set()
  for (const [k, cnt] of edges) {
    const p = Math.floor(k / V), q = k % V
    if (cnt !== 1 || edges.get(q * V + p) !== 1) bad.add(find(p))
  }
  // 덩어리마다 부피 부호(바깥을 보는 면이면 양수)
  const vol = new Map()
  const P = (t, c) => { const i = (indices ? indices[t * 3 + c] : t * 3 + c) * 3; return [positions[i], positions[i + 1], positions[i + 2]] }
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2)
    if (a === b || b === c || c === a) continue
    const [ax, ay, az] = P(t, 0), [bx, by, bz] = P(t, 1), [cx, cy, cz] = P(t, 2)
    const v = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
    const r = find(a); vol.set(r, (vol.get(r) ?? 0) + v)
  }
  let unsafe = 0
  for (let t = 0; t < tri; t++) {
    const a = at(t, 0)
    if (a === at(t, 1) || at(t, 1) === at(t, 2) || at(t, 2) === a) continue
    const r = find(a)
    if (bad.has(r) || (vol.get(r) ?? 0) <= 0) unsafe++
  }
  return { tri, unsafe, degenerate }
}

function count(doc) {
  let verts = 0, tris = 0, two = 0
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const v = p.getAttribute('POSITION').getCount(); verts += v
    tris += (p.getIndices() ? p.getIndices().getCount() : v) / 3
  }
  for (const m of doc.getRoot().listMaterials()) if (m.getDoubleSided()) two++
  return { verts, tris, mats: doc.getRoot().listMaterials().length, twoSided: two, meshes: doc.getRoot().listMeshes().length }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!src || !out) { console.error('사용: node optimize.mjs <입력 폴더> <출력 폴더> [--no-draco]'); process.exit(1) }
  mkdirSync(out, { recursive: true })
  for (const name of THEMES) {
    const doc = await io.read(join(src, `${name}.glb`))
    const before = count(doc)
    const single = new Map()
    let oneTris = 0, twoTris = 0
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial()
      if (!mat || !mat.getDoubleSided()) continue
      const r = isClosed(prim.getAttribute('POSITION').getArray(), prim.getIndices()?.getArray())
      if (r.unsafe > 0) { twoTris += r.tri; continue }
      oneTris += r.tri
      // 같은 재질을 열린 면도 쓰면 재질을 둘로 나눈다(이름은 그대로: 앱이 이름으로 계절 색·불빛을 찾는다)
      if (!single.has(mat)) single.set(mat, mat.clone().setDoubleSided(false))
      prim.setMaterial(single.get(mat))
    }
    // 아무도 안 쓰게 된 양면 재질은 지운다
    for (const m of doc.getRoot().listMaterials()) if (m.listParents().every((p) => p.propertyType === PropertyType.ROOT)) m.dispose()
    await doc.transform(weld(), dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }))
    if (!flags.includes('--no-draco')) await doc.transform(draco({ method: 'edgebreaker', quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12 }))
    await io.write(join(out, `${name}.glb`), doc)
    const after = count(await io.read(join(out, `${name}.glb`)))
    const kb = (p) => (statSync(p).size / 1048576).toFixed(2) + 'MB'
    console.log(`${name}: ${kb(join(src, `${name}.glb`))} → ${kb(join(out, `${name}.glb`))} · 정점 ${before.verts} → ${after.verts} · 삼각형 ${before.tris} → ${after.tris} · 메시 ${before.meshes} → ${after.meshes} · 재질 ${before.mats}(양면 ${before.twoSided}) → ${after.mats}(양면 ${after.twoSided}) · 한 면이 된 삼각형 ${oneTris} / 양면 유지 ${twoTris}`)
  }
}
