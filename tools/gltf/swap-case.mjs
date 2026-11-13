// 테마 glb 의 땅 단면(case_*)만 새것으로 갈아 끼운다. 단면은 라이트맵을 굽지 않는 부품이라, 단면을 고칠 때마다
// 테마 전체를 다시 굽지 않아도 된다(Blender: blender -b -P tools/blender/<테마>.py -- <폴더> case → <테마>_case.glb).
// 노드 이름·extras(layout)는 앱이 이름으로 찾으므로 건드리지 않는다. 마지막에 optimize.mjs 와 같은 압축을 한다.
// 사용: node tools/gltf/swap-case.mjs <테마.glb> <테마_case.glb> [출력.glb(기본: 테마.glb 덮어쓰기)]
import { NodeIO, PropertyType } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, draco, mergeDocuments, prune, unpartition, weld } from '@gltf-transform/functions'
import draco3d from 'draco3dgltf'
import { statSync } from 'node:fs'

const [basePath, casePath, outPath = basePath] = process.argv.slice(2)
if (!basePath || !casePath) {
  console.error('사용: node tools/gltf/swap-case.mjs <테마.glb> <테마_case.glb> [출력.glb]')
  process.exit(1)
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
})

const isCase = (n) => n.getName().startsWith('case_')
const base = await io.read(basePath)
const parts = await io.read(casePath)
const scene = base.getRoot().getDefaultScene() ?? base.getRoot().listScenes()[0]

// 1. 옛 단면을 지운다(메시는 아래 prune 이 치운다)
const old = base.getRoot().listNodes().filter(isCase)
for (const n of old) n.dispose()

// 2. 새 단면 문서를 합치고, 그 장면의 단면 노드를 테마 장면으로 옮긴다
const map = mergeDocuments(base, parts)
const added = []
for (const s of parts.getRoot().listScenes()) {
  const merged = map.get(s)
  for (const child of merged.listChildren()) {
    if (!isCase(child)) continue
    scene.addChild(child)
    added.push(child.getName())
  }
  merged.dispose()
}
if (!added.length) throw new Error(`${casePath} 에 case_* 노드가 없다`)

// 3. 버퍼를 하나로 모으고 안 쓰는 것을 치운 뒤 optimize.mjs 와 같은 설정으로 압축
await base.transform(
  unpartition(),
  prune({ keepLeaves: true, keepAttributes: true, keepExtras: true }),
  weld(),
  dedup({ propertyTypes: [PropertyType.ACCESSOR, PropertyType.MESH] }),
  draco({ method: 'edgebreaker', quantizePosition: 14, quantizeNormal: 10, quantizeColor: 8, quantizeTexcoord: 12 }),
)
await io.write(outPath, base)
console.log(`${outPath}: 단면 ${old.length}개 → ${added.length}개 (${added.join(', ')}), ${(statSync(outPath).size / 1024).toFixed(0)} KB`)
