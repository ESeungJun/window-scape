import type { Condition, Season, TimeOfDay } from '../data/weather';
import type { Quality } from '../scene/world';

export interface ViewOptions {
  time: TimeOfDay | 'live';
  cond: Condition | 'live';
  season: Season | 'live';
  quality: Quality;
}

type Group<K extends keyof ViewOptions> = { key: K; title: string; items: [ViewOptions[K], string][] };

const GROUPS: [Group<'time'>, Group<'cond'>, Group<'season'>, Group<'quality'>] = [
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
];

export function renderSettings(root: HTMLElement, opts: ViewOptions, onChange: (next: ViewOptions) => void): void {
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
    for (const [value, label] of group.items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = label;
      b.setAttribute('aria-pressed', String(opts[group.key] === value));
      b.addEventListener('click', () => {
        const next = { ...opts, [group.key]: value };
        renderSettings(root, next, onChange);
        onChange(next);
      });
      list.append(b);
    }
    section.append(h, list);
    root.append(section);
  }
}
