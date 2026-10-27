import './style.css';
import {
  coarse, conditionFromCode, fetchForecast, localEpochMinutes, localMonth, seasonAt, timeOfDayAt,
  type Condition, type Forecast, type Place, type TimeOfDay,
} from './data/weather';
import { World } from './scene/world';
import { badgeText, renderHourly, renderNow, renderWeek } from './ui/forecast';
import { setupSearch } from './ui/search';
import { renderSettings, type Frame, type ViewOptions } from './ui/settings';
import { Ambience } from './ui/sound';
import { isDesktopApp, setupWidget } from './widget';

const SEOUL: Place = { name: '서울', lat: 37.5665, lon: 126.978 };
const PLACE_KEY = 'sky-isle:place';
const REFRESH_MS = 15 * 60 * 1000;
const GEO_ERRORS: Record<number, string> = {
  1: '위치 권한이 없어서 현재 위치를 가져오지 못했어요.',
  2: '지금은 기기 위치를 확인할 수 없어요.',
  3: '위치를 확인하는 데 시간이 너무 오래 걸려요. 다시 시도해 주세요.',
};

const $ = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;

const world = new World($('scene'));
const ambience = new Ambience();
if (isDesktopApp) {
  setupWidget(document.querySelector<HTMLElement>('.app')!);
  world.setFrameCap(30);
}

const state = {
  /** 지금 화면에 보이는 예보의 장소. 불러오기에 성공했을 때만 바뀐다. */
  place: loadSavedPlace() ?? SEOUL,
  forecast: undefined as Forecast | undefined,
  offline: false,
  dayIndex: 0,
  view: {
    time: 'live',
    cond: 'live',
    season: 'live',
    quality: 'auto',
    frame: new URLSearchParams(location.search).has('showcase') ? 'showcase' : 'full',
  } as ViewOptions,
};

const now = {
  badge: $('badge'), place: $('place'), temp: $('temp'), cond: $('cond'), range: $('range'), cards: $('cards'),
};
const settingsPanel = $('settings');
const hourlyPanel = $('hourly');
const toastEl = $('toast');
let loadController: AbortController | undefined;
let toastTimer = 0;
/** 사용자가 장소를 고를 때마다 증가. 늦게 도착한 현재 위치 응답이 그 뒤의 선택을 덮어쓰지 않게 한다. */
let choiceSeq = 0;

// ── 저장 ──────────────────────────────────────────────

function loadSavedPlace(): Place | undefined {
  try {
    const raw = localStorage.getItem(PLACE_KEY);
    if (!raw) return undefined;
    const p = JSON.parse(raw);
    const valid =
      p && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 100 &&
      Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
    if (valid) return { name: p.name, detail: typeof p.detail === 'string' ? p.detail : undefined, lat: p.lat, lon: p.lon };
    localStorage.removeItem(PLACE_KEY);
  } catch {
    // 저장소를 못 쓰거나 값이 깨졌으면 기본 도시로 시작한다
  }
  return undefined;
}

function savePlace(p: Place) {
  if (p.current) return; // 기기 위치는 남기지 않는다
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify({ name: p.name, detail: p.detail, lat: p.lat, lon: p.lon }));
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

// ── 장면과 화면 갱신 ───────────────────────────────────

function liveTime(f?: Forecast): TimeOfDay {
  if (!f) return timeOfDayAt(localEpochMinutes(-new Date().getTimezoneOffset() * 60));
  const today = f.daily[0];
  return timeOfDayAt(localEpochMinutes(f.utcOffsetSeconds), today?.sunrise, today?.sunset);
}

function liveCondition(f: Forecast | undefined, time: TimeOfDay): Condition {
  if (!f) return 'partly';
  if (state.dayIndex !== 0) return conditionFromCode(f.daily[state.dayIndex].code);
  const c = f.current;
  // 방금 비가 내렸는데 지금은 개었으면 무지개를 띄운다
  if (c.code <= 2 && c.precipitation > 0 && time !== 'night') return 'rainbow';
  return conditionFromCode(c.code, c.wind);
}

/** 실시간 값과 미리보기로 고른 값을 합쳐 장면에 반영한다. DOM 은 건드리지 않는다. */
function updateScene() {
  const f = state.forecast;
  const v = state.view;
  const time = v.time === 'live' ? liveTime(f) : v.time;
  const cond = v.cond === 'live' ? liveCondition(f, time) : v.cond;
  const lat = state.place.lat;
  const season = v.season !== 'live' ? v.season : seasonAt(f ? localMonth(f.utcOffsetSeconds) : new Date().getMonth(), lat);
  const minTemp = v.season === 'live' && f ? f.daily[state.dayIndex]?.min : undefined;
  world.setSelection(time, cond, season, minTemp);
  document.body.classList.toggle('is-dark', time === 'night' || time === 'evening');
}

function isPreview() {
  const v = state.view;
  return v.time !== 'live' || v.cond !== 'live' || v.season !== 'live';
}

function renderInfo() {
  const f = state.forecast;
  if (!f) {
    now.place.textContent = state.place.name;
    now.badge.textContent = state.offline ? '연결 안 됨' : '불러오는 중…';
    return;
  }
  const badge = isPreview() ? '미리보기' : state.offline ? '연결 안 됨 · 이전 정보' : badgeText(f, state.dayIndex);
  renderNow(now, f, state.dayIndex, state.place.name, badge);
  renderWeek($('week'), f, state.dayIndex, selectDay);
  if (!hourlyPanel.hidden) renderHourly($('hourlyTitle'), $<SVGSVGElement>('chart'), $('hourlyList'), f, state.dayIndex);
}

