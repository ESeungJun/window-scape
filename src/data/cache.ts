import type { Forecast, Place } from './weather.ts';

/**
 * 마지막으로 받은 예보를 남겨 두었다가, 켤 때 네트워크가 아직 없으면 먼저 보여 준다.
 * 기기 위치로 받은 예보는 남기지 않는다(장소와 같은 규칙).
 */
export const FORECAST_KEY = 'window-scape:forecast';
/** 이보다 오래된 예보는 "지금 날씨"로 보여 주기엔 낡았다 */
export const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

export interface CachedForecast {
  place: Place;
  forecast: Forecast;
  savedAt: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const within = (v: unknown, lo: number, hi: number) => isNum(v) && v >= lo && v <= hi;

/**
 * 예보의 모양과 값의 범위를 확인한다. 저장해 둔 예보를 되살릴 때와 네트워크에서 받은 직후 둘 다 거친다
 * (깨진 값이 화면 계산을 멈추거나 저장소에 남지 않게).
 */
export function isForecast(f: unknown): f is Forecast {
  const v = f as Forecast;
  if (!v || typeof v !== 'object' || !within(v.utcOffsetSeconds, -86400, 86400)) return false;
  if (!v.current || !Array.isArray(v.daily) || !Array.isArray(v.hourly)) return false;
  if (v.daily.length === 0 || v.daily.length > 16 || v.hourly.length > 16 * 24) return false;
  const c = v.current;
  if (!within(c.temp, -100, 70) || !within(c.humidity, 0, 100) || !within(c.precipitation, 0, 2000)) return false;
  if (!within(c.code, 0, 99) || !within(c.wind, 0, 500) || !within(c.windDir, 0, 360)) return false;
  for (const d of v.daily) {
    if (!d || typeof d.date !== 'string' || !DATE.test(d.date)) return false;
    if (typeof d.sunrise !== 'string' || !DATE_TIME.test(d.sunrise) || typeof d.sunset !== 'string' || !DATE_TIME.test(d.sunset)) return false;
    if (!within(d.code, 0, 99) || !within(d.max, -100, 70) || !within(d.min, -100, 70)) return false;
    if (!within(d.precipitation, 0, 5000) || !within(d.wind, 0, 500) || !within(d.windDir, 0, 360)) return false;
  }
  for (const h of v.hourly) {
    if (!h || typeof h.time !== 'string' || !DATE_TIME.test(h.time)) return false;
    if (!within(h.temp, -100, 70) || !within(h.code, 0, 99) || !within(h.pop, 0, 100)) return false;
  }
  return true;
}

/** 저장된 글자를 예보로 되돌린다. 모양이 다르거나 낡았거나 날짜가 넘어갔으면 null */
export function parseCachedForecast(raw: string | null, now: number): CachedForecast | null {
  if (!raw) return null;
  let v: CachedForecast;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const { place, forecast: f, savedAt } = v;
  if (!isNum(savedAt) || savedAt > now + 60_000 || now - savedAt > CACHE_MAX_AGE_MS) return null;
  if (!place || typeof place.name !== 'string' || !place.name || place.name.length > 100) return null;
  if (!isNum(place.lat) || Math.abs(place.lat) > 90 || !isNum(place.lon) || Math.abs(place.lon) > 180) return null;
  if (!isForecast(f)) return null;
  // 저장한 뒤 날짜가 바뀌었으면 첫 칸이 어제다
  const today = new Date(now + f.utcOffsetSeconds * 1000).toISOString().slice(0, 10);
  if (f.daily[0].date !== today) return null;
  return {
    place: { name: place.name, detail: typeof place.detail === 'string' ? place.detail : undefined, lat: place.lat, lon: place.lon },
    forecast: f,
    savedAt,
  };
}

/** 예보가 얼마나 오래됐는지: "방금 받은 날씨예요", "12분 전 날씨예요", "3시간 전 날씨예요" */
export function ageLabel(ageMs: number): string {
  const min = Math.floor(Math.max(0, ageMs) / 60_000);
  if (min < 1) return '방금 받은 날씨예요';
  if (min < 60) return `${min}분 전 날씨예요`;
  return `${Math.floor(min / 60)}시간 전 날씨예요`;
}
