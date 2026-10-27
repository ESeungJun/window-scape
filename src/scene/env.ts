import { Color } from 'three';
import type { Condition, Season, TimeOfDay } from '../data/weather';
import { smoothstep } from '../util';

/**
 * 장면 전체가 읽는 연출 값. 시간대·날씨·계절 프리셋을 합쳐 목표값을 만들고,
 * 매 프레임 현재값을 목표값 쪽으로 보간해 전환이 부드럽게 일어난다.
 */
const COLOR_KEYS = ['skyTop', 'skyBottom', 'sunColor', 'hemiSky', 'grass', 'foliageA', 'foliageB', 'pine'] as const;
const NUM_KEYS = [
  'sunIntensity', 'sunElevation', 'hemiIntensity', 'nightLights', 'stars',
  'cloudCover', 'cloudDark', 'overcast', 'rain', 'snow', 'fog', 'wind', 'storm', 'rainbow', 'snowCover',
  // 바람이 불어 가는 방향(단위 벡터, 북쪽 = -z, 동쪽 = +x)
  'windX', 'windZ',
] as const;

type ColorKey = (typeof COLOR_KEYS)[number];
type NumKey = (typeof NUM_KEYS)[number];
export type Env = Record<ColorKey, Color> & Record<NumKey, number>;

export function createEnv(): Env {
  const env = {} as Env;
  for (const k of COLOR_KEYS) env[k] = new Color();
  for (const k of NUM_KEYS) env[k] = 0;
  return env;
}

export function copyEnv(dst: Env, src: Env): void {
  for (const k of COLOR_KEYS) dst[k].copy(src[k]);
  for (const k of NUM_KEYS) dst[k] = src[k];
}

export function lerpEnv(cur: Env, target: Env, t: number): void {
  for (const k of COLOR_KEYS) cur[k].lerp(target[k], t);
  for (const k of NUM_KEYS) cur[k] += (target[k] - cur[k]) * t;
}

const TIME: Record<TimeOfDay, {
  skyTop: string; skyBottom: string; sun: string; sunI: number; elev: number;
  hemi: number; hemiSky: string; lights: number; stars: number;
}> = {
  morning: { skyTop: '#6f9fdc', skyBottom: '#ffd2ad', sun: '#ffc98f', sunI: 2.6, elev: 0.3, hemi: 1.0, hemiSky: '#d4e2ff', lights: 0.25, stars: 0 },
  day: { skyTop: '#3d84d8', skyBottom: '#cfe7ff', sun: '#fff3df', sunI: 3.2, elev: 0.95, hemi: 1.25, hemiSky: '#dcedff', lights: 0, stars: 0 },
  evening: { skyTop: '#46499a', skyBottom: '#ff9466', sun: '#ff8a4c', sunI: 2.3, elev: 0.16, hemi: 0.8, hemiSky: '#ffc0a0', lights: 0.8, stars: 0.2 },
  night: { skyTop: '#060b22', skyBottom: '#1c2a58', sun: '#8ea4ff', sunI: 0.75, elev: 0.75, hemi: 0.45, hemiSky: '#4f63a6', lights: 1, stars: 1 },
};

const WEATHER: Record<Condition, {
  cover: number; dark: number; overcast: number; rain: number; snow: number;
  fog: number; wind: number; storm: number; rainbow: number;
}> = {
  clear: { cover: 0.12, dark: 0, overcast: 0, rain: 0, snow: 0, fog: 0, wind: 0.15, storm: 0, rainbow: 0 },
  partly: { cover: 0.45, dark: 0.05, overcast: 0.05, rain: 0, snow: 0, fog: 0, wind: 0.25, storm: 0, rainbow: 0 },
  cloudy: { cover: 0.85, dark: 0.3, overcast: 0.5, rain: 0, snow: 0, fog: 0.1, wind: 0.3, storm: 0, rainbow: 0 },
  wind: { cover: 0.55, dark: 0.1, overcast: 0.15, rain: 0, snow: 0, fog: 0, wind: 1, storm: 0, rainbow: 0 },
  fog: { cover: 0.35, dark: 0.15, overcast: 0.6, rain: 0, snow: 0, fog: 1, wind: 0.05, storm: 0, rainbow: 0 },
  rain: { cover: 0.9, dark: 0.45, overcast: 0.6, rain: 0.5, snow: 0, fog: 0.25, wind: 0.4, storm: 0, rainbow: 0 },
  heavyRain: { cover: 1, dark: 0.65, overcast: 0.8, rain: 1, snow: 0, fog: 0.4, wind: 0.6, storm: 0, rainbow: 0 },
  storm: { cover: 1, dark: 0.85, overcast: 0.9, rain: 1, snow: 0, fog: 0.35, wind: 0.95, storm: 1, rainbow: 0 },
  snow: { cover: 0.85, dark: 0.2, overcast: 0.5, rain: 0, snow: 1, fog: 0.3, wind: 0.2, storm: 0, rainbow: 0 },
  rainbow: { cover: 0.5, dark: 0.15, overcast: 0.1, rain: 0.12, snow: 0, fog: 0, wind: 0.2, storm: 0, rainbow: 1 },
};

