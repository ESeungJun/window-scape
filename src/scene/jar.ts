import * as THREE from 'three';

/**
 * 미니어처 모양의 유리병(테라리움). Diorama 가 모델을 불러온 뒤 풍경 둘레에 만들고, 미니어처 모양일 때만 보인다.
 * 병 안쪽 흙층(case_*)은 tools/blender/tile.py 의 case() 가 같은 둥근 네모(JAR_HALF·JAR_R)를 따라 만든다.
 *
 * 생김새: 곧은 몸통 → 둥글게 좁아지는 어깨 → 짧은 목 → 두툼한 입구. 마개는 없다(내려다보는 각도라 마개가 뒤쪽 풍경을 가린다).
 * 유리는 빛 계산 없이 가장자리일수록 진해지는 반투명(프레넬)과 세로 반사 줄 두 개로만 그린다.
 * 뒤쪽 면(BackSide)을 먼저, 앞쪽 면을 나중에 그려 두 겹이 겹쳐 보이게 한다. 그림자는 드리우지 않는다.
 */

/** 흙층이 닿는 유리 안쪽 둥근 네모(tools/blender/tile.py 와 같은 값) */
export const JAR_HALF = 8.45;
export const JAR_R = 1.25;
/** 유리 두께만큼 바깥 */
const GLASS = 0.04;
/** 목의 반 폭·모서리 반지름, 어깨·목 높이 */
const NECK_HALF = 3.4;
const NECK_R = 0.9;
const SHOULDER = 2.2;
const NECK = 0.6;
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

/** (높이, 반 폭, 모서리 반지름) 층들을 이어 병 옆면을 만들고, 맨 아래 층은 바닥으로 막는다 */
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
  // 바닥: 가운데 점에서 맨 아래 둘레로 부채꼴
  const center = pos.length / 3;
  pos.push(0, levels[0][0], 0);
  for (let i = 0; i < m; i++) idx.push(center, i, (i + 1) % m);
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
    float fres = pow(f, 3.0);
    // 세로 반사 줄: 화면 기준 법선 x 가 특정 값인 곳(왼쪽 굵은 줄, 오른쪽 가는 줄)
    float streak = smoothstep(0.07, 0.0, abs(n.x + 0.55)) + 0.6 * smoothstep(0.035, 0.0, abs(n.x - 0.42));
    streak *= (1.0 - back) * step(0.0, n.y + 0.6);
    float a = 0.03 + 0.5 * fres + 0.32 * streak;
    a *= mix(1.0, 0.55, back);
    vec3 tint = vec3(0.86, 0.95, 0.94);
    vec3 col = mix(tint, vec3(1.0), clamp(streak + fres * 0.5, 0.0, 1.0)) * bright;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;

export class Jar {
  readonly group = new THREE.Group();
  private readonly mats: THREE.ShaderMaterial[] = [];

  /**
   * bottom: 흙층 바닥 높이, top: 병 안 물체 꼭대기 높이(앱 좌표 y).
   * 어깨는 꼭대기 조금 위에서 시작한다(높은 것이 유리를 뚫고 나오지 않게).
   */
  constructor(bottom: number, top: number) {
    const H = JAR_HALF + GLASS;
    const R = JAR_R + GLASS;
    const yS = top + 0.5;
    const levels: [number, number, number][] = [
      // 두꺼운 유리 바닥: 아래 모서리를 둥글게
      [bottom - 0.32, H - 0.22, R - 0.22],
      [bottom - 0.24, H - 0.06, R - 0.06],
      [bottom - 0.12, H, R],
      [yS, H, R],
    ];
    // 어깨: 4분의 1 원을 따라 몸통에서 목으로
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      levels.push([yS + Math.sin(a) * SHOULDER, NECK_HALF + (H - NECK_HALF) * Math.cos(a), NECK_R + (R - NECK_R) * Math.cos(a)]);
    }
    const yN = yS + SHOULDER + NECK;
    levels.push([yN, NECK_HALF, NECK_R]);
    // 입구: 바깥으로 두툼한 테
    levels.push([yN + 0.05, NECK_HALF + 0.2, NECK_R + 0.2], [yN + 0.3, NECK_HALF + 0.2, NECK_R + 0.2], [yN + 0.36, NECK_HALF - 0.02, NECK_R - 0.02]);
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
