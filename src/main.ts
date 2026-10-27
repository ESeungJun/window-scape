import './style.css';
import {
  conditionFromCode, fetchForecast, localMinutes, localMonth, seasonAt, timeOfDayAt,
  type Forecast, type Place, type TimeOfDay,
} from './data/weather';
import { World } from './scene/world';
import { renderHourly, renderNow, renderWeek } from './ui/forecast';
import { setupSearch } from './ui/search';
import { renderSettings, type ViewOptions } from './ui/settings';
import { Ambience } from './ui/sound';

const SEOUL: Place = { name: '서울', lat: 37.5665, lon: 126.978 };
const PLACE_KEY = 'sky-isle:place';
const REFRESH_MS = 15 * 60 * 1000;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const world = new World($('scene'));
const ambience = new Ambience();

const state = {
  place: loadSavedPlace() ?? SEOUL,
  forecast: undefined as Forecast | undefined,
  dayIndex: 0,
  view: { time: 'live', cond: 'live', season: 'live', quality: 'auto' } as ViewOptions,
};

const now = {
  badge: $('badge'), place: $('place'), temp: $('temp'), cond: $('cond'), range: $('range'), cards: $('cards'),
};
const settingsPanel = $('settings');
const hourlyPanel = $('hourly');
const toastEl = $('toast');
let loadController: AbortController | undefined;
let toastTimer = 0;

function loadSavedPlace(): Place | undefined {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null');
    if (p && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon)) return p;
  } catch {
    // 저장소를 못 쓰는 환경이면 기본 도시로 시작한다
  }
  return undefined;
}

function savePlace(p: Place) {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(p));
  } catch {
    // 무시: 다음 방문 때 기본 도시로 시작할 뿐이다
  }
}

function toast(message: string) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 4500);
}

function liveTime(f?: Forecast): TimeOfDay {
  if (!f) return timeOfDayAt(new Date().getHours() * 60 + new Date().getMinutes());
  const today = f.daily[0];
  return timeOfDayAt(localMinutes(f.utcOffsetSeconds), today?.sunrise, today?.sunset);
}

/** 실시간 값과 사용자가 고른 미리보기 값을 합쳐 장면에 반영한다. */
function applyScene() {
  const f = state.forecast;
  const v = state.view;
  const time = v.time === 'live' ? liveTime(f) : v.time;
  const liveCond = !f
    ? 'partly'
    : state.dayIndex === 0
      ? conditionFromCode(f.current.code, f.current.wind)
      : conditionFromCode(f.daily[state.dayIndex].code);
  const liveSeason = f ? seasonAt(localMonth(f.utcOffsetSeconds), state.place.lat) : seasonAt(new Date().getMonth(), state.place.lat);
  world.setSelection(time, v.cond === 'live' ? liveCond : v.cond, v.season === 'live' ? liveSeason : v.season);
  document.body.classList.toggle('is-dark', time === 'night' || time === 'evening');
  renderInfo();
}

function isPreview() {
  const v = state.view;
  return v.time !== 'live' || v.cond !== 'live' || v.season !== 'live';
}

function renderInfo() {
  const f = state.forecast;
  if (!f) return;
  renderNow(now, f, state.dayIndex, state.place.name, isPreview());
  renderWeek($('week'), f, state.dayIndex, selectDay);
  if (!hourlyPanel.hidden) renderHourly($('hourlyTitle'), $('chart') as unknown as SVGSVGElement, $('hourlyList'), f, state.dayIndex);
}

function selectDay(i: number) {
  const reopen = hourlyPanel.hidden !== false || state.dayIndex !== i;
  state.dayIndex = i;
  setPanel(hourlyPanel, reopen);
  if (!reopen) state.dayIndex = 0;
  applyScene();
}

function setPanel(panel: HTMLElement, open: boolean) {
  panel.hidden = !open;
  if (open) {
    const other = panel === settingsPanel ? hourlyPanel : settingsPanel;
    other.hidden = true;
  }
  $('settingsBtn').setAttribute('aria-expanded', String(!settingsPanel.hidden));
}

async function loadPlace(place: Place) {
  loadController?.abort();
  loadController = new AbortController();
  state.place = place;
  now.place.textContent = place.name;
  now.badge.textContent = '불러오는 중…';
  try {
    state.forecast = await fetchForecast(place, loadController.signal);
    state.dayIndex = 0;
    savePlace(place);
    applyScene();
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    now.badge.textContent = '연결 안 됨';
    toast('날씨 정보를 불러오지 못했어요. 보기 설정에서 장면은 미리 볼 수 있어요.');
    applyScene();
  }
}

// ── 이벤트 연결 ───────────────────────────────────────

renderSettings($('settingsBody'), state.view, (next) => {
  if (next.quality !== state.view.quality) world.setQuality(next.quality);
  state.view = next;
  applyScene();
});

$('settingsBtn').addEventListener('click', () => setPanel(settingsPanel, settingsPanel.hidden !== false));
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    setPanel($(b.dataset.close!), false);
    if (b.dataset.close === 'hourly' && state.dayIndex !== 0) {
      state.dayIndex = 0;
      applyScene();
    }
  }),
);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  setPanel(settingsPanel, false);
  hourlyPanel.hidden = true;
});

setupSearch($('search') as HTMLInputElement, $('results') as HTMLUListElement, loadPlace);

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않아요.');
  navigator.geolocation.getCurrentPosition(
    (pos) => loadPlace({ name: '현재 위치', lat: pos.coords.latitude, lon: pos.coords.longitude }),
    () => toast('위치 권한이 없어서 현재 위치를 가져오지 못했어요.'),
    { timeout: 10000, maximumAge: 10 * 60 * 1000 },
  );
});

const soundBtn = $('sound');
soundBtn.addEventListener('click', async () => {
  const on = await ambience.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('span')!.textContent = on ? '소리 끄기' : '소리 켜기';
});
world.onFrame = (env) => ambience.update(env);

loadPlace(state.place);
setInterval(applyScene, 60 * 1000); // 실시간 시간대 갱신
setInterval(() => loadPlace(state.place), REFRESH_MS);
