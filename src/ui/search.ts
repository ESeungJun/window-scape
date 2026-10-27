import { searchPlaces, type Place } from '../data/weather';

const DEBOUNCE_MS = 300;

/** 도시 이름 검색. 결과는 textContent 로만 그려 입력값이 HTML 로 해석되지 않는다. */
export function setupSearch(input: HTMLInputElement, list: HTMLUListElement, onPick: (p: Place) => void): void {
  let timer = 0;
  let controller: AbortController | undefined;
  let results: Place[] = [];
  let resultsFor = ''; // results 를 만든 검색어

  // 대기 중인 디바운스와 진행 중인 요청을 함께 끊어, 늦게 온 응답이 닫힌 목록을 다시 열지 않게 한다
  const cancel = () => {
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
  };

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
  };

  const pick = (p: Place) => {
    cancel();
    results = [];
    resultsFor = '';
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
    cancel();
    const q = input.value.trim();
    if (q.length < 2) {
      results = [];
      resultsFor = '';
      close();
      return;
    }
    timer = window.setTimeout(async () => {
      const ctrl = new AbortController();
      controller = ctrl;
      try {
        const found = await searchPlaces(q, ctrl.signal);
        if (ctrl.signal.aborted) return;
        results = found;
        resultsFor = q;
        render(results.length ? undefined : '검색 결과가 없어요');
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        results = [];
        resultsFor = '';
        render('검색하지 못했어요. 잠시 후 다시 시도해 주세요');
      }
    }, DEBOUNCE_MS);
  });

  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // 한글 조합 중 Enter
    // 지금 입력과 같은 검색어로 받은 결과일 때만 Enter 로 고른다
    if (e.key === 'Enter' && results[0] && resultsFor === input.value.trim()) pick(results[0]);
    if (e.key === 'Escape') {
      cancel();
      close();
    }
  });
  input.addEventListener('blur', () => {
    cancel();
    close();
  });
}
