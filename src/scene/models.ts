import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * public/models 의 GLB 를 불러온다. 파일마다 한 번만 내려받고,
 * 부를 때마다 복제본을 돌려준다(재질·지오메트리는 공유).
 *
 * 캐릭터는 같은 사람형 뼈대(Hips·Spine·LeftArm…)로 리깅돼 있어서
 * models/anims 의 동작 클립을 어느 캐릭터에나 그대로 입힐 수 있다.
 */
const loader = new GLTFLoader();
// 구운 디오라마는 메시를 meshopt 로 압축해 둔다
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();
const url = (path: string) => `${import.meta.env.BASE_URL}models/${path}.glb`;

function fetchGltf(path: string): Promise<GLTF> {
  let p = cache.get(path);
  if (!p) {
    p = loader.loadAsync(url(path)).then((gltf) => {
      gltf.scene.traverse((o) => {
        if (!(o instanceof THREE.Mesh)) return;
        o.castShadow = true;
        o.receiveShadow = true;
        // AI 생성 텍스처는 금속·광택값이 제각각이라 장면의 무광 재질에 맞춘다
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m instanceof THREE.MeshStandardMaterial) {
            m.metalness = 0;
            m.roughness = 0.85;
          }
        }
      });
      return gltf;
    });
    cache.set(path, p);
  }
  return p;
}

/** 모델을 height 높이로 맞추고 발밑 중심을 원점에 둔다. yaw 만큼 돌려 pivot 에 담아 holder 에 넣는다 */
function mount(holder: THREE.Group, model: THREE.Object3D, height: number, yaw: number): void {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, true);
  const size = box.getSize(new THREE.Vector3());
  const s = height / size.y;
  model.scale.multiplyScalar(s);
  model.position.set(-(box.min.x + size.x / 2) * s, -box.min.y * s, -(box.min.z + size.z / 2) * s);
  const pivot = new THREE.Group();
  pivot.add(model);
  pivot.rotation.y = yaw;
  holder.add(pivot);
}

/**
 * 움직이지 않는 모델(건물·배경). height 는 세로 크기, fit 을 주면 가로·세로 중 큰 쪽을 fit 에 맞춘다.
 * 받은 그룹은 바로 장면에 넣어도 되고, 모델은 내려받는 대로 안에 채워진다.
 */
export function prop(name: string, height: number, yaw = 0): THREE.Group {
  const holder = new THREE.Group();
  fetchGltf(name)
    .then((g) => mount(holder, g.scene.clone(true), height, yaw))
    .catch((e) => console.warn(`[models] ${name} 불러오기 실패`, e));
  return holder;
}

