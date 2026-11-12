import './style.css';
import {
  coarse, conditionFromCode, fetchForecast, localEpochMinutes, localIso, localMinutesOf, localMonth, nextPrecip, seasonAt, skyPhaseAt,
  timeOfDayAt, type Condition, type Forecast, type HourlyForecast, type Place, type TimeOfDay,
} from './data/weather';
import { FORECAST_KEY, ageLabel, isForecast, parseCachedForecast } from './data/cache';
import { retryDelay } from './data/retry';
import { KEYS, migrateKeys } from './data/storage';
import type { LiveWeather } from './scene/env';
import { isTheme, type Theme } from './scene/themes';
import { DEFAULT_EFFECTS, World, type Effects } from './scene/world';
import { badgeText, renderHourly, renderNow, renderWeek, setupScrub } from './ui/forecast';
import { setupSearch } from './ui/search';
import { renderEffects, renderSettings, type Frame, type Shape, type ViewOptions } from './ui/settings';
import { Ambience } from './ui/sound';
import { setupDesktopSettings } from './ui/desktop-settings';
import { isDesktopApp, nativeLocation, setupWidget, watchWindow } from './widget';
import { MODEL_ERROR } from './scene/props';

const SEOUL: Place = { name: '서울', lat: 37.5665, lon: 126.978 };
const REFRESH_MS = 15 * 60 * 1000;
/** 웹 판의 프레임 상한(120Hz 화면에서 초당 120번 그리지 않게) */
const WEB_FPS = 60;
const WIDGET_FPS = 30;

// 예전 저장 키('sky-isle:')를 새 이름으로 옮긴다
try {
  migrateKeys(localStorage);
} catch {
  // 저장소를 못 쓰면 기본값으로 시작한다
}
const GEO_ERRORS: Record<number, string> = {
  1: '위치 권한이 없어서 현재 위치를 가져오지 못했어요.',
  2: '지금은 기기 위치를 확인할 수 없어요.',
  3: '위치를 확인하는 데 시간이 너무 오래 걸려요. 다시 시도해 주세요.',
};

const $ = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`#${id}`)!;

// 저장된 테마로 바로 시작한다(하늘섬을 먼저 만들었다 바꾸지 않게)
// 하루 종일 떠 있는 위젯은 내장 GPU 를 쓰게 한다
const world = new World($('scene'), { theme: loadSavedTheme(), powerPreference: isDesktopApp ? 'low-power' : 'high-performance' });
const ambience = new Ambience();
world.setFrameCap(isDesktopApp ? WIDGET_FPS : WEB_FPS);
if (isDesktopApp) {
  setupWidget(document.querySelector<HTMLElement>('.app')!);
  watchWindow((occluded) => world.setOccluded(occluded), (x, y) => world.setWindowBias(x, y));
}
let effects = loadSavedEffects();
world.setEffects(effects);

const state = {
  /** 지금 화면에 보이는 예보의 장소. 불러오기에 성공했을 때만 바뀐다. */
  place: loadSavedPlace() ?? SEOUL,
  forecast: undefined as Forecast | undefined,
  /** 지금 예보를 받은 시각(ms). 연결이 끊겼을 때 얼마나 오래된 정보인지 알려 준다 */
  fetchedAt: 0,
  offline: false,
  /** 시간 그래프를 끄는 동안 보고 있는 시각(손을 떼면 undefined) */
  scrub: undefined as HourlyForecast | undefined,
  /** 지금 장면이 밤인지(지금 날씨 아이콘을 달로 그린다) */
  night: false,
  dayIndex: 0,
  view: {
    theme: loadSavedTheme(),
    shape: loadSavedShape(),
    time: 'live',
    cond: 'live',
    season: 'live',
    quality: 'auto',
    frame: new URLSearchParams(location.search).has('showcase') ? 'showcase' : 'full',
  } as ViewOptions,
};
// 개발 서버에서만: 화면 비교용으로 시간·날씨·계절·화질을 바꾼다(예: __view({ time: 'night', cond: 'rain' }))
if (import.meta.env.DEV) {
  Object.assign(window, {
    __view: (o: Partial<ViewOptions>) => {
      Object.assign(state.view, o);
      if (o.quality) world.setQuality(o.quality);
      if (o.shape) world.setShape(o.shape);
      refresh();
    },
    // 들어가기 모드 점검용
    __world: world,
    // 성능 점검용: 그리기 호출·삼각형·지오메트리·텍스처 수
    __info: () => {
      const r = world['renderer'].info;
      return { ...r.render, ...r.memory, programs: r.programs?.length };
    },
    // 연출 점검용: __fx({ glass: true })
    __fx: (o: Partial<Effects>) => {
      effects = { ...effects, ...o };
      world.setEffects(effects);
      syncEffects(effects);
    },
    // 실제 값 점검용: 기온·습도 등을 직접 넣는다(미리보기로 고른 시간대·날씨 위에 얹는다)
    __live: (o: LiveWeather | undefined) => {
      liveOverride = o;
      refresh();
    },
  });
}

