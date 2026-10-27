import * as THREE from 'three';

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

/** 정점을 해시로 흔들어 로우폴리 특유의 울퉁불퉁함을 만든다. */
export function jitter(geo: THREE.BufferGeometry, amount: number, seed = 0): THREE.BufferGeometry {
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(
      i,
      x + (hash3(x + seed, y, z) - 0.5) * amount,
      y + (hash3(y, z + seed, x) - 0.5) * amount,
      z + (hash3(z, x, y + seed) - 0.5) * amount,
    );
  }
  geo.computeVertexNormals();
  return geo;
}

let sprite: THREE.CanvasTexture | undefined;

/** 안개·눈 입자용 부드러운 원형 텍스처 */
export function softSprite(): THREE.CanvasTexture {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.6)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  sprite = new THREE.CanvasTexture(c);
  sprite.colorSpace = THREE.SRGBColorSpace;
  return sprite;
}
