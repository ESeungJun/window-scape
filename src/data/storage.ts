/**
 * 저장 키. 예전에는 'sky-isle:' 접두어를 썼다. 켤 때 한 번 새 이름으로 옮긴다.
 */
export const KEYS = {
  place: 'window-scape:place',
  theme: 'window-scape:theme',
  shape: 'window-scape:shape',
  effects: 'window-scape:effects',
} as const;

const OLD: [string, string][] = [
  ['sky-isle:place', KEYS.place],
  ['sky-isle:theme', KEYS.theme],
  ['sky-isle:shape', KEYS.shape],
];

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * 옛 키의 값을 새 키로 옮긴다. 새 키에 이미 값이 있으면 그대로 두고, 새 키에 쓰는 데 성공한 뒤에만 옛 키를 지운다.
 * 저장소를 못 쓰면(비공개 모드·가득 참) 아무것도 바꾸지 않는다.
 */
export function migrateKeys(store: Store): void {
  for (const [from, to] of OLD) {
    try {
      const old = store.getItem(from);
      if (old === null) continue;
      if (store.getItem(to) === null) {
        store.setItem(to, old);
        if (store.getItem(to) !== old) continue;
      }
      store.removeItem(from);
    } catch {
      // 옮기지 못한 값은 옛 키에 그대로 남는다
    }
  }
}