const now = {
  badge: $('badge'), place: $('place'), temp: $('temp'), cond: $('cond'), condIcon: $('condIcon'), range: $('range'), cards: $('cards'),
};
const settingsPanel = $('settings');
const hourlyPanel = $('hourly');
const weekBar = document.querySelector<HTMLElement>('.week')!;
const toastEl = $('toast');
let loadController: AbortController | undefined;
let toastTimer = 0;
let liveOverride: LiveWeather | undefined;
/** 연달아 실패한 횟수와 다음 재시도 타이머 */
let failures = 0;
let retryTimer = 0;
/** 다시 시도를 기다리는 장소 */
let retryPlace: Place | undefined;
/** 사용자가 장소를 고를 때마다 증가. 늦게 도착한 현재 위치 응답이 그 뒤의 선택을 덮어쓰지 않게 한다. */
let choiceSeq = 0;

// ── 저장 ──────────────────────────────────────────────

function loadSavedPlace(): Place | undefined {
  try {
    const raw = localStorage.getItem(KEYS.place);
    if (!raw) return undefined;
    const p = JSON.parse(raw);
    const valid =
      p && typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 100 &&
      Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
      Number.isFinite(p.lon) && Math.abs(p.lon) <= 180;
    if (valid) return { name: p.name, detail: typeof p.detail === 'string' ? p.detail : undefined, lat: p.lat, lon: p.lon };
    localStorage.removeItem(KEYS.place);
  } catch {
    // 저장소를 못 쓰거나 값이 깨졌으면 기본 도시로 시작한다
  }
  return undefined;
}

function loadSavedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEYS.theme);
    if (isTheme(t)) return t;
  } catch {
    // 저장소를 못 쓰면 기본 테마
  }
  return 'island';
}

function loadSavedShape(): Shape {
  try {
    const saved = localStorage.getItem(KEYS.shape);
    if (saved === 'case' || saved === 'mini') return saved;
  } catch {
    // 저장소를 못 쓰면 기본 모양
  }
  return 'land';
}

function loadSavedEffects(): Effects {
  try {
    const v = JSON.parse(localStorage.getItem(KEYS.effects) ?? 'null');
    if (v && typeof v === 'object') {
      const out = { ...DEFAULT_EFFECTS };
      for (const k of Object.keys(out) as (keyof Effects)[]) if (typeof v[k] === 'boolean') out[k] = v[k];
      return out;
    }
  } catch {
    // 저장소를 못 쓰거나 값이 깨졌으면 기본 연출
  }
  return { ...DEFAULT_EFFECTS };
}

function saveEffects(e: Effects) {
  try {
    localStorage.setItem(KEYS.effects, JSON.stringify(e));
  } catch {
    // 무시: 다음에 켤 때 기본 연출로 시작할 뿐이다
  }
}

/** 마지막 예보를 남긴다. 기기 위치로 받은 예보는 남기지 않는다(장소와 같은 규칙) */
function saveForecast(place: Place, forecast: Forecast, savedAt: number) {
  if (place.current) return;
  try {
    localStorage.setItem(FORECAST_KEY, JSON.stringify({ place: { name: place.name, detail: place.detail, lat: place.lat, lon: place.lon }, forecast, savedAt }));
  } catch {
    // 무시: 다음에 켤 때 받아 올 때까지 빈 화면일 뿐이다
  }
}

/** 저장해 둔 예보가 지금 장소의 것이고 아직 쓸 만하면 먼저 보여 준다 */
function restoreForecast() {
  let cached;
  try {
    cached = parseCachedForecast(localStorage.getItem(FORECAST_KEY), Date.now());
  } catch {
    return;
  }
  if (!cached || cached.place.name !== state.place.name || cached.place.lat !== state.place.lat || cached.place.lon !== state.place.lon) return;
  state.forecast = cached.forecast;
  state.fetchedAt = cached.savedAt;
  // 새 예보를 받기 전까지는 '이전 정보'다
  state.offline = true;
}

