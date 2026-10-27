export type TimeOfDay = 'morning' | 'day' | 'evening' | 'night';
export type Condition =
  | 'clear' | 'partly' | 'cloudy' | 'wind' | 'fog'
  | 'rain' | 'heavyRain' | 'storm' | 'snow' | 'rainbow';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Place {
  name: string;
  detail?: string;
  lat: number;
  lon: number;
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD (현지)
  code: number;
  max: number;
  min: number;
  sunrise: string; // YYYY-MM-DDTHH:MM (현지)
  sunset: string;
  precipitation: number;
}

export interface HourlyForecast {
  time: string; // YYYY-MM-DDTHH:MM (현지)
  temp: number;
  code: number;
  pop: number;
}

export interface Forecast {
  utcOffsetSeconds: number;
  current: {
    temp: number;
    humidity: number;
    precipitation: number;
    code: number;
    wind: number;
    windDir: number;
  };
  daily: DailyForecast[];
  hourly: HourlyForecast[];
}

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export async function fetchForecast(place: Place, signal?: AbortSignal): Promise<Forecast> {
  const params = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    current: 'temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum',
    timezone: 'auto',
    forecast_days: '7',
  });
  const res = await fetch(`${FORECAST_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`forecast ${res.status}`);
  const j = await res.json();
  const d = j.daily;
  const h = j.hourly;
  return {
    utcOffsetSeconds: j.utc_offset_seconds,
    current: {
      temp: j.current.temperature_2m,
      humidity: j.current.relative_humidity_2m,
      precipitation: j.current.precipitation,
      code: j.current.weather_code,
      wind: j.current.wind_speed_10m,
      windDir: j.current.wind_direction_10m,
    },
    daily: d.time.map((date: string, i: number) => ({
      date,
      code: d.weather_code[i],
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      sunrise: d.sunrise[i],
      sunset: d.sunset[i],
      precipitation: d.precipitation_sum[i],
    })),
    hourly: h.time.map((time: string, i: number) => ({
      time,
      temp: h.temperature_2m[i],
      code: h.weather_code[i],
      pop: h.precipitation_probability[i] ?? 0,
    })),
  };
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const params = new URLSearchParams({ name: query, count: '6', language: 'ko', format: 'json' });
  const res = await fetch(`${GEOCODING_URL}?${params}`, { signal });
  if (!res.ok) throw new Error(`geocoding ${res.status}`);
  const j = await res.json();
  return (j.results ?? []).map((r: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }) => ({
    name: r.name,
    detail: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

/** WMO 날씨 코드를 섬 연출 상태로 바꾼다. */
export function conditionFromCode(code: number, windKmh = 0): Condition {
  if (code >= 95) return 'storm';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 65 || code === 67 || code === 82) return 'heavyRain';
  if ((code >= 51 && code <= 66) || (code >= 80 && code <= 81)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (windKmh >= 30) return 'wind';
  if (code === 3) return 'cloudy';
  if (code === 1 || code === 2) return 'partly';
  return 'clear';
}

export const CONDITION_LABEL: Record<Condition, string> = {
  clear: '맑음',
  partly: '구름 조금',
  cloudy: '흐림',
  wind: '바람',
  fog: '안개',
  rain: '비',
  heavyRain: '강한 비',
  storm: '뇌우',
  snow: '눈',
  rainbow: '무지개',
};

/** 그 지역의 현재 시각(자정부터 분) */
export function localMinutes(utcOffsetSeconds: number, now = Date.now()): number {
  const sec = Math.floor(now / 1000) + utcOffsetSeconds;
  return (((sec % 86400) + 86400) % 86400) / 60;
}

export function localMonth(utcOffsetSeconds: number, now = Date.now()): number {
  return new Date(now + utcOffsetSeconds * 1000).getUTCMonth();
}

const minutesOf = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(':').map(Number);
  return h * 60 + m;
};

export function timeOfDayAt(minutes: number, sunrise?: string, sunset?: string): TimeOfDay {
  const rise = sunrise ? minutesOf(sunrise) : 6 * 60;
  const set = sunset ? minutesOf(sunset) : 18 * 60;
  if (minutes < rise - 30 || minutes > set + 45) return 'night';
  if (minutes < rise + 120) return 'morning';
  if (minutes > set - 90) return 'evening';
  return 'day';
}

export function seasonAt(month0: number, lat: number): Season {
  const m = lat < 0 ? (month0 + 6) % 12 : month0;
  if (m >= 2 && m <= 4) return 'spring';
  if (m >= 5 && m <= 7) return 'summer';
  if (m >= 8 && m <= 10) return 'autumn';
  return 'winter';
}
