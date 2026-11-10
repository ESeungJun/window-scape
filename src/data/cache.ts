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
  if (!f || !isNum(f.utcOffsetSeconds) || !f.current || !Array.isArray(f.daily) || !Array.isArray(f.hourly) || f.daily.length === 0) return null;
  const c = f.current;
  if (![c.temp, c.humidity, c.precipitation, c.code, c.wind, c.windDir].every(isNum)) return null;
  for (const d of f.daily) {
    if (!d || typeof d.date !== 'string' || ![d.code, d.max, d.min, d.precipitation, d.wind, d.windDir].every(isNum)) return null;
    if (typeof d.sunrise !== 'string' || typeof d.sunset !== 'string') return null;
  }
  for (const h of f.hourly) {
    if (!h || typeof h.time !== 'string' || ![h.temp, h.code, h.pop].every(isNum)) return null;
  }
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