function saveShape(s: Shape) {
  try {
    localStorage.setItem(KEYS.shape, s);
  } catch {
    // 무시: 다음 방문 때 기본 모양으로 시작할 뿐이다
  }
}

function saveTheme(t: Theme) {
  try {
    localStorage.setItem(KEYS.theme, t);
  } catch {
    // 무시: 다음 방문 때 기본 테마로 시작할 뿐이다
  }
}

function savePlace(p: Place) {
  if (p.current) return; // 기기 위치는 남기지 않는다
  try {
    localStorage.setItem(KEYS.place, JSON.stringify({ name: p.name, detail: p.detail, lat: p.lat, lon: p.lon }));
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

window.addEventListener(MODEL_ERROR, () => toast('풍경 모델을 불러오지 못했어요. 앱을 다시 열어 주세요.'));

// ── 장면과 화면 갱신 ───────────────────────────────────

/** 지금 하늘 단계(시간대와 다음 시간대로 섞인 정도, 해의 진행) */
function livePhase(f?: Forecast) {
  if (!f) return skyPhaseAt(localEpochMinutes(-new Date().getTimezoneOffset() * 60));
  const today = f.daily[0];
  return skyPhaseAt(localEpochMinutes(f.utcOffsetSeconds), today?.sunrise, today?.sunset);
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
  const lat = state.place.lat;
  const season = v.season !== 'live' ? v.season : seasonAt(f ? localMonth(f.utcOffsetSeconds) : new Date().getMonth(), lat);
  const live: LiveWeather = {};
  const day = f?.daily[state.dayIndex];
  const scrub = f && day && state.scrub;
  let time: TimeOfDay;
  let cond: Condition;
  if (scrub) {
    // 시간 그래프를 끄는 동안: 그 시각의 하늘과 날씨
    time = timeOfDayAt(localMinutesOf(scrub.time), day.sunrise, day.sunset);
    cond = conditionFromCode(scrub.code);
    live.temp = scrub.temp;
  } else {
    const phase = livePhase(f);
    // 오늘을 실시간으로 볼 때만 시간대 사이를 섞고 해를 시각대로 움직인다
    const today = v.time === 'live' && state.dayIndex === 0;
    // 다른 요일을 볼 때도 시간대는 지금 시각을 따른다(섞지는 않는다)
    time = v.time !== 'live' ? v.time : today || phase.t < 0.5 ? phase.from : phase.to;
    if (today) {
      live.blend = { to: phase.to, t: phase.t };
      live.dayFraction = phase.dayFraction;
    }
    const shown = today && phase.t >= 0.5 ? phase.to : time;
    cond = v.cond === 'live' ? liveCondition(f, shown) : v.cond;
  }
  if (f && v.season === 'live') live.minTemp = day?.min;
  // 실제 풍속·풍향: 오늘은 지금 값, 다른 요일은 그날 최대 풍속과 주된 풍향.
  // 날씨를 미리보기로 고르면 풍속은 그 날씨의 기본값을 쓰고 풍향만 실제를 따른다
  if (f) {
    live.windFromDeg = state.dayIndex === 0 ? f.current.windDir : day?.windDir;
    if (v.cond === 'live') live.windKmh = state.dayIndex === 0 ? f.current.wind : day?.wind;
    // 기온·습도·최근 강수: 오늘을 실시간으로 볼 때만(창 유리의 김·성에, 젖은 땅)
    if (v.cond === 'live' && state.dayIndex === 0 && !scrub) {
      live.temp = f.current.temp;
      live.humidity = f.current.humidity;
      live.precipMm = Math.max(f.current.precipitation, (day?.precipitation ?? 0) * 0.3);
    }
  }
  world.setSelection(time, cond, season, { ...live, ...liveOverride });
  const shownTime = live.blend && live.blend.t >= 0.5 ? live.blend.to : time;
  document.body.classList.toggle('is-dark', shownTime === 'night' || shownTime === 'evening');
  state.night = shownTime === 'night';
}

function isPreview() {
  const v = state.view;
  return v.time !== 'live' || v.cond !== 'live' || v.season !== 'live';
}

/** 배지: 미리보기 / 얼마나 오래된 정보인지 / 곧 비·눈이 오는지 / 지금 날씨 */
function badge(f: Forecast): string {
  if (isPreview()) return '미리보기';
  if (state.offline) return ageLabel(Date.now() - state.fetchedAt);
  if (state.dayIndex === 0) {
    const soon = nextPrecip(f.hourly, localIso(f.utcOffsetSeconds));
    if (soon) return `${soon.inHours}시간 뒤 ${soon.kind === 'snow' ? '눈' : '비'}`;
  }
  return badgeText(f, state.dayIndex);
}

function renderInfo() {
  const f = state.forecast;
  // 예보가 없으면 빈 7일 막대를 보이지 않는다
  weekBar.hidden = !f;
  if (!f) {
    now.place.textContent = state.place.name;
    now.badge.textContent = state.offline ? '날씨를 다시 받아 오는 중이에요' : '불러오는 중…';
    return;
  }
  renderNow(now, f, state.dayIndex, state.place.name, badge(f), state.night);
  renderWeek($('week'), f, state.dayIndex, selectDay);
  if (!hourlyPanel.hidden) renderHourly($('hourlyTitle'), $<SVGSVGElement>('chart'), $('hourlyList'), f, state.dayIndex);
}

function refresh() {
  updateScene();
  renderInfo();
}

// ── 패널 ──────────────────────────────────────────────

/** 요일 상세를 닫는 모든 경로(닫기 버튼·Esc·같은 요일 다시 누름)가 여기를 지난다. */
function closeHourly() {
  hourlyPanel.hidden = true;
  state.dayIndex = 0;
  state.scrub = undefined;
}

/** 요일 상세는 아래 예보 바 안, 설정은 오른쪽 위라 서로 겹치지 않아 각각 열고 닫는다 */
function openPanel(panel: HTMLElement) {
  panel.hidden = false;
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
    state.scrub = undefined;
    openPanel(hourlyPanel);
  }
  refresh();
}

// ── 장소 불러오기 ──────────────────────────────────────

/**
 * 예보를 불러온다. 실패하면 장소를 바꾸지 않고 이전 예보를 그대로 두어,
 * 새 도시 이름 밑에 이전 도시 날씨가 보이는 일이 없게 한다.
 */
async function loadPlace(place: Place, isRefresh = false, isRetry = false) {
  if (isRefresh && loadController) return; // 사용자가 고른 장소를 불러오는 중이면 정기 갱신은 건너뛴다
  // 사용자가 고른 장소가 아직 실패한 채 다시 시도를 기다리고 있으면, 정기 갱신이 그 재시도를 지우지 않게 그 장소로 한다
  if (isRefresh && retryPlace && retryPlace !== place) return loadPlace(retryPlace, false, true);
  loadController?.abort();
  clearTimeout(retryTimer);
  // 사용자가 새로 고른 장소는 처음부터 센다(실패 안내와 5초 뒤 재시도가 다시 나오게)
  if (!isRefresh && !isRetry) failures = 0;
  const ctrl = new AbortController();
  loadController = ctrl;
  if (!isRefresh) now.badge.textContent = '불러오는 중…';

  let forecast: Forecast;
  try {
    forecast = await fetchForecast(place, ctrl.signal);
    // 모양이 다르거나 값이 범위를 벗어난 응답은 쓰지도 저장하지도 않는다
    if (!isForecast(forecast)) throw new Error('forecast shape');
  } catch (e) {
    if (loadController === ctrl) loadController = undefined;
    // 사용자가 다른 장소를 골라 취소한 것만 조용히 끝낸다(시간 초과는 실패로 보고 다시 시도한다)
    if (ctrl.signal.aborted) return;
    state.offline = true;
    failures++;
    // 처음 한 번만 알린다(다시 시도할 때마다 토스트가 뜨지 않게)
    if (failures === 1) {
      toast(
        state.forecast && place === state.place
          ? '날씨를 새로 고치지 못했어요. 이전 정보를 보여줘요.'
          : `${place.name} 날씨를 불러오지 못했어요. 곧 다시 시도할게요.`,
      );
    }
    // 5초·15초·60초, 그 뒤로는 5분마다 다시 해 본다. 네트워크가 돌아오면(online) 바로 한다
    retryPlace = place;
    retryTimer = window.setTimeout(() => loadPlace(place, isRefresh, true), retryDelay(failures));
    renderInfo();
    return;
  }
  loadController = undefined;
  failures = 0;
  retryPlace = undefined;

  // 같은 장소를 새로 고칠 때는 보고 있던 날짜를 유지한다
  const keepDate = isRefresh ? state.forecast?.daily[state.dayIndex]?.date : undefined;
  const kept = keepDate ? forecast.daily.findIndex((d) => d.date === keepDate) : -1;
  if (kept < 0) closeHourly();
  state.place = place;
  state.forecast = forecast;
  state.fetchedAt = Date.now();
  state.offline = false;
  state.dayIndex = Math.max(0, kept);
  savePlace(place);
  saveForecast(place, forecast, state.fetchedAt);
  refresh();
}

/** 다시 시도를 기다리는 중이면 지금 바로 한다(네트워크가 돌아왔을 때) */
function retryNow() {
  if (failures === 0 || loadController) return;
  const place = retryPlace ?? state.place;
  loadPlace(place, place === state.place && state.forecast !== undefined, true);
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
  if (next.shape !== state.view.shape) {
    world.setShape(next.shape);
    saveShape(next.shape);
  }
  if (next.theme !== state.view.theme) {
    world.setTheme(next.theme);
    saveTheme(next.theme);
  }
  state.view = next;
  refresh();
});
applyFrame(state.view.frame);
world.setShape(state.view.shape);
const syncEffects = renderEffects($('effectsBody'), effects, (next) => {
  effects = next;
  world.setEffects(next);
  saveEffects(next);
});

