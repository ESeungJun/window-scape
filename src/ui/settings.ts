import type { Condition, Season, TimeOfDay } from '../data/weather';
import type { Effects, Quality, Shape } from '../scene/world';
import { THEMES, type Theme } from '../scene/themes';

export type Frame = 'full' | 'showcase';
export type { Shape };

export interface ViewOptions {
  theme: Theme;
  shape: Shape;
  time: TimeOfDay | 'live';
  cond: Condition | 'live';
  season: Season | 'live';
  quality: Quality;
  frame: Frame;
}

type Group<K extends keyof ViewOptions> = { key: K; title: string; items: [ViewOptions[K], string][] };
type AnyGroup = { [K in keyof ViewOptions]: Group<K> }[keyof ViewOptions];

const GROUPS: AnyGroup[] = [
  { key: 'theme', title: '테마', items: THEMES },
  { key: 'shape', title: '모양', items: [['land', '지평선까지'], ['mini', '미니어처']] },
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
  let shapeSection: HTMLElement | undefined;
  const sync = (next: ViewOptions) => {
    opts = next;
    for (const c of chips) c.el.setAttribute('aria-pressed', String(opts[c.key] === c.value));
    // 하늘섬은 처음부터 떠 있는 섬이라 모양을 고를 게 없다
    if (shapeSection) shapeSection.hidden = opts.theme === 'island';
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
    if (group.key === 'shape') shapeSection = section;
    root.append(section);
  }
  sync(opts);
  return sync;
}

const EFFECTS: [keyof Effects, string, string][] = [
  ['glass', '창 유리', '비가 오면 유리에 방울이 맺히고, 춥고 습하면 김과 성에가 껴요. 끌어서 닦을 수 있어요.'],
  ['wind', '바람', '나무 잎이 바람 세기만큼 흔들려요.'],
  ['shade', '구름 그늘', '구름 그림자가 땅 위를 흘러가요.'],
  ['parallax', '시차', '마우스나 창 위치에 따라 풍경이 조금 미끄러져요.'],
  ['still', '시선 고정', '풍경이 계속 돌지 않고 창밖을 보듯 멈춰 있어요.'],
  ['lowPower', '절전', '가만히 있을 때 덜 자주, 덜 선명하게 그려 배터리를 아껴요.'],
];

/** 연출 켜고 끄기. 칩마다 따로 켜고 끈다(여러 개를 같이 켤 수 있다). 반환한 함수로 바깥에서 바뀐 값을 반영한다 */
export function renderEffects(root: HTMLElement, initial: Effects, onChange: (next: Effects) => void): (e: Effects) => void {
  let cur = initial;
  const section = document.createElement('section');
  section.className = 'chips';
  const h = document.createElement('h3');
  h.textContent = '연출';
  const list = document.createElement('div');
  list.className = 'chips__list';
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', '연출');
  const chips: [keyof Effects, HTMLButtonElement][] = [];
  const sync = (next: Effects) => {
    cur = next;
    for (const [key, b] of chips) b.setAttribute('aria-pressed', String(cur[key]));
  };
  for (const [key, label, hint] of EFFECTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.title = hint;
    b.addEventListener('click', () => {
      const next = { ...cur, [key]: !cur[key] };
      sync(next);
      onChange(next);
    });
    chips.push([key, b]);
    list.append(b);
  }
  section.append(h, list);
  root.replaceChildren(section);
  sync(cur);
  return sync;
}
