import * as THREE from 'three';

import { hash3 } from './math.ts';

export { hash3, lerp, mulberry32, smoothstep, type Rng } from './math.ts';

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