// 시간 그래프를 끌면 그 시각의 하늘·날씨로 풍경이 바뀌고, 손을 떼면 지금으로 돌아온다
setupScrub($<SVGSVGElement>('chart'), () => {
  const f = state.forecast;
  return f ? f.hourly.filter((h) => h.time.startsWith(f.daily[state.dayIndex].date)) : [];
}, (hour) => {
  state.scrub = hour;
  updateScene();
  const f = state.forecast;
  if (f) now.badge.textContent = hour ? `${Number(hour.time.slice(11, 13))}시 풍경` : badge(f);
});

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
    if (world.exploring) world.leave();
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
if (isDesktopApp) setupDesktopSettings(settingsPanel, toast);

/** 브라우저는 Geolocation API, 데스크톱 앱은 macOS 위치 API. 실패하면 오류 코드(1~3)를 던진다. */
function locate(): Promise<{ lat: number; lon: number }> {
  if (isDesktopApp) return nativeLocation();
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(2);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err.code),
      { timeout: 10000, maximumAge: 10 * 60 * 1000 },
    );
  });
}

$('locate').addEventListener('click', async () => {
  const seq = ++choiceSeq;
  try {
    const { lat, lon } = await locate();
    if (seq !== choiceSeq) return; // 기다리는 사이 다른 도시를 골랐다
    loadPlace({ name: '현재 위치', lat: coarse(lat), lon: coarse(lon), current: true });
  } catch (code) {
    if (seq === choiceSeq) toast(GEO_ERRORS[code as number] ?? '현재 위치를 가져오지 못했어요.');
  }
});

