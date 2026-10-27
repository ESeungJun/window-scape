import { CONDITION_LABEL, conditionFromCode, type Forecast } from '../data/weather';
import { weatherIcon } from './icons';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WIND_DIRS = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const round = (n: number) => Math.round(n);
const dateOf = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);
const weekday = (iso: string) => WEEKDAYS[dateOf(iso).getUTCDay()];
const longDate = (iso: string) => {
  const d = dateOf(iso);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 ${WEEKDAYS[d.getUTCDay()]}요일`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function card(label: string, value: string, sub?: string): HTMLElement {
  const c = el('div', 'card');
  c.append(el('span', 'card__label', label), el('strong', 'card__value', value));
  if (sub) c.append(el('span', 'card__sub', sub));
  return c;
}

export interface NowElements {
  badge: HTMLElement;
  place: HTMLElement;
  temp: HTMLElement;
  cond: HTMLElement;
  range: HTMLElement;
  cards: HTMLElement;
}

/** 배지 문구. 미리보기·연결 끊김 상태는 호출하는 쪽이 넘긴 값을 우선한다. */
export function badgeText(f: Forecast, dayIndex: number): string {
  return dayIndex === 0 ? '지금 날씨' : longDate(f.daily[dayIndex].date);
}

export function renderNow(e: NowElements, f: Forecast, dayIndex: number, placeName: string, badge: string): void {
  const day = f.daily[dayIndex];
  e.place.textContent = placeName;
  e.badge.textContent = badge;
  e.range.textContent = `최고 ${round(day.max)}° · 최저 ${round(day.min)}°`;
  if (dayIndex === 0) {
    const c = f.current;
    e.temp.textContent = String(round(c.temp));
    e.cond.textContent = CONDITION_LABEL[conditionFromCode(c.code, c.wind)];
    e.cards.replaceChildren(
      card('바람', `${round(c.wind)} km/h`, `${WIND_DIRS[Math.round(c.windDir / 45) % 8]}풍`),
      card('강수', `${c.precipitation} mm`, '지난 1시간'),
      card('습도', `${c.humidity}%`),
    );
  } else {
    e.temp.textContent = String(round(day.max));
    e.cond.textContent = CONDITION_LABEL[conditionFromCode(day.code)];
    e.cards.replaceChildren(card('강수', `${day.precipitation} mm`, '하루 합계'));
  }
}

const renderedWeek = new WeakMap<HTMLElement, Forecast>();

/** 같은 예보면 버튼을 다시 만들지 않고 눌림 상태만 바꾼다(키보드 포커스 유지). */
export function renderWeek(root: HTMLElement, f: Forecast, selected: number, onSelect: (i: number) => void): void {
  if (renderedWeek.get(root) !== f) {
    renderedWeek.set(root, f);
    buildWeek(root, f, onSelect);
  }
  root.querySelectorAll('.day').forEach((b, i) => b.setAttribute('aria-pressed', String(i === selected)));
}

function buildWeek(root: HTMLElement, f: Forecast, onSelect: (i: number) => void): void {
  root.replaceChildren(
    ...f.daily.map((d, i) => {
      const li = el('li');
      const b = el('button', 'day');
      b.type = 'button';
      b.setAttribute('aria-label', `${i === 0 ? '오늘' : longDate(d.date)} ${CONDITION_LABEL[conditionFromCode(d.code)]}, 최고 ${round(d.max)}도 최저 ${round(d.min)}도`);
      const icon = el('span', 'day__icon');
      icon.innerHTML = weatherIcon(conditionFromCode(d.code));
      const temps = el('span', 'day__temps');
      temps.append(el('b', undefined, `${round(d.max)}°`), el('span', undefined, `${round(d.min)}°`));
      b.append(el('span', 'day__name', i === 0 ? '오늘' : weekday(d.date)), icon, temps);
      b.addEventListener('click', () => onSelect(i));
      li.append(b);
      return li;
    }),
  );
}

export function renderHourly(title: HTMLElement, chart: SVGSVGElement, list: HTMLElement, f: Forecast, dayIndex: number): void {
  const date = f.daily[dayIndex].date;
  const hours = f.hourly.filter((h) => h.time.startsWith(date));
  title.textContent = dayIndex === 0 ? `오늘 · ${longDate(date)}` : longDate(date);

  // 기온 그래프
  chart.replaceChildren();
  if (hours.length > 1) {
    const temps = hours.map((h) => h.temp);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const x = (i: number) => 14 + (i * 272) / (hours.length - 1);
    const y = (t: number) => 26 + (1 - (t - min) / (max - min || 1)) * 58;
    const line = temps.map((t, i) => `${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ');
    const svg = (tag: string, attrs: Record<string, string>, text?: string) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text !== undefined) n.textContent = text;
      chart.append(n);
    };
    svg('polygon', { points: `${x(0)},100 ${line} ${x(hours.length - 1)},100`, class: 'chart__area' });
    svg('polyline', { points: line, class: 'chart__line' });
    hours.forEach((h, i) => {
      if (i % 6 !== 0) return;
      svg('circle', { cx: String(x(i)), cy: String(y(h.temp)), r: '2.5', class: 'chart__dot' });
      svg('text', { x: String(x(i)), y: String(y(h.temp) - 8), class: 'chart__temp' }, `${round(h.temp)}°`);
      svg('text', { x: String(x(i)), y: '116', class: 'chart__hour' }, `${Number(h.time.slice(11, 13))}시`);
    });
  }

  // 3시간 간격 목록
  list.replaceChildren(
    ...hours
      .filter((_, i) => i % 3 === 0)
      .map((h) => {
        const hour = Number(h.time.slice(11, 13));
        const li = el('li', 'hour');
        const icon = el('span', 'hour__icon');
        const cond = conditionFromCode(h.code);
        icon.innerHTML = weatherIcon(cond, hour < 6 || hour >= 19);
        li.append(
          el('span', 'hour__time', `${hour}시`),
          icon,
          el('span', 'hour__cond', CONDITION_LABEL[cond]),
          el('span', 'hour__pop', `${h.pop}%`),
          el('b', 'hour__temp', `${round(h.temp)}°`),
        );
        return li;
      }),
  );
}