const SEASON: Record<Season, { grass: string; a: string; b: string; pine: string; snow: number }> = {
  spring: { grass: '#7cc25a', a: '#93d36b', b: '#f4aecb', pine: '#2f7046', snow: 0 },
  summer: { grass: '#59a843', a: '#3f9a3c', b: '#2e7d36', pine: '#2a6440', snow: 0 },
  autumn: { grass: '#93a54a', a: '#e8902f', b: '#c8452e', pine: '#2f6443', snow: 0 },
  winter: { grass: '#8e9f78', a: '#b9a98e', b: '#a99b86', pine: '#2f5a46', snow: 1 },
};

const SNOW = new Color('#eef3f8');
const tmp = new Color();

const luminance = (c: Color) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;

/** 실제 날씨 값. 주어진 것만 프리셋 대신 쓴다(미리보기로 고른 항목은 넘기지 않는다) */
export interface LiveWeather {
  /** 최저 기온(°C). 겨울 눈 덮임을 기온으로 정한다(6°C 이상이면 눈 없음) */
  minTemp?: number;
  /** 풍속(km/h). 45km/h 이상이면 바람 연출 최대 */
  windKmh?: number;
  /** 바람이 불어오는 방위(도, 북쪽 0 · 시계 방향) */
  windFromDeg?: number;
}

export function composeEnv(time: TimeOfDay, cond: Condition, season: Season, out: Env, live: LiveWeather = {}): Env {
  const { minTemp } = live;
  const T = TIME[time];
  const W = WEATHER[cond];
  const S = SEASON[season];

  out.skyTop.set(T.skyTop);
  out.skyBottom.set(T.skyBottom);
  out.sunColor.set(T.sun);
  out.hemiSky.set(T.hemiSky);
  out.sunElevation = T.elev;
  out.nightLights = T.lights;

  // 흐릴수록 하늘을 같은 밝기의 회색 쪽으로 당긴다
  const lb = luminance(out.skyBottom);
  out.skyBottom.lerp(tmp.setRGB(lb * 0.95, lb, lb * 1.06), W.overcast * 0.75);
  const lt = luminance(out.skyTop);
  out.skyTop.lerp(tmp.setRGB(lt * 0.95, lt, lt * 1.08), W.overcast * 0.8);

  out.sunIntensity = T.sunI * (1 - 0.7 * W.overcast);
  out.hemiIntensity = T.hemi * (1 - 0.25 * W.overcast);
  out.stars = T.stars * (1 - W.overcast);

  out.cloudCover = W.cover;
  out.cloudDark = W.dark;
  out.overcast = W.overcast;
  out.rain = W.rain;
  out.snow = W.snow;
  out.fog = W.fog;
  // 실제 풍속이 있으면 그 세기로(날씨 종류가 정한 값보다 약해지지는 않게 절반은 남긴다)
  out.wind = live.windKmh === undefined ? W.wind : Math.max(W.wind * 0.5, Math.min(1, live.windKmh / 45));
  // 풍향: 불어오는 방위의 반대쪽으로 분다. 모르면 동쪽(+x)으로
  const from = ((live.windFromDeg ?? 270) * Math.PI) / 180;
  out.windX = -Math.sin(from);
  out.windZ = Math.cos(from);
  out.storm = W.storm;
  out.rainbow = time === 'night' ? 0 : W.rainbow;

  // 계절 + 눈이 내리면 계절과 상관없이 섬이 하얗게 덮인다
  const seasonSnow = minTemp === undefined ? S.snow : S.snow * smoothstep(6, 0, minTemp);
  const snow = Math.max(seasonSnow, cond === 'snow' ? 0.8 : 0);
  out.snowCover = snow;
  out.grass.set(S.grass).lerp(SNOW, snow);
  out.foliageA.set(S.a).lerp(SNOW, snow * 0.85);
  out.foliageB.set(S.b).lerp(SNOW, snow * 0.85);
  out.pine.set(S.pine).lerp(SNOW, snow * 0.5);
  return out;
}
