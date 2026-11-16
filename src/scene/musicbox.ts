import * as THREE from 'three';

/**
 * 미니어처 모양의 오르골 태엽 손잡이. 상자(case_plinth, tools/blender/tile.py 의 case())는 Blender 가 만들고,
 * 옆면에 꽂힌 나비 모양 손잡이만 여기서 그려 천천히 돌린다. Diorama 가 상자를 찾으면 만들어 단면 부품처럼 켜고 끈다.
 */

const GOLD = new THREE.MeshStandardMaterial({ color: '#e0b85c', roughness: 0.4, metalness: 0.55 });
/** 초당 회전(라디안). 오르골이 감긴 태엽을 푸는 느린 속도 */
const SPIN = 0.7;

export class WindKey {
  readonly group = new THREE.Group();
  private readonly turn = new THREE.Group();

  /** box: 상자 경계 상자. 오른쪽(+x) 옆면 몸통 가운데쯤에 꽂는다 */
  constructor(box: THREE.Box3) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.9, 12), GOLD);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = 0.45;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), GOLD);
    hub.position.x = 0.9;
    this.turn.add(hub);
    // 나비 날개 두 장: 납작한 공을 위아래로
    const wingGeo = new THREE.SphereGeometry(0.5, 16, 12);
    for (const s of [1, -1]) {
      const wing = new THREE.Mesh(wingGeo, GOLD);
      wing.scale.set(0.18, 1, 0.75);
      wing.position.set(0.95, s * 0.55, 0);
      this.turn.add(wing);
    }
    this.group.add(shaft, this.turn);
    this.group.position.set(box.max.x, box.min.y + (box.max.y - box.min.y) * 0.5, (box.min.z + box.max.z) / 2);
    this.group.traverse((o) => {
      o.castShadow = true;
      o.raycast = () => {};
    });
  }

  update(dt: number, still: boolean): void {
    if (!still) this.turn.rotation.x += dt * SPIN;
  }
}
