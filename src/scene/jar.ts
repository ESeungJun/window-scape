import * as THREE from 'three';

/**
 * 미니어처 모양의 유리 돔. Diorama 가 모델을 불러온 뒤 나무 받침(case_plinth, tools/blender/tile.py 의 case()) 윗면에 얹고,
 * 미니어처 모양일 때만 보인다.
 *
 * 생김새: 둥근 네모 몸통이 곧게 서다가 위에서 둥글게 닫힌다(진열장 속 미니어처를 덮는 유리 돔).
 * 유리는 빛 계산 없이 가장자리일수록 진해지는 반투명(프레넬)과 세로 반사 줄 두 개로만 그린다.
 * 뒤쪽 면(BackSide)을 먼저, 앞쪽 면을 나중에 그려 두 겹이 겹쳐 보이게 한다. 그림자는 드리우지 않는다.
 */

/** 돔 아래 둘레: 받침 윗면(반 폭 9.1 - 0.14)보다 조금 안쪽 */
const DOME_HALF = 8.75;
const DOME_R = 1.3;
/** 곧은 몸통 위 둥근 지붕 높이 */
const CAP = 5.0;
/** 둥근 네모 둘레를 같은 개수의 점으로 나눈다(층마다 이어 붙일 수 있게) */
const SIDE_PTS = 6;
const ARC_PTS = 8;

/** 반 폭 half, 모서리 반지름 r 인 둥근 네모 둘레 점(x, z) */
function roundedSquare(half: number, r: number): [number, number][] {
  const pts: [number, number][] = [];
  const c = half - r;
  // 모서리 네 개: 가운데(±c, ±c)에서 시작 각도마다 호를 그리고, 다음 모서리까지 곧은 변
  const corners: [number, number, number][] = [
    [c, c, 0],
    [-c, c, Math.PI / 2],
    [-c, -c, Math.PI],
    [c, -c, (Math.PI * 3) / 2],
  ];
  corners.forEach(([cx, cz, a0], k) => {
    for (let i = 0; i < ARC_PTS; i++) {
      const a = a0 + (i / ARC_PTS) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
    // 호 끝(a0 + 90°)에서 다음 모서리 호 시작까지 곧은 변
    const [nx, nz, na] = corners[(k + 1) % 4];
    const sx = cx + Math.cos(a0 + Math.PI / 2) * r;
    const sz = cz + Math.sin(a0 + Math.PI / 2) * r;
    const ex = nx + Math.cos(na) * r;
    const ez = nz + Math.sin(na) * r;
    for (let i = 0; i < SIDE_PTS; i++) {
      const t = i / SIDE_PTS;
      pts.push([sx + (ex - sx) * t, sz + (ez - sz) * t]);
    }
  });
  return pts;
}

/** (높이, 반 폭, 모서리 반지름) 층들을 이어 돔 옆면을 만들고, 맨 위는 한 점으로 모은다(바닥은 받침이 막는다) */
function lathe(levels: [number, number, number][]): THREE.BufferGeometry {
  const rings = levels.map(([y, half, r]) => roundedSquare(half, r).map(([x, z]) => [x, y, z] as const));
  const m = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  for (let l = 0; l < rings.length - 1; l++) {
    for (let i = 0; i < m; i++) {
      const a = l * m + i;
      const b = l * m + ((i + 1) % m);
      idx.push(a, a + m, b, b, a + m, b + m);
    }
  }
  // 위: 맨 위 둘레에서 가운데 점으로 부채꼴(돔 꼭대기)
  const top = pos.length / 3;
  const last = (rings.length - 1) * m;
  pos.push(0, levels[levels.length - 1][0] + 0.02, 0);
  for (let i = 0; i < m; i++) idx.push(top, last + ((i + 1) % m), last + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform float bright;
  uniform float back;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec3 n = normalize(vNormal);
    vec3 v = normalize(vView);
    // 뒤쪽 면은 법선이 카메라 반대쪽이므로 뒤집어 같은 식을 쓴다
    if (back > 0.5) n = -n;
    float f = 1.0 - abs(dot(n, v));
    // 가장자리(윤곽)에만 진하게 남기고 정면은 거의 비친다(답답해 보이지 않게)
    float fres = pow(f, 5.0);
    // 세로 반사 줄: 화면 기준 법선 x 가 특정 값인 곳(왼쪽 굵은 줄, 오른쪽 가는 줄)
    float streak = smoothstep(0.045, 0.0, abs(n.x + 0.55)) + 0.6 * smoothstep(0.02, 0.0, abs(n.x - 0.42));
    streak *= (1.0 - back) * step(0.0, n.y + 0.6);
    float a = 0.008 + 0.38 * fres + 0.24 * streak;
    a *= mix(1.0, 0.3, back);
    vec3 tint = vec3(0.94, 0.98, 0.98);
    vec3 col = mix(tint, vec3(1.0), clamp(streak + fres * 0.5, 0.0, 1.0)) * bright;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.5));
  }
`;

export class Jar {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  /**
   * bottom: 받침 윗면 높이, top: 돔 안 물체 꼭대기 높이(앱 좌표 y).
   * 지붕은 꼭대기 조금 아래에서 둥글어지기 시작한다(가장자리 쪽은 낮은 것만 있어서 닿지 않는다).
   */
  constructor(bottom: number, top: number) {
    const yS = top - CAP * 0.4;
    const levels: [number, number, number][] = [
      [bottom, DOME_HALF, DOME_R],
      [yS, DOME_HALF, DOME_R],
    ];
    // 지붕: 4분의 1 타원을 따라 몸통에서 꼭대기로. 모서리 반지름은 반 폭을 넘지 않게
    for (let i = 1; i <= 10; i++) {
      const a = (i / 10) * (Math.PI / 2);
      const half = Math.max(0.05, DOME_HALF * Math.cos(a));
      levels.push([yS + Math.sin(a) * CAP, half, Math.min(DOME_R, half)]);
    }
    const geo = lathe(levels);
    for (const back of [1, 0]) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { bright: { value: 1 }, back: { value: back } },
        transparent: true,
        depthWrite: false,
        side: back ? THREE.BackSide : THREE.FrontSide,
      });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = back ? 'jar_back' : 'jar_front';
      // 투명한 것들 중 뒤쪽 유리는 맨 먼저, 앞쪽 유리는 맨 나중에
      mesh.renderOrder = back ? -10 : 10;
      mesh.raycast = () => {};
      this.group.add(mesh);
    }
  }

  /** 밤에는 유리 반사도 어둡게(물 밝기와 같은 값을 받는다) */
  update(bright: number): void {
    for (const m of this.mats) m.uniforms.bright.value = bright;
  }
}