/** 바닥 크기(가로·세로 중 큰 쪽)를 span 에 맞추는 배경 디오라마 */
export function diorama(name: string, span: number, yaw = 0): THREE.Group {
  const holder = new THREE.Group();
  fetchGltf(name).then((g) => {
    const model = g.scene.clone(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    mount(holder, model, (size.y * span) / Math.max(size.x, size.z), yaw);
  }).catch((e) => console.warn(`[models] ${name} 불러오기 실패`, e));
  return holder;
}

export type Motion = 'idle' | 'walk' | 'wave' | 'jump';
const MOTIONS: Motion[] = ['idle', 'walk', 'wave', 'jump'];

/**
 * 사람 체형 동작을 통통한 포켓몬에 그대로 입히면 팔다리를 크게 휘둘러 몸이 늘어난다.
 * 기본 자세와 섞어 동작 폭을 이만큼으로 줄인다.
 */
const MOTION_WEIGHT = 0.38;

/** 동작 클립: 뼈 회전만 쓴다(이동·크기 트랙은 원래 캐릭터 체형에 묶여 있다) */
const clips = Promise.all(MOTIONS.map((m) => fetchGltf(`anims/${m}`).then((g) => {
  const clip = g.animations[0];
  clip.name = m;
  clip.tracks = clip.tracks.filter((t) => t.name.endsWith('.quaternion'));
  return clip;
})));

/** 리깅된 캐릭터. play 로 동작을 바꾸고 update 를 프레임마다 부른다 */
export class Actor {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private readonly actions = new Map<Motion, THREE.AnimationAction>();
  private current: Motion = 'idle';
  private onFinish: (() => void) | null = null;

  constructor(name: string, height: number, yaw = 0) {
    Promise.all([fetchGltf(name), clips]).then(([g, all]) => {
      const model = cloneSkinned(g.scene);
      // 뼈가 움직인 뒤의 경계를 따라가지 않아 엉뚱한 각도에서 화면 밖으로 잘려 사라진다
      model.traverse((o) => { if (o instanceof THREE.SkinnedMesh) o.frustumCulled = false; });
      mount(this.group, model, height, yaw);
      const mixer = new THREE.AnimationMixer(model);
      for (const clip of all) {
        const a = mixer.clipAction(clip);
        a.setEffectiveWeight(0);
        a.play();
        this.actions.set(clip.name as Motion, a);
      }
      // 한 번만 하는 동작(손 흔들기·점프)은 끝나면 대기로 돌아간다
      for (const m of ['wave', 'jump'] as const) {
        const a = this.actions.get(m)!;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      mixer.addEventListener('finished', () => {
        const done = this.onFinish;
        this.onFinish = null;
        this.play('idle');
        done?.();
      });
      this.actions.get(this.current)!.setEffectiveWeight(MOTION_WEIGHT);
      // 같은 동작이 여러 캐릭터에서 똑같이 맞물려 보이지 않게 시작점을 흩는다
      mixer.setTime(Math.random() * 5);
      this.mixer = mixer;
    }).catch((e) => console.warn(`[models] ${name} 불러오기 실패`, e));
  }

  get motion(): Motion {
    return this.current;
  }

  /** 동작을 바꾼다. 한 번만 하는 동작이면 끝난 뒤 then 을 부른다 */
  play(m: Motion, then?: () => void): void {
    if (m === this.current && !then) return;
    const from = this.actions.get(this.current);
    const to = this.actions.get(m);
    this.current = m;
    this.onFinish = then ?? null;
    if (!from || !to) return; // 아직 내려받는 중: 다 받으면 current 로 시작한다
    if (m === 'wave' || m === 'jump') to.reset();
    to.setEffectiveWeight(MOTION_WEIGHT);
    if (from !== to) {
      from.setEffectiveWeight(0);
      to.time = m === 'walk' || m === 'idle' ? to.time : 0;
    }
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }
}

/** 낮 그림자·밤 불빛을 구워 넣은 디오라마의 재질: 낮(map)과 밤(emissiveMap) 텍스처를 섞어 그대로 보여 준다 */
export class BakedMaterial extends THREE.ShaderMaterial {
  constructor(day: THREE.Texture, night: THREE.Texture | null) {
    super({
      uniforms: {
        day: { value: day },
        night: { value: night ?? day },
        mixNight: { value: 0 },
        tint: { value: new THREE.Color('#ffffff') },
        flash: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D day;
        uniform sampler2D night;
        uniform float mixNight;
        uniform vec3 tint;
        uniform float flash;
        varying vec2 vUv;
        void main() {
          vec3 c = mix(texture2D(day, vUv).rgb, texture2D(night, vUv).rgb, mixNight);
          gl_FragColor = vec4(c * tint + flash * 0.35, 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }
}

/** 구운 디오라마. 받은 뒤 모든 메시에 BakedMaterial 을 입히고, 그 재질 목록을 돌려준다 */
export function baked(name: string, onLoad: (mats: BakedMaterial[]) => void): THREE.Group {
  const holder = new THREE.Group();
  loader.loadAsync(url(name)).then((gltf) => {
    const mats: BakedMaterial[] = [];
    gltf.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const src = o.material as THREE.MeshStandardMaterial;
      const m = new BakedMaterial(src.map!, src.emissiveMap);
      o.material = m;
      mats.push(m);
    });
    holder.add(gltf.scene);
    onLoad(mats);
  }).catch((e) => console.warn(`[models] ${name} 불러오기 실패`, e));
  return holder;
}
