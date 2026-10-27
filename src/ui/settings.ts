import type { Condition, Season, TimeOfDay } from '../data/weather';
import type { Quality } from '../scene/world';

export type Frame = 'full' | 'showcase';

export interface ViewOptions {
  time: TimeOfDay | 'live';
  cond: Condition | 'live';
  season: Season | 'live';
  quality: Quality;
  frame: Frame;
}

type Group<K extends keyof ViewOptions> = { key: K; title: string; items: [ViewOptions[K], string][] };
type AnyGroup = { [K in keyof ViewOptions]: Group<K> }[keyof ViewOptions];

const GROUPS: AnyGroup[] = [
  { key: 'time', title: '시간대', items: [['live', '실시간'], ['morning', '아침'], ['day', '낮'], ['evening', '저녁'], ['night', '밤']] },
  {
    key: 'cond',
    title: '날씨',
    items: [
      ['live', '실시간'], ['clear', '맑음'], ['partly', '구름 조금'], ['cloudy', '흐림'], ['wind', '바람'], ['fog', '안개'],
      ['rain', '비'], ['heavyRain', '강한 비'], ['storm', '뇌우'], ['snow', '눈'], ['rainbow', '무지개'],
    ],
  },
  { key: 'season', title: '계절', items: [['live', '실시간'], ['spring', '봄'], ['summer', '여름'], ['autumn', '가을'], ['winter', '겨울']] },
  { key: 'quality', title: '화질', items: [['auto', '자동'], ['low', '낮음'], ['medium', '중간'], ['high', '높음']] },
  { key: 'frame', title: '화면', items: [['full', '꽉 차게'], ['showcase', '쇼케이스']] },
];

/**
 * 칩 버튼은 한 번만 만든다. 다시 그리지 않고 aria-pressed 만 바꿔 키보드 포커스가 유지된다.
 * 반환한 함수로 바깥에서 바뀐 값(단축키 등)을 칩에 반영한다.
 */
export function renderSettings(root: HTMLElement, initial: ViewOptions, onChange: (next: ViewOptions) => void): (opts: ViewOptions) => void {
  let opts = initial;
  const chips: { key: keyof ViewOptions; value: string; el: HTMLButtonElement }[] = [];
  const sync = (next: ViewOptions) => {
    opts = next;
    for (const c of chips) c.el.setAttribute('aria-pressed', String(opts[c.key] === c.value));
  };

  root.replaceChildren();
  for (const group of GROUPS) {
    const section = document.createElement('section');
    section.className = 'chips';
    const h = document.createElement('h3');
    h.textContent = group.title;
    const list = document.createElement('div');
    list.className = 'chips__list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', group.title);
    for (const [value, label] of group.items as [string, string][]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.addEventListener('click', () => {
        const next = { ...opts, [group.key]: value } as ViewOptions;
        sync(next);
        onChange(next);
      });
      chips.push({ key: group.key, value, el: b });
      list.append(b);
    }
    section.append(h, list);
    root.append(section);
  }
  sync(opts);
  return sync;
}