const soundBtn = $('sound');
soundBtn.addEventListener('click', async () => {
  const on = await ambience.toggle();
  soundBtn.setAttribute('aria-pressed', String(on));
  soundBtn.querySelector('span')!.textContent = on ? '소리 끄기' : '소리 켜기';
});
world.onFrame = (env) => ambience.update(env);

// ── 들어가기 모드 ──
const exploreBar = $('explore');
$('exploreBtn').addEventListener('click', () => {
  settingsPanel.hidden = true;
  closeHourly();
  syncSettingsButton();
  world.enter().then(
    (ok) => {
      if (!ok) toast('설 자리를 찾지 못했어요. 잠시 뒤에 다시 해 주세요.');
    },
    () => toast('들어가기를 불러오지 못했어요. 잠시 뒤에 다시 해 주세요.'),
  );
});
$('exploreExit').addEventListener('click', () => world.leave());
world.onExplore = (on) => {
  document.body.classList.toggle('exploring', on);
  exploreBar.hidden = !on;
};
const exploreHint = exploreBar.querySelector('.explore__hint')!;
const walkHint = exploreHint.textContent;
world.onRide = (on) => {
  exploreHint.textContent = on ? '대관람차를 타고 있어요 · 움직이면 내려요' : walkHint;
};

// 저장해 둔 예보가 있으면 먼저 보여 주고 새로 받는다(로그인 직후 네트워크보다 앱이 먼저 뜨는 경우)
restoreForecast();
refresh();
loadPlace(state.place, state.forecast !== undefined);
window.addEventListener('online', retryNow);
setInterval(updateScene, 60 * 1000); // 실시간 시간대 갱신(화면 글자는 그대로 둬 포커스·낭독이 흔들리지 않게)
setInterval(() => loadPlace(state.place, true), REFRESH_MS);