function refresh() {
  updateScene();
  renderInfo();
}

// ── 패널 ──────────────────────────────────────────────

/** 시간별 패널을 닫는 모든 경로(닫기 버튼·Esc·설정 열기·같은 요일 다시 누름)가 여기를 지난다. */
function closeHourly() {
  hourlyPanel.hidden = true;
  state.dayIndex = 0;
}

function openPanel(panel: HTMLElement) {
  panel.hidden = false;
  if (panel === hourlyPanel) settingsPanel.hidden = true;
  else closeHourly();
  syncSettingsButton();
}

function syncSettingsButton() {
  $('settingsBtn').setAttribute('aria-expanded', String(!settingsPanel.hidden));
}

function selectDay(i: number) {
  if (!hourlyPanel.hidden && state.dayIndex === i) {
    closeHourly();
  } else {
    state.dayIndex = i;
    openPanel(hourlyPanel);
  }
  refresh();
}

// ── 장소 불러오기 ──────────────────────────────────────

/**
 * 예보를 불러온다. 실패하면 장소를 바꾸지 않고 이전 예보를 그대로 두어,
 * 새 도시 이름 밑에 이전 도시 날씨가 보이는 일이 없게 한다.
 */
async function loadPlace(place: Place, isRefresh = false) {
  if (isRefresh && loadController) return; // 사용자가 고른 장소를 불러오는 중이면 정기 갱신은 건너뛴다
  loadController?.abort();
  const ctrl = new AbortController();
  loadController = ctrl;
  if (!isRefresh) now.badge.textContent = '불러오는 중…';

  let forecast: Forecast;
  try {
    forecast = await fetchForecast(place, ctrl.signal);
  } catch (e) {
    if (loadController === ctrl) loadController = undefined;
    if ((e as Error).name === 'AbortError') return;
    state.offline = true;
    toast(
      isRefresh
        ? '날씨를 새로 고치지 못했어요. 이전 정보를 보여줘요.'
        : `${place.name} 날씨를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.`,
    );
    renderInfo();
    return;
  }
  loadController = undefined;

  // 같은 장소를 새로 고칠 때는 보고 있던 날짜를 유지한다
  const keepDate = isRefresh ? state.forecast?.daily[state.dayIndex]?.date : undefined;
  const kept = keepDate ? forecast.daily.findIndex((d) => d.date === keepDate) : -1;
  if (kept < 0) closeHourly();
  state.place = place;
  state.forecast = forecast;
  state.offline = false;
  state.dayIndex = Math.max(0, kept);
  savePlace(place);
  refresh();
}

function choosePlace(place: Place) {
  choiceSeq++;
  loadPlace(place);
}

// ── 쇼케이스 화면 ──────────────────────────────────────

let syncSettings: (opts: ViewOptions) => void = () => {};

function applyFrame(frame: Frame) {
  document.body.classList.toggle('showcase', frame === 'showcase');
}

// ── 이벤트 연결 ───────────────────────────────────────

syncSettings = renderSettings($('settingsBody'), state.view, (next) => {
  if (next.quality !== state.view.quality) world.setQuality(next.quality);
  if (next.frame !== state.view.frame) applyFrame(next.frame);
  state.view = next;
  refresh();
});
applyFrame(state.view.frame);

$('settingsBtn').addEventListener('click', () => {
  if (settingsPanel.hidden) openPanel(settingsPanel);
  else settingsPanel.hidden = true;
  syncSettingsButton();
  refresh();
});

document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.close === 'hourly') closeHourly();
    else settingsPanel.hidden = true;
    syncSettingsButton();
    refresh();
  }),
);

document.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  if (e.key === 'Escape') {
    settingsPanel.hidden = true;
    closeHourly();
    syncSettingsButton();
    refresh();
  } else if (!isDesktopApp && !typing && !e.metaKey && !e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
    state.view = { ...state.view, frame: state.view.frame === 'showcase' ? 'full' : 'showcase' };
    applyFrame(state.view.frame);
    syncSettings(state.view);
  }
});

setupSearch($<HTMLInputElement>('search'), $<HTMLUListElement>('results'), choosePlace);

$('locate').addEventListener('click', () => {
  if (!navigator.geolocation) return toast('이 브라우저는 위치 정보를 지원하지 않아요.');
  const seq = ++choiceSeq;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (seq !== choiceSeq) return; // 기다리는 사이 다른 도시를 골랐다
      loadPlace({ name: '현재 위치', lat: coarse(pos.coords.latitude), lon: coarse(pos.coords.longitude), current: true });
    },
    (err) => {
      if (seq === choiceSeq) toast(GEO_ERRORS[err.code] ?? '현재 위치를 가져오지 못했어요.');
    },
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

renderInfo();
loadPlace(state.place);
setInterval(updateScene, 60 * 1000); // 실시간 시간대 갱신(화면 글자는 그대로 둬 포커스·낭독이 흔들리지 않게)
setInterval(() => loadPlace(state.place, true), REFRESH_MS);
