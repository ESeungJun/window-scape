import { searchPlaces, type Place } from '../data/weather';

const DEBOUNCE_MS = 300;

/** 도시 이름 검색. 결과는 textContent 로만 그려 입력값이 HTML 로 해석되지 않는다. */
export function setupSearch(input: HTMLInputElement, list: HTMLUListElement, onPick: (p: Place) => void): void {
  let timer = 0;
  let controller: AbortController | undefined;
  let results: Place[] = [];

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  const pick = (p: Place) => {
    input.value = '';
    close();
    input.blur();
    onPick(p);
  };

  const render = (message?: string) => {
    list.replaceChildren();
    if (message) {
      const li = document.createElement('li');
      li.className = 'search__empty';
      li.textContent = message;
      list.append(li);
    }
    for (const p of results) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const name = document.createElement('b');
      name.textContent = p.name;
      const detail = document.createElement('span');
      detail.textContent = p.detail ?? '';
      b.append(name, detail);
      b.addEventListener('mousedown', (e) => e.preventDefault()); // blur 로 목록이 먼저 닫히지 않게
      b.addEventListener('click', () => pick(p));
      li.append(b);
      list.append(li);
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      close();
      return;
    }
    timer = window.setTimeout(async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        results = await searchPlaces(q, controller.signal);
        render(results.length ? undefined : '검색 결과가 없어요');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        results = [];
        render('검색하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && results[0]) pick(results[0]);
    if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', close);
}
