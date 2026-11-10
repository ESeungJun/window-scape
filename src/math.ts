/** DOM·three 없이 쓰는 작은 수학 도구(node 테스트에서도 불러 쓴다) */
export type Rng = () => number;

/** 시드 고정 난수. 섬 배치가 새로고침마다 바뀌지 않게 한다. */
export function mulberry32(seed: number): Rng {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 좌표 기반 해시. 같은 위치의 중복 정점이 같은 값을 받아 면이 갈라지지 않는다. */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
